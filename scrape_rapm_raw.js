const https = require('https');
const fs = require('fs');
const path = require('path');

async function scrapeRaw() {
  console.log('Fetching raw HTML...');
  const html = await new Promise((resolve, reject) => {
    https.get('https://hackastat.eu/en/player-rapm/', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
  
  console.log('HTML size:', html.length);
  
  // The table rows have a standard structure.
  // Each row starts with <tr> and ends with </tr>
  const rows = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  if (!rows) {
    console.log('No rows found');
    return;
  }
  
  console.log(`Found ${rows.length} rows.`);
  
  const data = {};
  
  rows.forEach(r => {
    // Extract tds
    const tds = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let match;
    while ((match = tdRegex.exec(r)) !== null) {
      // Clean HTML tags and entities
      let text = match[1].replace(/<[^>]*>?/gm, '').trim();
      text = text.replace(/&nbsp;/g, ' ');
      tds.push(text);
    }
    
    // We expect at least 17 columns for player rows
    if (tds.length >= 17) {
      const player = tds[1];
      const league = tds[3];
      const season = tds[4];
      const offRapm = tds[14];
      const defRapm = tds[15];
      const netRapm = tds[16];
      
      if (player && league && season && netRapm) {
        const key = `${player}|${league}|${season}`;
        data[key] = { offRapm, defRapm, netRapm };
      }
    }
  });
  
  const count = Object.keys(data).length;
  console.log(`Parsed ${count} valid RAPM records.`);
  
  fs.writeFileSync(path.join(__dirname, 'hackastat_rapm.json'), JSON.stringify(data, null, 2));
  console.log('Saved to hackastat_rapm.json');
}

scrapeRaw().catch(console.error);
