const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'rapm_page.html'), 'utf8');

const data = {};

// Regex to match a table row. This might be tricky because of newlines.
// Better to split by '<tr>' and '</tr>'
const rows = html.split('</tr>');
let count = 0;

for (let r of rows) {
  if (r.includes('<td') && r.includes('</td>')) {
    const tds = r.split('</td>');
    if (tds.length >= 17) {
      // Clean up tags and trim
      const clean = (str) => str.replace(/<[^>]*>?/gm, '').replace(/\n/g, '').trim();
      
      const player = clean(tds[1]);
      const league = clean(tds[3]);
      const season = clean(tds[4]);
      const offRapm = clean(tds[14]);
      const defRapm = clean(tds[15]);
      const netRapm = clean(tds[16]);
      
      // Basic validation
      if (player && league && season && (offRapm.includes('+') || offRapm.includes('-') || offRapm === '0.0')) {
        const key = `${player}|${league}|${season}`;
        data[key] = { offRapm, defRapm, netRapm };
        count++;
      }
    }
  }
}

console.log(`Parsed ${count} records from HTML.`);
fs.writeFileSync(path.join(__dirname, 'hackastat_rapm.json'), JSON.stringify(data, null, 2));
console.log('Saved to hackastat_rapm.json');
