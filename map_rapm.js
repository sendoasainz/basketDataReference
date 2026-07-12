const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
const rapmData = JSON.parse(fs.readFileSync(path.join(__dirname, 'hackastat_rapm.json'), 'utf8'));

const leagueMap = {
  'liga-endesa': 'ACB',
  'euroleague': 'EUROLEAGUE',
  'eurocup': 'EUROCUP',
  'basketball-champions-league': 'BCL',
  'lega-basket-serie-a': 'LBA'
};

const files = fs.readdirSync(dataDir).filter(f => f.startsWith('players-') && f.endsWith('.json'));

let totalUpdated = 0;

for (const file of files) {
  const filePath = path.join(dataDir, file);
  const playersData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const playersArray = playersData.players || [];
  let updatedCount = 0;
  
  for (const player of playersArray) {
    if (!player.name) continue;
    
    const leagueSlug = player.leagueSlug;
    const hackLeague = leagueMap[leagueSlug];
    if (!hackLeague) continue;
    
    // Attempt to normalize Hack-a-stat season format. 
    // Hack-a-Stat has '2024-2025' or '2023-2024'. Our DB uses '2024-2025'.
    const hackSeason = player.season; 
    
    // Name mapping variations
    const parts = player.name.trim().split(/\s+/);
    if (parts.length < 2) continue;
    
    const firstInitial = parts[0][0].toUpperCase() + '.';
    
    // Variation 1: Last word + First initial (e.g. "Tavares W.")
    const var1 = parts[parts.length - 1] + ' ' + firstInitial;
    
    // Variation 2: All words except first + First initial (e.g. "Hernangomez W.")
    const var2 = parts.slice(1).join(' ') + ' ' + firstInitial;
    
    // Variation 3: Only the second word + First initial
    const var3 = parts[1] + ' ' + firstInitial;

    const keysToTry = [
      `${var1}|${hackLeague}|${hackSeason}`,
      `${var2}|${hackLeague}|${hackSeason}`,
      `${var3}|${hackLeague}|${hackSeason}`
    ];
    
    let match = null;
    
    for (const key of keysToTry) {
      if (rapmData[key]) {
        match = rapmData[key];
        break;
      } else {
        // Try case-insensitive matching on keys
        const lowerKey = key.toLowerCase();
        const foundKey = Object.keys(rapmData).find(k => k.toLowerCase() === lowerKey);
        if (foundKey) {
          match = rapmData[foundKey];
          break;
        }
      }
    }
    
    if (match) {
      player.rapm = {
        off: parseFloat(match.offRapm),
        def: parseFloat(match.defRapm),
        net: parseFloat(match.netRapm)
      };
      
      // We will also use true NET RATing instead of our estimated netRtg if available
      // The true Net Rating from Hack-A-Stat is the netPoints/netRapm. Let's assign it to trueNetRtg
      player.trueNetRtg = parseFloat(match.netRapm);
      
      updatedCount++;
      totalUpdated++;
    }
  }
  
  if (updatedCount > 0) {
    fs.writeFileSync(filePath, JSON.stringify(playersData, null, 2));
    console.log(`Updated ${updatedCount} players in ${file}`);
  }
}

console.log(`Total players updated with RAPM data: ${totalUpdated}`);
