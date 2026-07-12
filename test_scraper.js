const scraper = require('./scraper');
(async () => {
    try {
        if (scraper.initBrowser) await scraper.initBrowser();
        const stats = await scraper.scrapePlayerStats('Martin-Krampelj', {
            leagueName: 'Liga Endesa',
            leagueSlug: 'liga-endesa',
            teamName: 'MoraBanc Andorra'
        });
        console.log(JSON.stringify(stats, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        if (scraper.closeBrowser) await scraper.closeBrowser();
        process.exit();
    }
})();
