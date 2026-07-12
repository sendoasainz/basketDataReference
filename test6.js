const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('https://www.be-basketball.com/league/liga-endesa/teams', { waitUntil: 'networkidle2' });
  const teams = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/team/"]'));
    const map = new Map();
    for (const l of links) {
      const slug = l.getAttribute('href').match(/\/team\/([a-z0-9-]+)/i)?.[1];
      if (slug && l.textContent.trim().length > 3) map.set(slug, l.textContent.trim());
    }
    return Array.from(map.entries());
  });
  console.log(JSON.stringify(teams, null, 2));
  await browser.close();
  process.exit(0);
})();
