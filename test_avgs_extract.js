const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('https://hackastat.eu/medie-lega/?season%5B%5D=2025-2026&league%5B%5D=6', { waitUntil: 'networkidle2' });
  const data = await page.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) return 'no table';
    const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim());
    const firstRow = Array.from(table.querySelectorAll('tbody tr')[0].querySelectorAll('td')).map(td => td.textContent.trim());
    return { headers, firstRow };
  });
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
  process.exit(0);
})();
