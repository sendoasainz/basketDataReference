const scraperHackastat = require('./scraper-hackastat');

async function testScan() {
  console.log('Iniciando escaneo de prueba para la Liga Endesa (ACB) en Hack a Stat...');
  try {
    const players = await scraperHackastat.scrapeFullLeague('liga-endesa', '2025-2026');
    console.log(`\nEscaneo completado. Total jugadores ACB: ${players.length}`);
    
    // Filtrar los de Surne Bilbao
    const bilbaoPlayers = players.filter(p => p.team.toLowerCase().includes('bilbao'));
    console.log(`\nJugadores encontrados para Surne Bilbao Basket (${bilbaoPlayers.length}):`);
    bilbaoPlayers.forEach(p => {
      console.log(`- ${p.name} (${p.position}): ${p.stats.pts} PTS, ${p.stats.reb} REB, RAPM: ${p.stats.trueNetRtg}`);
    });

  } catch (err) {
    console.error('Error durante el escaneo:', err);
  } finally {
    process.exit(0);
  }
}

testScan();
