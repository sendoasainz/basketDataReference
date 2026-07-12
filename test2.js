const scraper = require('./scraper');

async function test() {
  await scraper.initBrowser();
  const page = await scraper.__browser.newPage();
  await page.goto('https://www.be-basketball.com/league/aba-liga/teams', { waitUntil: 'networkidle2' });
  const teams = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/team/"]'));
    const teamMap = new Map();
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/\/team\/([a-z0-9-]+)/i);
      if (match) {
        const slug = match[1].toLowerCase();
        const name = link.textContent.trim();
        if (slug !== '' && name !== '') {
          if (!teamMap.has(slug)) {
            teamMap.set(slug, { name: name || slug, slug });
          } else {
            const existing = teamMap.get(slug);
            if (name.length > existing.name.length) {
              teamMap.set(slug, { name, slug });
            }
          }
        }
      }
    }
    return Array.from(teamMap.values());
  });
  console.log(JSON.stringify(teams, null, 2));
  await scraper.closeBrowser();
}

test().catch(console.error);
