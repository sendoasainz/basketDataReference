/**
 * scraper-hackastat.js — Puppeteer scraper for hackastat.eu
 * 
 * Scrapes player statistics from Hack a Stat for:
 * - EuroLeague (league_id=1)
 * - EuroCup (league_id=2)  
 * - Liga Endesa / ACB (league_id=3)
 * - Lega Basket Serie A / LBA (league_id=4)
 * - Basketball Champions League / BCL (league_id=5)
 * 
 * Also scrapes league averages by position for comparison charts.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ─── Browser instance (shared with main scraper if available) ─────────────────
let browser = null;

// ─── Hack a Stat configuration ───────────────────────────────────────────────
const HACKASTAT_BASE = 'https://hackastat.eu';

// Map our slug to Hack a Stat league ID
const LEAGUE_ID_MAP = {
  'euroleague': 1,
  'lega-basket-serie-a': 2,
  'eurocup': 3,
  'basketball-champions-league': 4,
  'liga-endesa': 6
};

// Map Hack a Stat league ID to standard league name
const LEAGUE_NAME_MAP = {
  1: 'EuroLeague',
  2: 'LBA',
  3: 'EuroCup',
  4: 'BCL',
  5: 'Domestic Cup',
  6: 'Liga Endesa'
};

const DATA_DIR = path.join(__dirname, 'data');

// ─── Progress tracking ───────────────────────────────────────────────────────
let progress = {
  status: 'idle',
  league: '',
  totalPlayers: 0,
  scrapedPlayers: 0,
  currentPlayer: '',
  errors: [],
  startedAt: null,
  completedAt: null
};

function getProgress() { return { ...progress }; }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function initBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    console.log('[HackAStat] Browser launched.');
  }
  return browser;
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    console.log('[HackAStat] Browser closed.');
  }
}

/**
 * Check if a league slug is supported by Hack a Stat
 */
function isHackaStatLeague(slug) {
  return LEAGUE_ID_MAP.hasOwnProperty(slug);
}

/**
 * Scrape all players for a given league and season from Hack a Stat.
 * Returns an array of player objects in our standard format.
 */
