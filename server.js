/**
 * server.js — Express server for Basketball Stats Comparison App
 * 
 * Serves static files, provides API endpoints for scraping,
 * comparing players, and accessing the database.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const scraper = require('./scraper');
const scraperHackastat = require('./scraper-hackastat');
const statsEngine = require('./stats-engine');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Request logging ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ─── API Routes ──────────────────────────────────────────────────────────────

/**
 * GET /api/leagues
 * Return the 16 configured leagues with slugs.
 */
app.get('/api/leagues', (req, res) => {
  try {
    const leagues = scraper.getLeagues();
    res.json({
      success: true,
      leagues,
      count: leagues.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/database
 * Return all cached player data (or sample data if no cache).
 */
app.get('/api/database', (req, res) => {
  try {
    const db = scraper.loadDatabase();
    const players = db.players || [];

    // Optional query filters
    const { league, season, position, team } = req.query;

    let filtered = players;

    if (league) {
      filtered = filtered.filter(p =>
        (p.leagueSlug || '').toLowerCase() === league.toLowerCase() ||
        (p.league || '').toLowerCase() === league.toLowerCase()
      );
    }

    if (season) {
      filtered = filtered.filter(p => p.season === season);
    }

    if (position) {
      filtered = filtered.filter(p =>
        (p.position || '').toLowerCase().includes(position.toLowerCase())
      );
    }

    if (team) {
      filtered = filtered.filter(p =>
        (p.teamSlug || '').toLowerCase() === team.toLowerCase() ||
        (p.team || '').toLowerCase().includes(team.toLowerCase())
      );
    }

    res.json({
      success: true,
      players: filtered,
      count: filtered.length,
      totalInDatabase: players.length,
      timestamp: db.timestamp,
      source: db.source
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/league-averages
 * Return league averages by position. If Hack a Stat file exists, returns that.
 * Otherwise calculates it on the fly from the database.
 */
app.get('/api/league-averages', (req, res) => {
  try {
    const { league, season } = req.query;
    if (!league) {
      return res.status(400).json({ success: false, error: 'Missing required field: league' });
    }

    const targetSeason = season || '2025-2026';
    const avgPath = path.join(__dirname, 'data', `league-averages-${league}.json`);

    // 1. Try to load Hack a Stat averages
    if (fs.existsSync(avgPath)) {
      try {
        const raw = fs.readFileSync(avgPath, 'utf-8');
        const averages = JSON.parse(raw);
        return res.json({ success: true, source: 'hackastat', averages });
      } catch (err) {
        console.error(`[Server] Error loading Hack a Stat averages:`, err.message);
      }
    }

    // 2. Fallback: Calculate from our database
    const db = scraper.loadDatabase();
    const players = db.players || [];
    const leaguePlayers = players.filter(p => 
      (p.leagueSlug === league || p.league === league) && 
      p.season === targetSeason &&
      p.position
    );

    const averages = {
      Guard: { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, count: 0 },
      Forward: { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, count: 0 },
      Center: { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, count: 0 }
    };

    for (const p of leaguePlayers) {
      // Basic position grouping
      let pos = 'Forward';
      const rawPos = p.position.toLowerCase();
      if (rawPos.includes('guard') || rawPos === 'g' || rawPos === 'pg' || rawPos === 'sg') pos = 'Guard';
      else if (rawPos.includes('center') || rawPos === 'c') pos = 'Center';

      const s = p.stats;
      if (s && s.gp > 0 && s.min > 0) {
        averages[pos].pts += s.pts || 0;
        averages[pos].reb += s.reb || 0;
        averages[pos].ast += s.ast || 0;
        averages[pos].stl += s.stl || 0;
        averages[pos].blk += s.blk || 0;
        averages[pos].count += 1;
      }
    }

    // Compute means
    for (const pos in averages) {
      const cnt = averages[pos].count;
      if (cnt > 0) {
        averages[pos].pts = Number((averages[pos].pts / cnt).toFixed(1));
        averages[pos].reb = Number((averages[pos].reb / cnt).toFixed(1));
        averages[pos].ast = Number((averages[pos].ast / cnt).toFixed(1));
        averages[pos].stl = Number((averages[pos].stl / cnt).toFixed(1));
        averages[pos].blk = Number((averages[pos].blk / cnt).toFixed(1));
      }
      delete averages[pos].count;
    }

    res.json({ success: true, source: 'calculated', averages });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/scrape/league

 * Scrape a league's teams, players, and stats.
 * Body: { slug: "liga-endesa" }
 */
app.post('/api/scrape/league', async (req, res) => {
  try {
    const { slug, season } = req.body;

    if (!slug) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: slug'
      });
    }

    // Check if already scraping (check both scrapers)
    const currentProgress = scraper.getProgress();
    const currentHackaProgress = scraperHackastat.getProgress();
    
    if (currentProgress.status === 'scraping' || currentHackaProgress.status === 'scraping') {
      return res.status(409).json({
        success: false,
        error: 'A scrape is already in progress',
        progress: currentProgress.status === 'scraping' ? currentProgress : currentHackaProgress
      });
    }

    const targetSeason = season || '2025-2026';
    console.log(`[Server] Starting scrape for league: ${slug} (${targetSeason})`);

    // Run scraping asynchronously
    if (scraperHackastat.isHackaStatLeague(slug)) {
      console.log(`[Server] Using Hack a Stat scraper for ${slug}`);
      scraperHackastat.scrapeFullLeague(slug, targetSeason)
        .then(players => {
          console.log(`[Server] Hack a Stat scrape complete: ${players.length} players scraped.`);
        })
        .catch(err => {
          console.error(`[Server] Hack a Stat scrape failed:`, err.message);
        });
    } else {
      console.log(`[Server] Using be-basketball scraper for ${slug}`);
      scraper.scrapeFullLeague(slug, targetSeason)
        .then(players => {
          console.log(`[Server] League scrape complete: ${players.length} players scraped.`);
        })
        .catch(err => {
          console.error(`[Server] League scrape failed:`, err.message);
        });
    }

    // Respond immediately with the status
    res.json({
      success: true,
      message: `Started scraping league: ${slug}`,
      status: 'scraping'
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/scrape/status
 * Return current scraping status and progress.
 */
app.get('/api/scrape/status', (req, res) => {
  try {
    let p = scraper.getProgress();
    const hp = scraperHackastat.getProgress();
    
    // If Hack a Stat is running or recently finished with error/done, prefer it
    if (hp.status !== 'idle' && (p.status === 'idle' || hp.status === 'scraping')) {
      p = hp;
    }

    // Return a flat format the frontend can easily consume
    res.json({
      success: true,
      isRunning: p.status === 'scraping',
      status: p.status,
      league: p.league || '',
      progress: p.scrapedPlayers || 0,
      total: p.totalPlayers || 0,
      scrapedTeams: p.scrapedTeams || 0,
      totalTeams: p.totalTeams || 0,
      currentTask: p.status === 'scraping'
        ? `${p.league}: ${p.currentPlayer || p.currentTeam || 'Procesando.'} (${p.scrapedPlayers}/${p.totalPlayers || '?'})`
        : 'Inactivo',
      errors: p.errors || []
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/compare/by-name
 * Find a player by name and return similar players.
 * Body: { name: "Dario Brizuela", deviation: 1 }
 */
app.post('/api/compare/by-name', (req, res) => {
  try {
    const { name, deviation = 1, season, leagueSlug } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: name'
      });
    }

    const db = scraper.loadDatabase();
    const players = db.players || [];

    if (players.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Database is empty. Please scrape data first or check sample data.'
      });
    }

    const result = statsEngine.findSimilarByName(name, players, deviation, season, leagueSlug);

    if (result.error && !result.target) {
      return res.status(404).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      target: result.target,
      similar: result.similar,
      count: result.similar.length,
      deviation: result.deviation,
      comparableStats: result.comparableStats,
      totalCandidates: result.totalCandidates
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/compare/by-stats
 * Find players matching input stats within ±deviation.
 * Body: { stats: { pts: 15, reb: 7, ast: 3 }, deviation: 1, leagues: [] }
 */
app.post('/api/compare/by-stats', (req, res) => {
  try {
    const { stats, deviation = 1, leagues = [], positions = [], minGP } = req.body;

    if (!stats || Object.keys(stats).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: stats (object with at least one stat)'
      });
    }

    const db = scraper.loadDatabase();
    const players = db.players || [];

    if (players.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Database is empty. Please scrape data first or check sample data.'
      });
    }

    const result = statsEngine.findSimilarByStats(
      stats,
      players,
      deviation,
      { leagues, positions, minGP }
    );

    if (result.error) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      matches: result.matches,
      count: result.matches.length,
      query: result.query,
      deviation: result.deviation,
      searchKeys: result.searchKeys,
      totalCandidates: result.totalCandidates,
      totalDatabase: result.totalDatabase,
      filtersApplied: result.filtersApplied
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/database/clear
 * Clear the database cache file on disk.
 */
app.post('/api/database/clear', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const dataDir = path.join(__dirname, 'data');
    if (fs.existsSync(dataDir)) {
      const files = fs.readdirSync(dataDir);
      const dbFiles = files.filter(f => f.startsWith('players-') && f.endsWith('.json'));
      for (const file of dbFiles) {
        fs.unlinkSync(path.join(dataDir, file));
        console.log(`[Server] Deleted database file: ${file}`);
      }
    }
    res.json({
      success: true,
      message: 'All database season files cleared successfully'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/player/games
 * Scrape or fetch from cache a player's game-by-game log.
 * Body: { slug: "kevin-punter" }
 */
app.post('/api/player/games', async (req, res) => {
  try {
    const { slug, season, leagueSlug } = req.body;
    if (!slug) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: slug'
      });
    }

    // Load database to find the player's average stats
    const db = scraper.loadDatabase();
    const players = db.players || db || [];
    
    // Find player record matching slug, season and leagueSlug
    let playerRecord = null;
    if (season && leagueSlug) {
      playerRecord = players.find(p => p.slug === slug && p.season === season && p.leagueSlug === leagueSlug);
    } else if (season) {
      playerRecord = players.find(p => p.slug === slug && p.season === season);
    } else {
      // If no season specified, take the latest season available for this player
      const playerRecords = players.filter(p => p.slug === slug);
      if (playerRecords.length > 0) {
        playerRecords.sort((a, b) => b.season.localeCompare(a.season));
        playerRecord = playerRecords[0];
      }
    }

    if (!playerRecord) {
      return res.status(404).json({
        success: false,
        error: `Estadísticas medias no encontradas para: ${slug}${season ? ` (${season})` : ''}`
      });
    }

    console.log(`[Server] Requesting game log and matchups for: ${slug} (${playerRecord.season})`);
    
    // Scrape or fetch games from cache
    const games = await scraper.scrapePlayerGames(slug, playerRecord.leagueSlug, playerRecord.season);
    
    // Run matchup analysis using stats-engine
    const analysis = statsEngine.analyzePlayerMatchups(playerRecord, games);
    
    res.json({
      success: true,
      player: {
        name: playerRecord.name,
        slug: playerRecord.slug,
        team: playerRecord.team,
        league: playerRecord.league,
        leagueSlug: playerRecord.leagueSlug,
        season: playerRecord.season,
        position: playerRecord.position,
        averages: playerRecord.stats
      },
      analysis
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/player/:slug/game-advanced', async (req, res) => {
  try {
    const { slug } = req.params;
    const { gameUrl, leagueSlug } = req.query;

    if (!gameUrl || !leagueSlug) {
      return res.status(400).json({
        success: false,
        error: 'Faltan parámetros requeridos: gameUrl y leagueSlug'
      });
    }

    console.log(`[Server] Requesting game advanced stats for player "${slug}" on game: ${gameUrl}`);
    const stats = await scraper.scrapeGameBoxscore(gameUrl, leagueSlug, slug);

    res.json({
      success: true,
      stats
    });
  } catch (err) {
    console.error(`[Server] Error fetching game advanced stats:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Catch-all: serve index.html for SPA routing ─────────────────────────────
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  const fs = require('fs');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({
      success: false,
      error: 'Frontend not found. Place your frontend files in the public/ directory.'
    });
  }
});

// ─── Global error handler ────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message
  });
});

// ─── Start server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏀 Basketball Stats App running on http://localhost:${PORT}`);
  console.log(`   API endpoints:`);
  console.log(`   GET  /api/leagues          — List configured leagues`);
  console.log(`   GET  /api/database          — Get all player data`);
  console.log(`   POST /api/scrape/league     — Scrape a league`);
  console.log(`   GET  /api/scrape/status     — Scraping progress`);
  console.log(`   POST /api/compare/by-name   — Compare by player name`);
  console.log(`   POST /api/compare/by-stats  — Compare by stat values\n`);
});

module.exports = app;
