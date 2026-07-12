const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('https://hackastat.eu/medie-lega/?season%5B%5D=2025-2026&league%5B%5D=6', { waitUntil: 'networkidle2' });
  const html = await page.content();
  console.log(html.includes('table') ? 'Table found' : 'No table');
  console.log(html.substring(0, 200));
  await browser.close();
  process.exit(0);
})();
