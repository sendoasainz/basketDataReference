const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'data', 'players-2024-2025.json');
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

let updated = 0;
for (const p of data.players) {
  if (p.name === 'Martin Krampelj' && p.league === 'Liga Endesa' && p.team === 'MoraBanc Andorra') {
    p.team = 'Yalovaspor';
    updated++;
  }
  if (p.name === 'Aaryn Rai' && p.league === 'EuroLeague' && p.team === 'Desconocido (Error)') {
    p.team = 'Niagara River Lions';
    updated++;
  }
}

if (updated > 0) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`Reverted ${updated} players`);
}