async function scrapeLeaguePlayers(leagueSlug, season = '2025-2026') {
  const leagueId = LEAGUE_ID_MAP[leagueSlug];
  if (!leagueId) {
    throw new Error(`League "${leagueSlug}" is not supported by Hack a Stat scraper`);
  }

  await initBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  progress = {
    status: 'scraping',
    league: LEAGUE_NAME_MAP[leagueId],
    totalPlayers: 0,
    scrapedPlayers: 0,
    currentPlayer: '',
    errors: [],
    startedAt: new Date().toISOString(),
    completedAt: null
  };

  try {
    // Navigate to player stats page with filters
    const url = `${HACKASTAT_BASE}/statistiche-giocatori/?season%5B%5D=${season}&league%5B%5D=${leagueId}`;
    console.log(`[HackAStat] Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for the stats table to load (it's dynamic JavaScript)
    await page.waitForSelector('table', { timeout: 30000 });
    // Give extra time for all data to render
    await delay(3000);

    // Instead of trying to select 'Show All' from a broken datatable, 
    // Hack a Stat uses a .page-jump select element for pagination.
    let playersFound = 0;
    const allPlayers = [];
    
    // Check total pages
    const totalPages = await page.evaluate(() => {
      const select = document.querySelector('select.page-jump');
      if (select && select.options.length > 0) {
        return select.options.length;
      }
      return 1;
    });

    console.log(`[HackAStat] Found ${totalPages} pages for players.`);

    for (let p = 1; p <= totalPages; p++) {
      if (p > 1) {
        // Change page
        await page.evaluate((pageNum) => {
          const select = document.querySelector('select.page-jump');
          if (select) {
            select.value = pageNum;
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, p);
        console.log(`[HackAStat] Loading page ${p}...`);
        await delay(3000); // Wait for the new page to load (network request)
      }

      // Extract player data from current page
      const leagueName = LEAGUE_NAME_MAP[leagueId];
      const pagePlayers = await page.evaluate((leagueName, leagueSlug, season) => {
        const results = [];
        const tables = document.querySelectorAll('table');
        
        for (const table of tables) {
          const headerRow = table.querySelector('thead tr');
          if (!headerRow) continue;
          
          const headers = Array.from(headerRow.querySelectorAll('th'))
            .map(th => th.textContent.trim().toLowerCase());
          
          // Check if this looks like a player stats table (must have player name and GP)
          const hasPlayer = headers.some(h => h.includes('player') || h.includes('giocatore') || h.includes('jugador'));
          const hasGP = headers.some(h => h === 'gp' || h === 'g' || h === 'pj');
          if (!hasPlayer && !hasGP) continue;
          
          const rows = table.querySelectorAll('tbody tr');
          for (const row of rows) {
            const cells = Array.from(row.querySelectorAll('td'));
            if (cells.length < 5) continue;
            
            const playerData = {
              name: '',
              team: '',
              position: '',
              stats: {}
            };
            
            cells.forEach((cell, i) => {
              if (i >= headers.length) return;
              const h = headers[i].toLowerCase().trim();
              const text = cell.textContent.trim();
              
              // Player name
              if (h.includes('player') || h.includes('giocatore') || h.includes('jugador')) {
                playerData.name = text;
                // Try to get player_id from link
                const link = cell.querySelector('a');
                if (link) {
                  const href = link.getAttribute('href') || '';
                  const match = href.match(/player_id=(\d+)/);
                  if (match) playerData.hackAStatId = parseInt(match[1]);
                }
              }
              // Team
              else if (h === 'team' || h === 'squadra' || h === 'equipo') {
                playerData.team = text;
              }
              // Position
              else if (h === 'pos' || h === 'position' || h === 'posizione' || h === 'ruolo') {
                playerData.position = text;
              }
              // Stats
              else {
                let key = null;
                if (h === 'gp' || h === 'g' || h === 'pj') key = 'gp';
                else if (h === 'mpg' || h === 'min' || h === 'mp') key = 'min';
                else if (h === 'pts' || h === 'ppg') key = 'pts';
                else if (h === 'reb' || h === 'rpg' || h === 'trb') key = 'reb';
                else if (h === 'oreb' || h === 'orb' || h === 'or') key = 'oreb';
                else if (h === 'dreb' || h === 'drb' || h === 'dr') key = 'dreb';
                else if (h === 'ast' || h === 'apg') key = 'ast';
                else if (h === 'stl' || h === 'spg') key = 'stl';
                else if (h === 'blk' || h === 'bpg') key = 'blk';
                else if (h === 'tov' || h === 'to') key = 'to';
                else if (h === 'pf') key = 'pf';
                else if (h === 'fg%' || h === 'fgp' || h === 'fg') key = 'fgPct';
                else if (h === '3p%' || h === '3pp' || h === '3fg%') key = 'tpPct';
                else if (h === '2p%' || h === '2pp' || h === '2fg%') key = 'twoPPct';
                else if (h === 'ft%' || h === 'ftp') key = 'ftPct';
                else if (h === 'ts%' || h === 'ts') key = 'tsPct';
                else if (h === 'efg%' || h === 'efg') key = 'efgPct';
                else if (h === '3par' || h === '3pa rate') key = 'tpAr';
                else if (h === 'ftr' || h === 'ft rate') key = 'ftR';
                else if (h === 'orb%' || h === 'or%') key = 'orbPct';
                else if (h === 'drb%' || h === 'dr%') key = 'drbPct';
                else if (h === 'trb%' || h === 'reb%') key = 'trbPct';
                else if (h === 'ast%') key = 'astPct';
                else if (h === 'tov%' || h === 'to%') key = 'toPct';
                else if (h === 'stl%') key = 'stlPct';
                else if (h === 'blk%') key = 'blkPct';
                else if (h === 'usg%' || h === 'usg') key = 'usgPct';
                else if (h === 'per') key = 'per';
                else if (h === 'ws' || h === 'win shares') key = 'ws';
                else if (h === 'bpm' || h === 'box plus/minus') key = 'bpm';
                else if (h === 'vorp') key = 'vorp';
                else if (h === 'pir' || h === 'val') key = 'pir';
                else if (h === 'eff' || h === 'eval') key = 'eval';
  
                if (key) {
                  const val = parseFloat(text.replace('%', '').replace(',', '.'));
                  if (!isNaN(val)) playerData.stats[key] = val;
                }
              }
            });
            
            if (playerData.name && playerData.team) {
              const baseSlug = playerData.name.toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9\s-]/g, '')
                .trim().replace(/\s+/g, '-');
                
              playerData.slug = baseSlug;
              playerData.league = leagueName;
              playerData.leagueSlug = leagueSlug;
              playerData.season = season;
              results.push(playerData);
            }
          }
        }
        return results;
      }, leagueName, leagueSlug, season);
      
      allPlayers.push(...pagePlayers);
      playersFound += pagePlayers.length;
    }
    
    console.log(`[HackAStat] Extracted ${playersFound} players across ${totalPages} pages.`);
    progress.totalPlayers = playersFound;
    
    // We already have allPlayers, just assign it to players
    const players = allPlayers;

    // Convert to our standard format
    const standardPlayers = players.map(p => {
      // Normalize position
      let position = (p.position || '').toLowerCase();
      if (position.includes('guard') || position === 'g' || position === 'pg' || position === 'sg') {
        position = 'Guard';
      } else if (position.includes('forward') || position === 'f' || position === 'sf' || position === 'pf') {
        position = 'Forward';
      } else if (position.includes('center') || position === 'c') {
        position = 'Center';
      } else if (position.includes('g-f') || position.includes('f-g')) {
        position = 'Guard-Forward';
      } else if (position.includes('f-c') || position.includes('c-f')) {
        position = 'Forward-Center';
      }

      // Generate slug from name
      const slug = p.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

      return {
        slug: slug,
        name: p.name,
        position: position,
        height: '',
        age: null,
        nationality: '',
        team: p.team,
        teamSlug: '',
        league: LEAGUE_NAME_MAP[leagueId],
        leagueSlug: leagueSlug,
        season: season,
        hackAStatId: p.hackAStatId || null,
        source: 'hackastat',
        stats: {
          gp: p.stats.gp || 0,
          min: p.stats.min || 0,
          pts: p.stats.pts || 0,
          reb: p.stats.reb || 0,
          oreb: p.stats.oreb || 0,
          dreb: p.stats.dreb || 0,
          ast: p.stats.ast || 0,
          stl: p.stats.stl || 0,
          blk: p.stats.blk || 0,
          to: p.stats.to || 0,
          pf: p.stats.pf || 0,
          fgPct: p.stats.fgPct || 0,
          tpPct: p.stats.tpPct || 0,
          twoPPct: p.stats.twoPPct || 0,
          ftPct: p.stats.ftPct || 0,
          eval: p.stats.eval || 0,
          pir: p.stats.pir || p.stats.eval || 0,
          pie: p.stats.pie || 0,
          usgPct: p.stats.usgPct || 0,
          poss: p.stats.poss || 0,
          tsPct: p.stats.tsPct || 0,
          efgPct: p.stats.efgPct || 0,
          tpAr: p.stats.tpAr || 0,
          ftR: p.stats.ftR || 0,
          orbPct: p.stats.orbPct || 0,
          drbPct: p.stats.drbPct || 0,
          trbPct: p.stats.trbPct || 0,
          astPct: p.stats.astPct || 0,
          toPct: p.stats.toPct || 0,
          astToRatio: p.stats.to > 0 ? (p.stats.ast / p.stats.to) : 0,
          stlPct: p.stats.stlPct || 0,
          blkPct: p.stats.blkPct || 0,
          // Advanced stats from Hack a Stat
          per: p.stats.per || 0,
          ws: p.stats.ws || 0,
          bpm: p.stats.bpm || 0,
          vorp: p.stats.vorp || 0
        }
      };
    });

    progress.scrapedPlayers = standardPlayers.length;
    progress.status = 'done';
    progress.completedAt = new Date().toISOString();

    console.log(`[HackAStat] Successfully scraped ${standardPlayers.length} players for ${LEAGUE_NAME_MAP[leagueId]}.`);
    return standardPlayers;

  } catch (err) {
    console.error(`[HackAStat] Error scraping league "${leagueSlug}":`, err.message);
    progress.status = 'error';
    progress.errors.push({ type: 'league', slug: leagueSlug, error: err.message });
    return [];
  } finally {
    await page.close();
  }
}

/**
 * Scrape league averages by position from Hack a Stat.
 * Returns an object: { "Guard": { pts: X, reb: Y, ... }, "Forward": { ... }, "Center": { ... } }
 */
async function scrapeLeagueAverages(leagueSlug, season = '2025-2026') {
  const leagueId = LEAGUE_ID_MAP[leagueSlug];
  if (!leagueId) return null;

  await initBrowser();
  const page = await browser.newPage();

  try {
    const url = `${HACKASTAT_BASE}/medie-lega/?season%5B%5D=${season}&league%5B%5D=${leagueId}`;
    console.log(`[HackAStat] Scraping league averages: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('table', { timeout: 30000 });
    await delay(3000);

    const averages = await page.evaluate(() => {
      const result = {};
      const tables = document.querySelectorAll('table');
      
      for (const table of tables) {
        const headerRow = table.querySelector('thead tr');
        if (!headerRow) continue;
        
        const headers = Array.from(headerRow.querySelectorAll('th'))
          .map(th => th.textContent.trim().toLowerCase());
        
        const rows = table.querySelectorAll('tbody tr');
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('td'));
          if (cells.length < 3) continue;
          
          const rowData = {};
          let category = '';
          
          cells.forEach((cell, i) => {
            if (i >= headers.length) return;
            const h = headers[i].toLowerCase().trim();
            const text = cell.textContent.trim();
            
            if (h.includes('pos') || h.includes('ruolo') || h.includes('position')) {
              category = text;
            } else {
              const val = parseFloat(text.replace('%', '').replace(',', '.'));
              if (!isNaN(val)) {
                let key = null;
                if (h === 'pts' || h === 'ppg') key = 'pts';
                else if (h === 'reb' || h === 'trb') key = 'reb';
                else if (h === 'ast') key = 'ast';
                else if (h === 'stl') key = 'stl';
                else if (h === 'blk') key = 'blk';
                else if (h === 'tov' || h === 'to') key = 'to';
                else if (h === 'fg%') key = 'fgPct';
                else if (h === '3p%') key = 'tpPct';
                else if (h === 'ft%') key = 'ftPct';
                else if (h === 'ts%') key = 'tsPct';
                else if (h === 'usg%') key = 'usgPct';
                else if (h === 'per') key = 'per';
                else if (h === 'min' || h === 'mpg') key = 'min';
                if (key) rowData[key] = val;
              }
            }
          });
          
          if (category && Object.keys(rowData).length > 0) {
            result[category] = rowData;
          }
        }
        
        if (Object.keys(result).length > 0) break;
      }
      
      return result;
    });

    console.log(`[HackAStat] League averages scraped: ${Object.keys(averages).length} categories.`);
    return averages;

  } catch (err) {
    console.error(`[HackAStat] Error scraping league averages:`, err.message);
    return null;
  } finally {
    await page.close();
  }
}

