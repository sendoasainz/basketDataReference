const fs = require('fs');
let txt = fs.readFileSync('public/app.js', 'utf8');
txt = txt.replace(/\\`/g, '`');
fs.writeFileSync('public/app.js', txt);
console.log('Fixed backticks.');
