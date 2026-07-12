const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'data', 'players-2024-2025.json');
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

let updated = 0;
for (const p of data.players) {
  if (p.name === 'Martin Krampelj' && p.league === 'Liga Endesa' && p.team === 'Yalovaspor') {
    p.team = 'MoraBanc Andorra';
    updated++;
  }
  if (p.name === 'Aaryn Rai' && p.league === 'EuroLeague' && p.team === 'Niagara River Lions') {
    p.team = 'Desconocido (Error)';
    updated++;
  }
}

if (updated > 0) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`Patched ${updated} players`);
}