/**
 * Scrape RAPM data for a league from Hack a Stat.
 * Returns a map: { "player-slug": { offRapm: X, defRapm: Y, totalRapm: Z } }
 */
async function scrapeRAPM(leagueSlug, season = '2025-2026') {
  const leagueId = LEAGUE_ID_MAP[leagueSlug];
  if (!leagueId) return {};

  await initBrowser();
  const page = await browser.newPage();

  try {
    const url = `${HACKASTAT_BASE}/rapm-giocatori/?season%5B%5D=${season}&league%5B%5D=${leagueId}`;
    console.log(`[HackAStat] Scraping RAPM: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('table', { timeout: 30000 });
    await delay(3000);

    const rapmData = await page.evaluate(() => {
      const result = {};
      const tables = document.querySelectorAll('table');
      
      for (const table of tables) {
        const headerRow = table.querySelector('thead tr');
        if (!headerRow) continue;
        
        const headers = Array.from(headerRow.querySelectorAll('th'))
          .map(th => th.textContent.trim().toLowerCase());
        
        const hasPlayer = headers.some(h => h.includes('player') || h.includes('giocatore'));
        if (!hasPlayer) continue;
        
        const rows = table.querySelectorAll('tbody tr');
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('td'));
          if (cells.length < 3) continue;
          
          let playerName = '';
          const rapm = {};
          
          cells.forEach((cell, i) => {
            if (i >= headers.length) return;
            const h = headers[i].toLowerCase().trim();
            const text = cell.textContent.trim();
            
            if (h.includes('player') || h.includes('giocatore')) {
              playerName = text;
            } else {
              const val = parseFloat(text.replace(',', '.'));
              if (!isNaN(val)) {
                if (h.includes('o-rapm') || h.includes('off')) rapm.offRapm = val;
                else if (h.includes('d-rapm') || h.includes('def')) rapm.defRapm = val;
                else if (h.includes('rapm') || h.includes('total')) rapm.totalRapm = val;
              }
            }
          });
          
          if (playerName && Object.keys(rapm).length > 0) {
            const slug = playerName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            result[slug] = rapm;
          }
        }
        
        if (Object.keys(result).length > 0) break;
      }
      
      return result;
    });

    console.log(`[HackAStat] RAPM data scraped: ${Object.keys(rapmData).length} players.`);
    return rapmData;

  } catch (err) {
    console.error(`[HackAStat] Error scraping RAPM:`, err.message);
    return {};
  } finally {
    await page.close();
  }
}

const mainScraper = require('./scraper');

/**
 * Full scrape pipeline for a Hack a Stat league.
 * 1. Scrape all players
 * 2. Scrape RAPM data and merge
 * 3. Scrape league averages and save separately
 * 4. Merge players with existing database and save
 */
async function scrapeFullLeague(leagueSlug, season = '2025-2026') {
  console.log(`[HackAStat] ═══ Starting full scrape for ${LEAGUE_NAME_MAP[LEAGUE_ID_MAP[leagueSlug]]} (${season}) ═══`);
  
  // 1. Get all players
  const players = await scrapeLeaguePlayers(leagueSlug, season);
  if (players.length === 0) {
    console.log('[HackAStat] No players found. Aborting.');
    return [];
  }

  // 2. Get RAPM data and merge into players
  const rapmData = await scrapeRAPM(leagueSlug, season);
  let rapmMerged = 0;
  for (const player of players) {
    const rapm = rapmData[player.slug];
    if (rapm) {
      player.stats.offRapm = rapm.offRapm || 0;
      player.stats.defRapm = rapm.defRapm || 0;
      player.stats.trueNetRtg = rapm.totalRapm || 0;
      rapmMerged++;
    }
  }
  console.log(`[HackAStat] Merged RAPM data for ${rapmMerged}/${players.length} players.`);

  // 3. Get league averages and save
  const averages = await scrapeLeagueAverages(leagueSlug, season);
  if (averages) {
    const avgPath = path.join(DATA_DIR, `league-averages-${leagueSlug}.json`);
    fs.writeFileSync(avgPath, JSON.stringify(averages, null, 2));
    console.log(`[HackAStat] League averages saved to ${avgPath}`);
  }

  // 4. Merge with existing database and save
  const seasonFilePath = path.join(DATA_DIR, `players-${season}.json`);
  let existingPlayers = [];
  if (fs.existsSync(seasonFilePath)) {
    try {
      const raw = fs.readFileSync(seasonFilePath, 'utf-8');
      const data = JSON.parse(raw);
      existingPlayers = data.players || [];
    } catch (err) {
      console.error(`[HackAStat] Error loading season file ${seasonFilePath}:`, err.message);
    }
  }

  // Remove old data for this league in this specific season, keep others
  // DANGEROUS: This was overwriting be-basketball data with worse HackAStat data
  // const otherLeaguePlayers = existingPlayers.filter(p => p.leagueSlug !== leagueSlug);
  // const mergedPlayers = [...otherLeaguePlayers, ...players];
  // mainScraper.saveDatabase(mergedPlayers, season);

  console.log(`[HackAStat] 🏀 Scrape complete: ${players.length} players 🏀`);
  return players;
}

module.exports = {
  isHackaStatLeague,
  scrapeLeaguePlayers,
  scrapeLeagueAverages,
  scrapeRAPM,
  scrapeFullLeague,
  getProgress,
  initBrowser,
  closeBrowser,
  LEAGUE_ID_MAP,
  LEAGUE_NAME_MAP
};
