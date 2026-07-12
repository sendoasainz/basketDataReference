/**
 * scraper.js — Puppeteer scraper module for be-basketball.com
 * 
 * Handles browser management, team/player/stats scraping,
 * caching, and progress tracking.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ─── Singleton browser instance ───────────────────────────────────────────────
let browser = null;

// ─── Progress tracking ───────────────────────────────────────────────────────
let progress = {
  status: 'idle',        // idle | scraping | done | error
  league: '',
  totalTeams: 0,
  scrapedTeams: 0,
  totalPlayers: 0,
  scrapedPlayers: 0,
  currentTeam: '',
  currentPlayer: '',
  errors: [],
  startedAt: null,
  completedAt: null
};

// ─── League configurations ────────────────────────────────────────────────────
const LEAGUES = [
  { name: 'EuroLeague', slug: 'euroleague' },
  { name: 'EuroCup', slug: 'eurocup' },
  { name: 'Liga Endesa', slug: 'liga-endesa' },
  { name: 'Betclic ELITE', slug: 'betclic-elite' },
  { name: 'Lega Basket Serie A', slug: 'lega-basket-serie-a' },
  { name: 'ESAKE', slug: 'esake' },
  { name: 'ABA Liga', slug: 'aba-liga' },
  { name: 'Basketball Champions League', slug: 'basketball-champions-league' },
  { name: 'FIBA Europe Cup', slug: 'fiba-europe-cup' },
  { name: 'Primera FEB', slug: 'primera-feb' },
  { name: 'BNXT League', slug: 'bnxt-league' },
  { name: 'BSL (Turquía)', slug: 'basketbol-super-ligi' },
  { name: 'LKL (Lituania)', slug: 'betsafe-lkl' },
  { name: 'BBL (Alemania)', slug: 'easycredit-bbl' },
  { name: 'G League', slug: 'g-league' },
  { name: 'Orlen Basket Liga', slug: 'orlen-basket-liga' }
];

// ─── Cache paths ──────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'players-db.json');
const SAMPLE_PATH = path.join(DATA_DIR, 'sample-players.json');

// ─── Base URL ─────────────────────────────────────────────────────────────────
const BASE_URL = 'https://www.be-basketball.com';
const DBASKET_BASE_URL = 'https://dbasket.net';

// ─── Delay helper ─────────────────────────────────────────────────────────────
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Season normalization ──────────────────────────────────────
function normalizeSeason(seasonStr) {
  if (!seasonStr) return null;
  const cleaned = seasonStr.replace(/\//g, '-').trim();
  if (cleaned.match(/^(26-27|2026-2027|26\/27)$/)) return '2026-2027';
  if (cleaned.match(/^(25-26|2025-2026|25\/26)$/)) return '2025-2026';
  if (cleaned.match(/^(24-25|2024-2025|24\/25)$/)) return '2024-2025';
  return null; // Discard older/other seasons
}

// ─── Competition slug mapping ──────────────────────────────────
const COMPETITION_SLUG_MAP = {
  'el': 'euroleague',
  'euroleague': 'euroleague',
  'ec': 'eurocup',
  'eurocup': 'eurocup',
  'acb': 'liga-endesa',
  'liga-endesa': 'liga-endesa',
  'liga endesa': 'liga-endesa',
  'esp': 'liga-endesa',
  'esp 1': 'liga-endesa',
  'be': 'betclic-elite',
  'betclic-elite': 'betclic-elite',
  'betclic elite': 'betclic-elite',
  'fra': 'betclic-elite',
  'fra 1': 'betclic-elite',
  'lnb': 'betclic-elite',
  'lba': 'lega-basket-serie-a',
  'lega-basket-serie-a': 'lega-basket-serie-a',
  'lega basket serie a': 'lega-basket-serie-a',
  'ita': 'lega-basket-serie-a',
  'ita 1': 'lega-basket-serie-a',
  'gbl': 'esake',
  'esake': 'esake',
  'grc': 'esake',
  'grc 1': 'esake',
  'aba': 'aba-liga',
  'aba-liga': 'aba-liga',
  'aba liga': 'aba-liga',
  'bcl': 'basketball-champions-league',
  'basketball-champions-league': 'basketball-champions-league',
  'basketball champions league': 'basketball-champions-league',
  'fec': 'fiba-europe-cup',
  'fiba-europe-cup': 'fiba-europe-cup',
  'fiba europe cup': 'fiba-europe-cup',
  'fiba ec': 'fiba-europe-cup',
  'bnxt': 'bnxt-league',
  'bnxt-league': 'bnxt-league',
  'bnxt league': 'bnxt-league',
  'bsl': 'basketbol-super-ligi',
  'basketbol-super-ligi': 'basketbol-super-ligi',
  'basketbol super ligi': 'basketbol-super-ligi',
  'tur': 'basketbol-super-ligi',
  'tur 1': 'basketbol-super-ligi',
  'lkl': 'betsafe-lkl',
  'betsafe-lkl': 'betsafe-lkl',
  'betsafe lkl': 'betsafe-lkl',
  'ltu': 'betsafe-lkl',
  'ltu 1': 'betsafe-lkl',
  'bbl': 'easycredit-bbl',
  'easycredit-bbl': 'easycredit-bbl',
  'easycredit bbl': 'easycredit-bbl',
  'deu': 'easycredit-bbl',
  'deu 1': 'easycredit-bbl',
  'ger': 'easycredit-bbl',
  'ger 1': 'easycredit-bbl',
  'g-league': 'g-league',
  'g league': 'g-league',
  'g-lg': 'g-league',
  'glg': 'g-league',
  'usa g': 'g-league'
};

function getLeagueByCompetition(compText) {
  if (!compText) return null;
  const cleaned = compText.toLowerCase().trim();
  const slug = COMPETITION_SLUG_MAP[cleaned];
  if (slug) {
    const found = LEAGUES.find(l => l.slug === slug);
    return found ? { name: found.name, slug: found.slug } : null;
  }
  return null;
}

let teamLeagueMap = null;

function getLeagueForCareerTeam(teamName, defaultLeague, defaultLeagueSlug) {
  if (!teamName) return null; // Cannot identify league without team name
  const teamLower = teamName.toLowerCase().trim();
  
  const staticMap = {
    'ewe': { name: 'BBL (Alemania)', slug: 'easycredit-bbl' },
    'nap': { name: 'Lega Basket Serie A', slug: 'lega-basket-serie-a' },
    'bil': { name: 'Liga Endesa', slug: 'liga-endesa' },
    'jov': { name: 'Liga Endesa', slug: 'liga-endesa' },
    'bar': { name: 'Liga Endesa', slug: 'liga-endesa' },
    'rea': { name: 'Liga Endesa', slug: 'liga-endesa' },
    'mal': { name: 'Liga Endesa', slug: 'liga-endesa' },
    'unicaja': { name: 'Liga Endesa', slug: 'liga-endesa' },
    'spb': { name: 'Liga Endesa', slug: 'liga-endesa' },
    'and': { name: 'Liga Endesa', slug: 'liga-endesa' },
    'man': { name: 'Liga Endesa', slug: 'liga-endesa' },
    'zar': { name: 'Liga Endesa', slug: 'liga-endesa' },
    'bas': { name: 'Liga Endesa', slug: 'liga-endesa' },
    'gir': { name: 'Liga Endesa', slug: 'liga-endesa' },
    'ten': { name: 'Liga Endesa', slug: 'liga-endesa' }
  };
  
  if (staticMap[teamLower]) return staticMap[teamLower];
  
  if (!teamLeagueMap) {
    teamLeagueMap = {};
    try {
      const db = loadDatabase();
      const list = db.players || db || [];
      list.forEach(p => {
        if (p.teamSlug && p.teamSlug !== '' && p.team && p.leagueSlug) {
          const tName = p.team.toLowerCase().trim();
          teamLeagueMap[tName] = { name: p.league, slug: p.leagueSlug };
        }
      });
    } catch (e) {
      // Ignore
    }
  }
  
  if (teamLeagueMap[teamLower]) return teamLeagueMap[teamLower];
  
  for (const [tName, info] of Object.entries(teamLeagueMap)) {
    if (tName.includes(teamLower) || teamLower.includes(tName)) {
      return info;
    }
  }
  
  // CRITICAL: Return null instead of defaulting to context league.
  // This prevents a BSL team from being tagged as Liga Endesa, etc.
  return null;
}

// ─── Browser management ──────────────────────────────────────────────────────

/**
 * Launch Puppeteer headless browser (singleton).
 */
async function initBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
    console.log('[Scraper] Browser launched.');
  }
  return browser;
}

/**
 * Close the browser instance.
 */
async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    console.log('[Scraper] Browser closed.');
  }
}

// ─── Data persistence ─────────────────────────────────────────────────────────

/**
 * Load cached player database from disk.
 * Falls back to sample data if no cache exists.
 */
function loadDatabase() {
  try {
    // 1. Check for old players-db.json and migrate it
    const oldDbPath = path.join(DATA_DIR, 'players-db.json');
    if (fs.existsSync(oldDbPath)) {
      console.log('[Scraper] Old single database file found. Migrating to season-partitioned files...');
      try {
        const raw = fs.readFileSync(oldDbPath, 'utf-8');
        const data = JSON.parse(raw);
        const players = data.players || [];
        
        // Group by season
        const bySeason = {};
        for (const p of players) {
          if (!p.season) continue;
          if (!bySeason[p.season]) bySeason[p.season] = [];
          bySeason[p.season].push(p);
        }
        
        // Write separate files
        for (const [season, seasonPlayers] of Object.entries(bySeason)) {
          const seasonFilePath = path.join(DATA_DIR, `players-${season}.json`);
          fs.writeFileSync(seasonFilePath, JSON.stringify({
            players: seasonPlayers,
            timestamp: new Date().toISOString(),
            source: 'migrated'
          }, null, 2), 'utf-8');
          console.log(`[Scraper] Migrated ${seasonPlayers.length} players for season ${season} to ${seasonFilePath}`);
        }
        
        // Rename old file so we don't migrate again
        fs.renameSync(oldDbPath, path.join(DATA_DIR, 'players-db.old.json'));
        console.log('[Scraper] Migration completed. players-db.json renamed to players-db.old.json');
      } catch (migrationErr) {
        console.error('[Scraper] Error migrating database:', migrationErr.message);
      }
    }

    // 2. Scan for players-[season].json files
    if (fs.existsSync(DATA_DIR)) {
      const files = fs.readdirSync(DATA_DIR);
      const dbFiles = files.filter(f => f.startsWith('players-') && f.endsWith('.json') && f !== 'players-db.old.json');
      
      if (dbFiles.length > 0) {
        let allPlayers = [];
        let newestTimestamp = null;
        
        for (const file of dbFiles) {
          const filePath = path.join(DATA_DIR, file);
          const raw = fs.readFileSync(filePath, 'utf-8');
          const data = JSON.parse(raw);
          const players = data.players || [];
          allPlayers = allPlayers.concat(players);
          
          if (!newestTimestamp || (data.timestamp && data.timestamp > newestTimestamp)) {
            newestTimestamp = data.timestamp;
          }
        }
        
        console.log(`[Scraper] Loaded ${allPlayers.length} players from ${dbFiles.length} season files.`);
        return {
          players: allPlayers,
          timestamp: newestTimestamp || new Date().toISOString(),
          source: 'scraped'
        };
      }
    }
  } catch (err) {
    console.error('[Scraper] Error loading season files:', err.message);
  }

  // Fallback to sample data
  try {
    if (fs.existsSync(SAMPLE_PATH)) {
      const raw = fs.readFileSync(SAMPLE_PATH, 'utf-8');
      const players = JSON.parse(raw);
      console.log(`[Scraper] Loaded ${players.length} players from sample data.`);
      return {
        players,
        timestamp: new Date().toISOString(),
        source: 'sample'
      };
    }
  } catch (err) {
    console.error('[Scraper] Error loading sample data:', err.message);
  }

  return { players: [], timestamp: new Date().toISOString(), source: 'empty' };
}

/**
 * Save player database to disk partitioned by season.
 */
function saveDatabase(players, season) {
  if (!season) {
    throw new Error('No target season specified for saveDatabase');
  }

  // Deduplicate list to keep only one record per player per season per league
  const uniqueMap = new Map();
  for (const p of players) {
    if (!p.slug || !p.season || !p.leagueSlug) continue;
    const key = `${p.slug}_${p.season}_${p.leagueSlug}`;
    if (uniqueMap.has(key)) {
      const existing = uniqueMap.get(key);
      const isExistingAbbr = existing.team && existing.team.length <= 3;
      const isNewAbbr = p.team && p.team.length <= 3;
      if (isExistingAbbr && !isNewAbbr) {
        uniqueMap.set(key, p);
      }
    } else {
      uniqueMap.set(key, p);
    }
  }
  const cleanPlayers = Array.from(uniqueMap.values());

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const seasonFilePath = path.join(DATA_DIR, `players-${season}.json`);

  const data = {
    players: cleanPlayers,
    timestamp: new Date().toISOString(),
    source: 'scraped'
  };

  fs.writeFileSync(seasonFilePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`[Scraper] Saved ${cleanPlayers.length} players to ${seasonFilePath}.`);
  return data;
}

// ─── Scraping functions ──────────────────────────────────────────────────────

/**
 * Scrape all team links from a league's players page.
 * URL: https://www.be-basketball.com/league/{slug}/players
 * 
 * @param {string} slug - League slug (e.g. 'liga-endesa')
 * @returns {Array<{name: string, slug: string}>}
 */
async function scrapeLeagueTeams(slug) {
  const page = await browser.newPage();
  const url = `${BASE_URL}/league/${slug}/players`;

  try {
    console.log(`[Scraper] Navigating to league page: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for content to render — try multiple selectors
    const selectors = [
      'a[href*="/team/"]',
      '.team-link',
      '[class*="team"]',
      'a[href*="team"]'
    ];

    let found = false;
    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout: 10000 });
        found = true;
        break;
      } catch {
        // Try next selector
      }
    }

    if (!found) {
      console.warn(`[Scraper] No team selectors found on ${url}. Attempting generic extraction.`);
    }

    // Extract team links from the page
    const teams = await page.evaluate((baseUrl) => {
      const links = Array.from(document.querySelectorAll('a[href*="/team/"]'));
      const teamMap = new Map();

      for (const link of links) {
        const href = link.getAttribute('href') || '';
        // Extract slug from href like /team/fc-barcelona or full URL
        const match = href.match(/\/team\/([a-z0-9-]+)/i);
        if (match) {
          const slug = match[1].toLowerCase();
          const name = link.textContent.trim() || slug;
          if (!teamMap.has(slug) && slug !== '') {
            teamMap.set(slug, { name, slug });
          }
        }
      }

      return Array.from(teamMap.values());
    }, BASE_URL);

    console.log(`[Scraper] Found ${teams.length} teams in league "${slug}".`);
    return teams;

  } catch (err) {
    console.error(`[Scraper] Error scraping league teams for "${slug}":`, err.message);
    progress.errors.push({ type: 'league', slug, error: err.message });
    return [];
  } finally {
    await page.close();
  }
}

/**
 * Scrape all player links from a team's players page.
 * URL: https://www.be-basketball.com/team/{teamSlug}/players
 * 
 * @param {string} teamSlug - Team slug (e.g. 'fc-barcelona')
 * @returns {Array<{name: string, slug: string}>}
 */
async function scrapeTeamPlayers(teamSlug) {
  const page = await browser.newPage();
  const url = `${BASE_URL}/team/${teamSlug}/players`;

  try {
    console.log(`[Scraper] Navigating to team page: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for player links to render
    const selectors = [
      'a[href*="/player/"]',
      '.player-link',
      '[class*="player"]',
      'a[href*="player"]'
    ];

    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout: 10000 });
        break;
      } catch {
        // Try next selector
      }
    }

    // Extract player links
    const players = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/player/"]'));
      const playerMap = new Map();

      // Non-player slugs to filter out (navigation links, sections, etc.)
      const FAKE_SLUGS = new Set([
        'scouting', 'records', 'record', 'stats', 'statistics',
        'news', 'schedule', 'roster', 'standings', 'results',
        'highlights', 'videos', 'photos', 'gallery', 'about',
        'contact', 'tickets', 'shop', 'store', 'history',
        'career', 'career-stats', 'profile', 'team', 'teams',
        'league', 'leagues', 'search', 'home', 'login', 'register'
      ]);

      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const match = href.match(/\/player\/([a-z0-9-]+)/i);
        if (match) {
          const slug = match[1].toLowerCase();
          const name = link.textContent.trim() || slug;
          // Filter out navigation/non-player links
          if (!playerMap.has(slug) && slug !== '' &&
              !FAKE_SLUGS.has(slug) &&
              !slug.includes('career') && !slug.includes('stat') &&
              name.length > 1 && name !== slug) {
            playerMap.set(slug, { name, slug });
          }
        }
      }

      return Array.from(playerMap.values());
    });

    console.log(`[Scraper] Found ${players.length} players in team "${teamSlug}".`);
    return players;

  } catch (err) {
    console.error(`[Scraper] Error scraping team players for "${teamSlug}":`, err.message);
    progress.errors.push({ type: 'team', slug: teamSlug, error: err.message });
    return [];
  } finally {
    await page.close();
  }
}

/**
 * Parse a stat value from text, handling percentages and special formats.
 */
function parseStatValue(text) {
  if (!text || text === '-' || text === 'N/A' || text === '') return null;
  const cleaned = text.replace('%', '').replace(',', '.').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Scrape a player's stats from their profile page.
 * URL: https://www.be-basketball.com/player/{playerSlug}
 * 
 * @param {string} playerSlug - Player slug (e.g. 'dario-brizuela')
 * @param {object} context - Optional context (team name, league, etc.)
 * @returns {object|null} Player data with bio and stats
 */
async function scrapePlayerStats(playerSlug, context = {}) {
  const page = await browser.newPage();
  const url = `${BASE_URL}/player/${playerSlug}`;

  try {
    console.log(`[Scraper] Scraping player: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for content
    const contentSelectors = [
      'table',
      '.stats-table',
      '[class*="stat"]',
      '[class*="player"]',
      '.player-info',
      'h1'
    ];

    for (const sel of contentSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 10000 });
        break;
      } catch {
        // Try next
      }
    }

    // Extract bio information
    const bio = await page.evaluate(() => {
      const result = {
        name: '',
        position: '',
        height: '',
        age: null,
        nationality: '',
        team: ''
      };

      // Try to get player name from h1 or specific selectors
      const nameSelectors = [
        'h1',
        '.player-name',
        '[class*="player-name"]',
        '[class*="playerName"]'
      ];
      for (const sel of nameSelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) {
          const rawName = el.textContent.trim();
          result.name = rawName.split(':')[0].trim();
          break;
        }
      }

      // Extract info from common patterns
      const allText = document.body.innerText;
      
      // Position
      const posMatch = allText.match(/Position[:\s]*(Guard|Forward|Center|Point Guard|Shooting Guard|Small Forward|Power Forward|Center-Forward|Guard-Forward)/i);
      if (posMatch) result.position = posMatch[1];

      // Height
      const heightMatch = allText.match(/Height[:\s]*(\d+\.\d+\s*m|\d+\s*cm)/i);
      if (heightMatch) result.height = heightMatch[1];

      // Age
      const ageMatch = allText.match(/Age[:\s]*(\d+)/i);
      if (ageMatch) result.age = parseInt(ageMatch[1]);

      // Nationality
      const natMatch = allText.match(/Nationality[:\s]*([A-Za-z\s]+?)(?:\n|$)/i);
      if (natMatch) result.nationality = natMatch[1].trim();

      // Look for info in structured elements
      const infoItems = document.querySelectorAll('[class*="info"] span, [class*="info"] div, [class*="bio"] span, [class*="detail"] span');
      for (const item of infoItems) {
        const text = item.textContent.trim();
        if (text.match(/^\d+\.\d+\s*m$/)) result.height = text;
        if (text.match(/^(Guard|Forward|Center)/i)) result.position = text;
      }

      return result;
    });

    // Extract stats from tables
    const stats = await page.evaluate(() => {
      const statData = [];

      // Try to find stats tables
      const tables = document.querySelectorAll('table, .stats-table, [class*="stats"]');
      
      for (const table of tables) {
        // Get headers
        const headerRow = table.querySelector('thead tr, tr:first-child');
        if (!headerRow) continue;

        const headers = Array.from(headerRow.querySelectorAll('th, td'))
          .map(th => th.textContent.trim().toLowerCase());

        // Get data rows
        const bodyRows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
        for (const row of bodyRows) {
          const cells = Array.from(row.querySelectorAll('td, th'));
          if (cells.length < 3) continue;

          const rowData = {};
          cells.forEach((cell, i) => {
            if (i < headers.length) {
              const rawHeader = headers[i].toLowerCase().trim();
              let key = null;
              
              // Direct exact matches first
              if (rawHeader === 'gp' || rawHeader === 'g' || rawHeader === 'games' || rawHeader === 'pj') key = 'gp';
              else if (rawHeader === 'min' || rawHeader === 'mpg' || rawHeader === 'minutes') key = 'min';
              else if (rawHeader === 'pts' || rawHeader === 'ppg' || rawHeader === 'points') key = 'pts';
              else if (rawHeader === 'reb' || rawHeader === 'rpg' || rawHeader === 'rebounds') key = 'reb';
              else if (rawHeader === 'oreb' || rawHeader === 'or' || rawHeader === 'ro') key = 'oreb';
              else if (rawHeader === 'dreb' || rawHeader === 'dr' || rawHeader === 'rd') key = 'dreb';
              else if (rawHeader === 'ast' || rawHeader === 'apg' || rawHeader === 'assists') key = 'ast';
              else if (rawHeader === 'stl' || rawHeader === 'spg' || rawHeader === 'steals') key = 'stl';
              else if (rawHeader === 'blk' || rawHeader === 'bpg' || rawHeader === 'blocks') key = 'blk';
              else if (rawHeader === 'to' || rawHeader === 'tov' || rawHeader === 'turnovers') key = 'to';
              else if (rawHeader === 'pf' || rawHeader === 'fouls') key = 'pf';
              else if (rawHeader === 'fg' || rawHeader === 'fg%' || rawHeader === 'fgpct' || rawHeader === 'fg pct') key = 'fgPct';
              else if (rawHeader === '3pts' || rawHeader === '3p%' || rawHeader === '3pt%' || rawHeader === '3ppct') key = 'tpPct';
              else if (rawHeader === '2pts' || rawHeader === '2p%' || rawHeader === '2pt%' || rawHeader === '2ppct') key = 'twoPPct';
              else if (rawHeader === 'ft' || rawHeader === 'ft%' || rawHeader === 'ftpct') key = 'ftPct';
              else if (rawHeader === 'eval' || rawHeader === 'eff') key = 'eval';
              else if (rawHeader === 'pir') key = 'pir';
              else if (rawHeader === 'pie') key = 'pie';
              else if (rawHeader === 'poss.' || rawHeader === 'poss') key = 'poss';
              else if (rawHeader === '3par') key = 'tpAr';
              else if (rawHeader === 'ftr') key = 'ftR';
              else if (rawHeader === 'orb%') key = 'orbPct';
              else if (rawHeader === 'drb%') key = 'drbPct';
              else if (rawHeader === 'trb%') key = 'trbPct';
              else if (rawHeader === 'ast%') key = 'astPct';
              else if (rawHeader === 'to%') key = 'toPct';
              else if (rawHeader === 'ast-to rat.' || rawHeader === 'ast-to ratio' || rawHeader === 'ast-to rat') key = 'astToRatio';
              else if (rawHeader === 'stl%') key = 'stlPct';
              else if (rawHeader === 'blk%') key = 'blkPct';
              else if (rawHeader === 'team' || rawHeader === 'equipe' || rawHeader === 'équipe') key = 'team';
              else if (rawHeader === 'comp' || rawHeader === 'competition' || rawHeader === 'league' || rawHeader === 'ligue') key = 'competition';
              else if (rawHeader === 'season' || rawHeader === 'saison') key = 'season';
              else if (rawHeader === 'ts%' || rawHeader === 'tspct') key = 'tsPct';
              else if (rawHeader === 'efg%' || rawHeader === 'efgpct') key = 'efgPct';
              else if (rawHeader === 'usg%' || rawHeader === 'usgpct') key = 'usgPct';

              if (key) {
                const text = cell.textContent.trim();
                if (key === 'team' || key === 'competition' || key === 'season') {
                  rowData[key] = text;
                  if (key === 'competition') {
                    const link = cell.querySelector('a');
                    if (link) {
                      const href = link.getAttribute('href');
                      const slugParts = href.split('/');
                      rowData.competitionSlug = slugParts[slugParts.length - 1] || '';
                    }
                  }
                } else {
                  const pctKeys = ['fgPct', 'tpPct', 'twoPPct', 'ftPct'];
                  if (pctKeys.includes(key)) {
                    const percentEl = cell.querySelector('[class*="percent"]');
                    if (percentEl) {
                      const val = parseFloat(percentEl.textContent.trim().replace('%', '').replace(',', '.'));
                      if (!isNaN(val)) rowData[key] = val;
                    } else {
                      const val = parseFloat(text.replace('%', '').replace(',', '.'));
                      if (!isNaN(val)) rowData[key] = val;
                    }
                  } else {
                    const val = parseFloat(text.replace('%', '').replace(',', '.'));
                    if (!isNaN(val)) rowData[key] = val;
                  }
                }
              }
            }
          });

          if (Object.keys(rowData).length > 2) {
            statData.push(rowData);
          }
        }
      }

      return statData;
    });

    // Build player object
    const player = {
      slug: playerSlug,
      name: bio.name || playerSlug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      position: bio.position || context.position || '',
      height: bio.height || '',
      age: bio.age || null,
      nationality: bio.nationality || '',
      team: context.teamName || bio.team || '',
      teamSlug: context.teamSlug || '',
      league: context.leagueName || '',
      leagueSlug: context.leagueSlug || '',
      season: '2025-2026',
      stats: {}
    };

    // Use the stats row matching context league slug or fall back to the first row
    let primaryStats = null;
    if (context.leagueSlug && stats.length > 0) {
      primaryStats = stats.find(s => s.competitionSlug === context.leagueSlug);
    }
    if (!primaryStats && stats.length > 0) {
      primaryStats = stats[0];
    }

    if (primaryStats) {
      player.stats = {
        gp: primaryStats.gp || 0,
        min: primaryStats.min || 0,
        pts: primaryStats.pts || 0,
        reb: primaryStats.reb || 0,
        oreb: primaryStats.oreb || 0,
        dreb: primaryStats.dreb || 0,
        ast: primaryStats.ast || 0,
        stl: primaryStats.stl || 0,
        blk: primaryStats.blk || 0,
        to: primaryStats.to || 0,
        pf: primaryStats.pf || 0,
        fgPct: primaryStats.fgPct || 0,
        tpPct: primaryStats.tpPct || 0,
        twoPPct: primaryStats.twoPPct || 0,
        ftPct: primaryStats.ftPct || 0,
        eval: primaryStats.eval || 0,
        pir: primaryStats.pir || primaryStats.eval || 0,
        pie: primaryStats.pie || 0,
        usgPct: primaryStats.usgPct || 0,
        poss: primaryStats.poss || 0,
        tsPct: primaryStats.tsPct || 0,
        efgPct: primaryStats.efgPct || 0,
        tpAr: primaryStats.tpAr || 0,
        ftR: primaryStats.ftR || 0,
        orbPct: primaryStats.orbPct || 0,
        drbPct: primaryStats.drbPct || 0,
        trbPct: primaryStats.trbPct || 0,
        astPct: primaryStats.astPct || 0,
        toPct: primaryStats.toPct || 0,
        astToRatio: primaryStats.astToRatio || (primaryStats.to > 0 ? (primaryStats.ast / primaryStats.to) : 0),
        stlPct: primaryStats.stlPct || 0,
        blkPct: primaryStats.blkPct || 0
      };
    }

    // Try to get career stats
    const careerDataRaw = await scrapeCareerStats(page, playerSlug);
    
    // The main page stats have a separate row for each league but might lack the season explicitly
    const mainPageCareer = stats.map(s => {
      return {
        season: s.season || context.season || '2025-2026',
        team: s.team || context.teamName || '',
        competition: s.competition || '',
        stats: s
      };
    });

    const careerData = [...mainPageCareer, ...(careerDataRaw || [])];

    // Deduplicate and filter seasons (keep 24-25, 25-26, 26-27 in normalized format)
    const playerSeasons = new Map();
    
    // 1. Add career data seasons FIRST to ensure we get the exact correct team and stats for each league
    if (careerData && careerData.length > 0) {
      for (const career of careerData) {
        const normSeason = normalizeSeason(career.season);
        if (!normSeason) continue; // Discard older/other seasons
        
        let recordLeague = player.league;
        let recordLeagueSlug = player.leagueSlug;
        
        if (career.competition) {
          const leagueInfo = getLeagueByCompetition(career.competition);
          if (leagueInfo) {
            recordLeague = leagueInfo.name;
            recordLeagueSlug = leagueInfo.slug;
          } else {
            // Discard career stats for leagues not in our active 11 list
            continue;
          }
        } else if (career.team) {
          let leagueInfo = getLeagueForCareerTeam(career.team, player.league, player.leagueSlug);
          
          // Fallback: If abbreviation matches the current player's team, assign it to the current context league
          if (!leagueInfo && player.team) {
            const cTeamLower = career.team.toLowerCase().trim();
            const pTeamLower = player.team.toLowerCase().trim();
            if (pTeamLower.includes(cTeamLower) || cTeamLower.includes(pTeamLower)) {
              leagueInfo = { name: context.leagueName || player.league, slug: context.leagueSlug || player.leagueSlug };
            }
          }

          if (!leagueInfo) {
            // Cannot identify which league this team belongs to — discard to avoid cross-contamination
            continue;
          }
          recordLeague = leagueInfo.name;
          recordLeagueSlug = leagueInfo.slug;
        } else {
          // No competition AND no team — impossible to verify league, discard
          continue;
        }

        // Discard career stats for leagues other than the one currently being scraped
        if (context.leagueSlug && recordLeagueSlug !== context.leagueSlug) {
          continue;
        }
        
        const recordTeam = career.team || player.team;
        const recordTeamSlug = (recordTeam.toLowerCase() === player.team.toLowerCase()) ? player.teamSlug : '';
        const rawStats = career.stats || primaryStats || {};
        
        const key = `${normSeason}_${recordLeagueSlug}`;
        if (!playerSeasons.has(key)) {
          playerSeasons.set(key, {
            ...player,
            season: normSeason,
            team: recordTeam,
            teamSlug: recordTeamSlug,
            league: recordLeague,
            leagueSlug: recordLeagueSlug,
            stats: {
                gp: rawStats.gp || 0,
                min: rawStats.min || 0,
                pts: rawStats.pts || 0,
                reb: rawStats.reb || 0,
                oreb: rawStats.oreb || 0,
                dreb: rawStats.dreb || 0,
                ast: rawStats.ast || 0,
                stl: rawStats.stl || 0,
                blk: rawStats.blk || 0,
                to: rawStats.to || 0,
                pf: rawStats.pf || 0,
                fgPct: rawStats.fgPct || 0,
                tpPct: rawStats.tpPct || 0,
                twoPPct: rawStats.twoPPct || 0,
                ftPct: rawStats.ftPct || 0,
                eval: rawStats.eval || 0,
                pir: rawStats.pir || rawStats.eval || 0,
                pie: rawStats.pie || 0,
                usgPct: rawStats.usgPct || 0,
                poss: rawStats.poss || 0,
                tsPct: rawStats.tsPct || 0,
                efgPct: rawStats.efgPct || 0,
                tpAr: rawStats.tpAr || 0,
                ftR: rawStats.ftR || 0,
                orbPct: rawStats.orbPct || 0,
                drbPct: rawStats.drbPct || 0,
                trbPct: rawStats.trbPct || 0,
                astPct: rawStats.astPct || 0,
                toPct: rawStats.toPct || 0,
                astToRatio: rawStats.astToRatio || (rawStats.to > 0 ? (rawStats.ast / rawStats.to) : 0),
                stlPct: rawStats.stlPct || 0,
                blkPct: rawStats.blkPct || 0
            }
          });
        }
      }
    }
    
    // NOTE: No fallback. If career data didn't have a verified record for this league,
    // we do NOT insert the generic player object. It's better to have no data than wrong data.
    // The player will simply not appear for this league, which is correct behavior.
    if (playerSeasons.size === 0) {
      console.log(`[Scraper] No verified career data found for "${playerSlug}" in league "${context.leagueSlug}". Skipping.`);
    }
    
    return Array.from(playerSeasons.values());

  } catch (err) {
    console.error(`[Scraper] Error scraping player "${playerSlug}":`, err.message);
    progress.errors.push({ type: 'player', slug: playerSlug, error: err.message });
    return null;
  } finally {
    await page.close();
  }
}

/**
 * Scrape career stats from the career-stats subpage.
 */
async function scrapeCareerStats(page, playerSlug) {
  try {
    const careerUrl = `${BASE_URL}/player/${playerSlug}/career-stats`;
    await page.goto(careerUrl, { waitUntil: 'networkidle2', timeout: 20000 });

    // Wait for table
    try {
      await page.waitForSelector('table', { timeout: 8000 });
    } catch {
      return [];
    }

    const careerData = await page.evaluate(() => {
      const seasons = [];
      const tables = document.querySelectorAll('table');

      for (const table of tables) {
        const headerRow = table.querySelector('thead tr, tr:first-child');
        if (!headerRow) continue;

        const headers = Array.from(headerRow.querySelectorAll('th, td'))
          .map(th => th.textContent.trim().toLowerCase());

        const rows = table.querySelectorAll('tbody tr');
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('td'));
          const seasonData = { stats: {} };

          cells.forEach((cell, i) => {
            if (i < headers.length) {
              const rawHeader = headers[i].toLowerCase().trim();
              let key = null;
              
              // Direct exact matches first
              if (rawHeader === 'gp' || rawHeader === 'g' || rawHeader === 'games' || rawHeader === 'pj') key = 'gp';
              else if (rawHeader === 'min' || rawHeader === 'mpg' || rawHeader === 'minutes') key = 'min';
              else if (rawHeader === 'pts' || rawHeader === 'ppg' || rawHeader === 'points') key = 'pts';
              else if (rawHeader === 'reb' || rawHeader === 'rpg' || rawHeader === 'rebounds') key = 'reb';
              else if (rawHeader === 'oreb' || rawHeader === 'or' || rawHeader === 'ro') key = 'oreb';
              else if (rawHeader === 'dreb' || rawHeader === 'dr' || rawHeader === 'rd') key = 'dreb';
              else if (rawHeader === 'ast' || rawHeader === 'apg' || rawHeader === 'assists') key = 'ast';
              else if (rawHeader === 'stl' || rawHeader === 'spg' || rawHeader === 'steals') key = 'stl';
              else if (rawHeader === 'blk' || rawHeader === 'bpg' || rawHeader === 'blocks') key = 'blk';
              else if (rawHeader === 'to' || rawHeader === 'tov' || rawHeader === 'turnovers') key = 'to';
              else if (rawHeader === 'pf' || rawHeader === 'fouls') key = 'pf';
              else if (rawHeader === 'fg' || rawHeader === 'fg%' || rawHeader === 'fgpct' || rawHeader === 'fg pct') key = 'fgPct';
              else if (rawHeader === '3pts' || rawHeader === '3p%' || rawHeader === '3pt%' || rawHeader === '3ppct') key = 'tpPct';
              else if (rawHeader === '2pts' || rawHeader === '2p%' || rawHeader === '2pt%' || rawHeader === '2ppct') key = 'twoPPct';
              else if (rawHeader === 'ft' || rawHeader === 'ft%' || rawHeader === 'ftpct') key = 'ftPct';
              else if (rawHeader === 'eval' || rawHeader === 'eff') key = 'eval';
              else if (rawHeader === 'pir') key = 'pir';
              else if (rawHeader === 'pie') key = 'pie';
              else if (rawHeader === 'poss.' || rawHeader === 'poss') key = 'poss';
              else if (rawHeader === '3par') key = 'tpAr';
              else if (rawHeader === 'ftr') key = 'ftR';
              else if (rawHeader === 'orb%') key = 'orbPct';
              else if (rawHeader === 'drb%') key = 'drbPct';
              else if (rawHeader === 'trb%') key = 'trbPct';
              else if (rawHeader === 'ast%') key = 'astPct';
              else if (rawHeader === 'to%') key = 'toPct';
              else if (rawHeader === 'ast-to rat.' || rawHeader === 'ast-to ratio' || rawHeader === 'ast-to rat') key = 'astToRatio';
              else if (rawHeader === 'stl%') key = 'stlPct';
              else if (rawHeader === 'blk%') key = 'blkPct';
              else if (rawHeader === 'team' || rawHeader === 'equipe' || rawHeader === 'équipe') key = 'team';
              else if (rawHeader === 'comp' || rawHeader === 'competition' || rawHeader === 'league' || rawHeader === 'ligue') key = 'competition';
              else if (rawHeader === 'season' || rawHeader === 'saison') key = 'season';
              else if (rawHeader === 'ts%' || rawHeader === 'tspct') key = 'tsPct';
              else if (rawHeader === 'efg%' || rawHeader === 'efgpct') key = 'efgPct';
              else if (rawHeader === 'usg%' || rawHeader === 'usgpct') key = 'usgPct';

              if (key) {
                const text = cell.textContent.trim();
                if (key === 'season' || key === 'team' || key === 'competition') {
                  seasonData[key] = text;
                } else {
                  const pctKeys = ['fgPct', 'tpPct', 'twoPPct', 'ftPct'];
                  if (pctKeys.includes(key)) {
                    const percentEl = cell.querySelector('[class*="percent"]');
                    if (percentEl) {
                      const val = parseFloat(percentEl.textContent.trim().replace('%', '').replace(',', '.'));
                      if (!isNaN(val)) seasonData.stats[key] = val;
                    } else {
                      const val = parseFloat(text.replace('%', '').replace(',', '.'));
                      if (!isNaN(val)) seasonData.stats[key] = val;
                    }
                  } else {
                    const val = parseFloat(text.replace('%', '').replace(',', '.'));
                    if (!isNaN(val)) seasonData.stats[key] = val;
                  }
                }
              }
            }
          });

          if (Object.keys(seasonData.stats).length > 2) {
            seasons.push(seasonData);
          }
        }
      }

      return seasons;
    });

    return careerData;
  } catch (err) {
    console.warn(`[Scraper] Could not fetch career stats for "${playerSlug}":`, err.message);
    return [];
  }
}

/**
 * Load cached player games from disk if less than 24 hours old.
 */
function loadPlayerGamesCache(playerSlug, season, leagueSlug) {
  const gamesCachePath = path.join(DATA_DIR, 'games', `${playerSlug}_${season}_${leagueSlug}.json`);
  try {
    if (fs.existsSync(gamesCachePath)) {
      const raw = fs.readFileSync(gamesCachePath, 'utf-8');
      const data = JSON.parse(raw);
      
      // Check age: 24 hours (86400000 ms)
      const cacheTime = new Date(data.timestamp).getTime();
      const now = Date.now();
      if (now - cacheTime < 24 * 60 * 60 * 1000) {
        console.log(`[Scraper] Loaded game log for "${playerSlug}" (${season} / ${leagueSlug}) from cache.`);
        return data.games;
      }
    }
  } catch (err) {
    console.error(`[Scraper] Error reading games cache for "${playerSlug}":`, err.message);
  }
  return null;
}

/**
 * Save player games to disk.
 */
function savePlayerGamesCache(playerSlug, season, leagueSlug, games) {
  const gamesDir = path.join(DATA_DIR, 'games');
  const gamesCachePath = path.join(gamesDir, `${playerSlug}_${season}_${leagueSlug}.json`);
  try {
    if (!fs.existsSync(gamesDir)) {
      fs.mkdirSync(gamesDir, { recursive: true });
    }
    const data = {
      playerSlug,
      season,
      leagueSlug,
      games,
      timestamp: new Date().toISOString()
    };
    fs.writeFileSync(gamesCachePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[Scraper] Saved game log for "${playerSlug}" (${season} / ${leagueSlug}) to cache.`);
  } catch (err) {
    console.error(`[Scraper] Error writing games cache for "${playerSlug}":`, err.message);
  }
}

/**
 * Scrape a player's individual matches/games.
 * URL: https://www.be-basketball.com/player/{playerSlug}/games
 */
async function scrapePlayerGames(playerSlug, leagueSlug, season) {
  // Try cache first
  const cachedGames = loadPlayerGamesCache(playerSlug, season, leagueSlug);
  if (cachedGames) {
    return cachedGames;
  }

  // Otherwise scrape with Puppeteer
  await initBrowser();
  const page = await browser.newPage();

  // If Primera FEB (dbasket.net)
  if (leagueSlug === 'primera-feb') {
    const url = `${DBASKET_BASE_URL}/players/${playerSlug}`;
    try {
      console.log(`[Scraper] Scraping player games from dbasket.net: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Select season in dropdown if specified and different from default
      if (season) {
        const parts = season.split('-');
        const dbasketSeasonText = parts.length === 2 ? `Temporada ${parts[0].slice(-2)}/${parts[1].slice(-2)}` : '';
        
        if (dbasketSeasonText) {
          try {
            const switched = await page.evaluate((seasonText) => {
              const select = document.querySelector('select[name="temporada-gamelogs"]');
              if (select) {
                const opt = Array.from(select.options).find(o => o.text.includes(seasonText));
                if (opt && !opt.selected) {
                  select.value = opt.value;
                  const form = document.getElementById('searchform');
                  if (form) {
                    form.submit();
                    return true;
                  }
                }
              }
              return false;
            }, dbasketSeasonText);
            
            if (switched) {
              await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
            }
          } catch (err) {
            console.warn('[Scraper] Failed to switch season for dbasket gamelogs:', err.message);
          }
        }
      }

      // Wait for games table
      try {
        await page.waitForSelector('#partido-a-partido table', { timeout: 10000 });
      } catch {
        console.warn(`[Scraper] No games table found on dbasket player page.`);
        return [];
      }

      const games = await page.evaluate(() => {
        const container = document.getElementById('partido-a-partido');
        if (!container) return [];
        const table = container.querySelector('table');
        if (!table) return [];
        
        const headerRow = table.querySelector('thead tr');
        if (!headerRow) return [];
        const headers = Array.from(headerRow.querySelectorAll('th')).map(th => th.textContent.trim());
        
        const rows = table.querySelectorAll('tbody tr');
        const list = [];
        
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('td'));
          if (cells.length < 10) continue;
          
          const date = cells[0].textContent.trim();
          const rawOpp = cells[1].textContent.trim();
          const opponent = rawOpp.replace(/^(v\.|at\.|@|vs\.?)\s+/i, '').trim();
          
          const rawScore = cells[4].textContent.trim();
          const scoreMatch = rawScore.match(/\(([^)]+)\)/);
          const score = scoreMatch ? scoreMatch[1] : rawScore;
          
          const getStatByHeader = (headerName) => {
            const idx = headers.indexOf(headerName);
            if (idx !== -1 && cells[idx]) {
              const text = cells[idx].textContent.trim();
              if (headerName === 'MIN' && text.includes(':')) {
                const parts = text.split(':');
                return parseFloat(parts[0]) + (parseFloat(parts[1]) / 60);
              }
              return parseFloat(text.replace('%', '').replace(',', '.')) || 0;
            }
            return 0;
          };
          
          const oppAnchor = cells[1].querySelector('a');
          const gameUrl = oppAnchor ? oppAnchor.getAttribute('href') : null;
          
          list.push({
            date,
            opponent,
            score,
            gameUrl,
            league: 'Primera FEB',
            min: getStatByHeader('MIN'),
            pts: getStatByHeader('PTS'),
            reb: getStatByHeader('REB'),
            oreb: getStatByHeader('RO'),
            dreb: getStatByHeader('RD'),
            ast: getStatByHeader('ASI'),
            stl: getStatByHeader('ROB'),
            blk: getStatByHeader('TAP'),
            to: getStatByHeader('PER'),
            pf: getStatByHeader('FP'),
            eval: getStatByHeader('VAL')
          });
        }
        return list;
      });

      console.log(`[Scraper] Scraped ${games.length} matches for player "${playerSlug}" from dbasket.`);
      games.forEach(g => {
        g.season = season;
      });
      savePlayerGamesCache(playerSlug, season, leagueSlug, games);
      return games;
    } catch (err) {
      console.error(`[Scraper] Error scraping dbasket game log for "${playerSlug}":`, err.message);
      return [];
    } finally {
      await page.close();
    }
  }

  // Otherwise, standard be-basketball scraping
  const url = `${BASE_URL}/player/${playerSlug}/games`;
  try {
    console.log(`[Scraper] Scraping player game log from: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    try {
      await page.waitForSelector('table', { timeout: 10000 });
      
      // Select season if present in picker
      const seasonOptionValue = await page.evaluate((targetSeason) => {
        const select = document.getElementById('season-picker');
        if (!select) return null;
        const options = Array.from(select.options);
        const found = options.find(o => o.text.trim() === targetSeason || o.value.trim() === targetSeason);
        if (found) {
          select.value = found.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return found.value;
        }
        return null;
      }, season);

      if (seasonOptionValue) {
        console.log(`[Scraper] Selected season "${season}" in picker.`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Select league if present in picker
      const leagueOptionValue = await page.evaluate((targetLeagueSlug) => {
        const select = document.getElementById('league-picker');
        if (!select) return null;
        
        const getSlug = (text) => {
          const cleaned = text.toLowerCase().trim();
          if (cleaned.includes('endesa') || cleaned.includes('acb')) return 'liga-endesa';
          if (cleaned.includes('fiba europe') || cleaned.includes('fiba') || cleaned.includes('fec')) return 'fiba-europe-cup';
          if (cleaned.includes('champions') || cleaned.includes('bcl')) return 'basketball-champions-league';
          if (cleaned.includes('feb') || cleaned.includes('primera feb')) return 'primera-feb';
          if (cleaned.includes('bbl') || cleaned.includes('easycredit') || cleaned.includes('alemania')) return 'easycredit-bbl';
          if (cleaned.includes('betclic') || cleaned.includes('elite')) return 'betclic-elite';
          if (cleaned.includes('lega') || cleaned.includes('lba') || cleaned.includes('serie a')) return 'lega-basket-serie-a';
          if (cleaned.includes('esake') || cleaned.includes('gbl')) return 'esake';
          if (cleaned.includes('aba')) return 'aba-liga';
          if (cleaned.includes('bnxt')) return 'bnxt-league';
          if (cleaned.includes('bsl') || cleaned.includes('turq')) return 'basketbol-super-ligi';
          if (cleaned.includes('lkl') || cleaned.includes('litua')) return 'betsafe-lkl';
          if (cleaned.includes('g league')) return 'g-league';
          return cleaned;
        };

        const options = Array.from(select.options);
        const found = options.find(o => getSlug(o.text) === targetLeagueSlug || getSlug(o.value) === targetLeagueSlug);
        if (found) {
          select.value = found.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return found.value;
        }
        return null;
      }, leagueSlug);

      if (leagueOptionValue) {
        console.log(`[Scraper] Selected league "${leagueSlug}" in picker.`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch {
      console.warn(`[Scraper] No games table found on ${url}.`);
      return [];
    }

    const games = await page.evaluate(() => {
      const gamesData = [];
      const tables = document.querySelectorAll('table');

      for (const table of tables) {
        const headerRow = table.querySelector('thead tr, tr:first-child');
        if (!headerRow) continue;

        const headers = Array.from(headerRow.querySelectorAll('th, td'))
          .map(th => th.textContent.trim().toLowerCase());

        const rows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('td'));
          if (cells.length < 5) continue;

          const game = {};
          cells.forEach((cell, i) => {
            if (i < headers.length) {
              const rawHeader = headers[i].toLowerCase().trim();
              let key = null;
              
              // Direct exact matches first
              if (rawHeader === 'pts' || rawHeader === 'points') key = 'pts';
              else if (rawHeader === 'reb' || rawHeader === 'rebounds') key = 'reb';
              else if (rawHeader === 'oreb' || rawHeader === 'or') key = 'oreb';
              else if (rawHeader === 'dreb' || rawHeader === 'dr') key = 'dreb';
              else if (rawHeader === 'ast' || rawHeader === 'apg' || rawHeader === 'assists' || rawHeader === 'pd') key = 'ast';
              else if (rawHeader === 'stl' || rawHeader === 'spg' || rawHeader === 'steals' || rawHeader === 'rob' || rawHeader === 'int') key = 'stl';
              else if (rawHeader === 'blk' || rawHeader === 'bpg' || rawHeader === 'blocks' || rawHeader === 'ctr') key = 'blk';
              else if (rawHeader === 'to' || rawHeader === 'tov' || rawHeader === 'turnovers' || rawHeader === 'bp') key = 'to';
              else if (rawHeader === 'pf' || rawHeader === 'fouls' || rawHeader === 'fp') key = 'pf';
              else if (rawHeader === 'eval' || rawHeader === 'pir' || rawHeader === 'eff' || rawHeader === 'val') key = 'eval';
              else if (rawHeader === 'min' || rawHeader === 'mpg' || rawHeader === 'minutes') key = 'min';
              else if (rawHeader === 'date' || rawHeader === 'day') key = 'date';
              else if (rawHeader === 'season' || rawHeader === 'saison') key = 'season';
              else if (rawHeader === 'game' || rawHeader === 'match' || rawHeader === 'opponent' || rawHeader === 'adversaire' || rawHeader === 'equipe' || rawHeader === 'équipe') key = 'game';
              else if (rawHeader === 'score' || rawHeader === 'result' || rawHeader === 'résultat' || rawHeader === 'resultat') key = 'score';

              if (key) {
                const text = cell.textContent.trim();
                if (key === 'game') {
                  const anchor = cell.querySelector('a');
                  if (anchor) {
                    game.gameUrl = anchor.getAttribute('href');
                  }
                  // e.g. "D86-68@MAL" or "V90-85vsBAR" or "V100-81vsALI"
                  const match = text.match(/^([VDWL]?)([\d-]+)(@|vs\.?)(.+)$/i);
                  if (match) {
                    const resLetter = match[1].toUpperCase();
                    const scoreVal = match[2];
                    const isAway = match[3] === '@';
                    const oppName = match[4].trim();
                    
                    game.opponent = oppName;
                    game.score = scoreVal;
                    game.result = (resLetter === 'V' || resLetter === 'W') ? 'V' : 'D';
                    game.location = isAway ? 'Fuera' : 'Casa';
                  } else {
                    game.opponent = text;
                  }
                } else if (key === 'date' || key === 'opponent' || key === 'score' || key === 'season' || key === 'league') {
                  game[key] = text;
                } else {
                  const val = parseFloat(text.replace('%', '').replace(',', '.'));
                  if (!isNaN(val)) game[key] = val;
                }
              }
            }
          });

          if (Object.keys(game).length > 2 && (game.opponent || game.date)) {
            // Clean opponent prefix (e.g. '@ Real Madrid' or 'vs Barcelona')
            if (game.opponent) {
              game.opponent = game.opponent.replace(/^(@|vs\.?|at\.?)\s+/i, '').trim();
            }
            gamesData.push(game);
          }
        }
      }

      return gamesData;
    });

    // Set the league and season for all scraped games to the requested parameters
    const activeLeague = LEAGUES.find(l => l.slug === leagueSlug);
    const leagueName = activeLeague ? activeLeague.name : leagueSlug;
    games.forEach(g => {
      g.league = leagueName;
      g.season = season;
    });

    console.log(`[Scraper] Scraped ${games.length} matches for player "${playerSlug}".`);
    
    // Save to cache
    savePlayerGamesCache(playerSlug, season, leagueSlug, games);
    return games;

  } catch (err) {
    console.error(`[Scraper] Error scraping player game log for "${playerSlug}":`, err.message);
    return [];
  } finally {
    await page.close();
  }
}

function getBoxscoreCachePath(gameUrl) {
  if (!gameUrl) return null;
  const cleanId = gameUrl.replace(/[\/\?]/g, '_');
  return path.join(DATA_DIR, 'boxscores', `${cleanId}.json`);
}

function loadBoxscoreCache(gameUrl) {
  const cachePath = getBoxscoreCachePath(gameUrl);
  if (cachePath && fs.existsSync(cachePath)) {
    try {
      const raw = fs.readFileSync(cachePath, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      console.error(`[Scraper] Error reading boxscore cache:`, err.message);
    }
  }
  return null;
}

function saveBoxscoreCache(gameUrl, data) {
  const cachePath = getBoxscoreCachePath(gameUrl);
  if (!cachePath) return;
  try {
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[Scraper] Error writing boxscore cache:`, err.message);
  }
}

/**
 * Scrape detailed boxscore for a single game and extract/calculate player advanced stats.
 */
async function scrapeGameBoxscore(gameUrl, leagueSlug, playerSlug) {
  const cached = loadBoxscoreCache(gameUrl);
  if (cached) {
    const hasBadValue = cached.orbPct > 100.0 || cached.drbPct > 100.0 || cached.trbPct > 100.0;
    if (!hasBadValue) {
      return cached;
    }
    console.log(`[Scraper] Invalidating boxscore cache for ${gameUrl} due to incorrect rebounding percentages...`);
  }

  await initBrowser();
  const page = await browser.newPage();
  
  try {
    const isDbasket = leagueSlug === 'primera-feb';
    const baseUrl = isDbasket ? DBASKET_BASE_URL : BASE_URL;
    const url = gameUrl.startsWith('http') ? gameUrl : `${baseUrl}${gameUrl}`;
    
    console.log(`[Scraper] Scraping boxscore from: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    if (isDbasket) {
      await page.waitForSelector('table.tabla-boxscore', { timeout: 15000 });
      
      const advancedStats = await page.evaluate((slug) => {
        const tables = Array.from(document.querySelectorAll('table.tabla-boxscore'));
        let targetRow = null;
        
        for (const table of tables) {
          const headers = Array.from(table.querySelectorAll('thead th, tr:first-child th')).map(th => th.textContent.trim());
          const hasUsg = headers.some(h => h.includes('%USO') || h.includes('%uso'));
          if (!hasUsg) continue;
          
          const rows = Array.from(table.querySelectorAll('tbody tr, tr:not(:first-child)'));
          for (const row of rows) {
            const cells = Array.from(row.querySelectorAll('td'));
            if (cells.length < 5) continue;
            
            const playerCell = cells[1];
            if (playerCell) {
              const a = playerCell.querySelector('a');
              const href = a ? a.getAttribute('href') : '';
              if (href.includes(slug) || playerCell.textContent.toLowerCase().includes(slug.replace(/-/g, ' '))) {
                targetRow = { headers, cells: cells.map(c => c.textContent.trim()) };
                break;
              }
            }
          }
          if (targetRow) break;
        }
        
        if (!targetRow) return null;
        
        const getVal = (headerName) => {
          const idx = targetRow.headers.indexOf(headerName);
          if (idx !== -1 && targetRow.cells[idx]) {
            return parseFloat(targetRow.cells[idx].replace('%', '').replace(',', '.')) || 0;
          }
          return 0;
        };
        
        let valuation = 0;
        const basicTables = Array.from(document.querySelectorAll('table.tabla-boxscore'));
        for (const table of basicTables) {
          const headers = Array.from(table.querySelectorAll('thead th, tr:first-child th')).map(th => th.textContent.trim());
          const hasVal = headers.includes('VAL');
          if (!hasVal) continue;
          
          const rows = Array.from(table.querySelectorAll('tbody tr, tr:not(:first-child)'));
          for (const row of rows) {
            const cells = Array.from(row.querySelectorAll('td'));
            if (cells.length < 5) continue;
            const playerCell = cells[1];
            if (playerCell) {
              const a = playerCell.querySelector('a');
              const href = a ? a.getAttribute('href') : '';
              if (href.includes(slug) || playerCell.textContent.toLowerCase().includes(slug.replace(/-/g, ' '))) {
                const valIdx = headers.indexOf('VAL');
                valuation = parseFloat(cells[valIdx].textContent.trim().replace(',', '.')) || 0;
                break;
              }
            }
          }
        }

        const astPct = getVal('%ASI');
        const toPct = getVal('%PER');
        const astToRatio = toPct > 0 ? Math.round((astPct / toPct) * 100) / 100 : astPct > 0 ? 10.0 : 0.0;

        return {
          pir: valuation,
          pie: 0.0,
          usgPct: getVal('%USO'),
          poss: 0.0,
          tsPct: getVal('%TR'),
          efgPct: getVal('%TE'),
          tpAr: getVal('RT3') * 100,
          ftR: getVal('RTL') * 100,
          orbPct: getVal('%RO'),
          drbPct: getVal('%RD'),
          trbPct: getVal('%REB'),
          astPct,
          toPct,
          astToRatio,
          stlPct: getVal('%ROB'),
          blkPct: getVal('%TAP')
        };
      }, playerSlug);
      
      if (!advancedStats) {
        throw new Error('Player row not found in dbasket boxscore tables.');
      }
      
      const pace = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('table tr, .resultados-parciales tr'));
        for (const row of rows) {
          const text = row.textContent;
          if (text.includes('Ritmo') || text.includes('Four Factors')) {
            const cells = Array.from(row.querySelectorAll('td'));
            for (const cell of cells) {
              const val = parseFloat(cell.textContent.trim().replace(',', '.'));
              if (val > 50 && val < 120) return val;
            }
          }
        }
        return 70;
      });
      
      advancedStats.poss = Math.round((pace * (advancedStats.usgPct / 100)) * 10) / 10;
      
      saveBoxscoreCache(gameUrl, advancedStats);
      return advancedStats;

    } else {
      await page.waitForSelector('table', { timeout: 15000 });
      
      const playerNeedsTeamSwitch = await page.evaluate((slug) => {
        const hasLink = document.querySelector(`a[href*="/player/${slug}"]`);
        if (hasLink) return false;
        
        const selectorDivs = Array.from(document.querySelectorAll('[class*="TeamSelector"] div, [class*="TeamSelector"] span'));
        const unselectedTeamDiv = selectorDivs.find(div => !div.className.includes('TeamSelected') && div.textContent.trim().length > 0);
        if (unselectedTeamDiv) {
          unselectedTeamDiv.click();
          return true;
        }
        return false;
      }, playerSlug);

      if (playerNeedsTeamSwitch) {
        console.log(`[Scraper] Player "${playerSlug}" not found in current table, clicked opponent TeamSelector.`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const gameData = await page.evaluate((slug) => {
        const tables = Array.from(document.querySelectorAll('table'));
        let targetTableIdx = -1;
        let targetRowIdx = -1;
        
        for (let tIdx = 0; tIdx < tables.length; tIdx++) {
          const rows = Array.from(tables[tIdx].querySelectorAll('tbody tr, tr'));
          for (let rIdx = 0; rIdx < rows.length; rIdx++) {
            const a = rows[rIdx].querySelector('a[href*="/player/"]');
            if (a) {
              const href = a.getAttribute('href');
              if (href.includes(slug)) {
                targetTableIdx = tIdx;
                targetRowIdx = rIdx;
                break;
              }
            }
          }
          if (targetTableIdx !== -1) break;
        }
        
        if (targetTableIdx === -1) return null;
        
        const parseRow = (row, headers) => {
          const cells = Array.from(row.querySelectorAll('td'));
          const data = {};
          
          cells.forEach((cell, idx) => {
            const header = headers[idx] || '';
            const text = cell.textContent.trim();
            
            if (header === 'min') {
              const parts = text.split(':');
              data.min = parseFloat(parts[0]) + (parseFloat(parts[1] || 0) / 60) || 0;
            } else if (['PTS', 'REB', 'AST', 'STL', 'BLK', 'OREB', 'DREB', 'TO', 'PF', 'FD', 'PIR', 'PIE', 'USG%'].includes(header)) {
              data[header] = parseFloat(text.replace('%', '').replace(',', '.')) || 0;
            } else if (header === 'Poss.') {
              data.poss = parseFloat(text.replace(',', '.')) || 0;
            } else if (['FG', '2pts', '3pts', 'ft'].includes(header)) {
              const div = cell.querySelector('div:not([class*="percent"])');
              const fracText = div ? div.textContent.trim() : text;
              const parts = fracText.split('/');
              data[header + 'M'] = parseFloat(parts[0]) || 0;
              data[header + 'A'] = parseFloat(parts[1]) || 0;
            }
          });
          return data;
        };
        
        const targetTable = tables[targetTableIdx];
        const headerRow = targetTable.querySelector('thead tr, tr:first-child');
        const headers = Array.from(headerRow.querySelectorAll('th, td')).map(th => th.textContent.trim());
        
        const playerRow = targetTable.querySelectorAll('tbody tr, tr')[targetRowIdx];
        const playerStats = parseRow(playerRow, headers);
        
        const teamRows = Array.from(targetTable.querySelectorAll('tbody tr, tr')).filter((r, idx) => {
          const isHeader = r.querySelector('th') || idx === 0;
          const isTotal = r.textContent.includes('Total') || r.className.includes('total');
          const hasPlayerLink = r.querySelector('a[href*="/player/"]');
          return !isHeader && !isTotal && hasPlayerLink;
        });
        
        const teamTotals = { pts: 0, fga: 0, fta: 0, oreb: 0, dreb: 0, reb: 0, ast: 0, to: 0, fgm: 0 };
        teamRows.forEach(r => {
          const stats = parseRow(r, headers);
          teamTotals.pts += stats.PTS || 0;
          teamTotals.fga += stats.FGA || (stats.FGM || 0);
          teamTotals.fgm += stats.FGM || 0;
          teamTotals.fta += stats.ftA || 0;
          teamTotals.oreb += stats.OREB || 0;
          teamTotals.dreb += stats.DREB || 0;
          teamTotals.reb += stats.REB || 0;
          teamTotals.ast += stats.AST || 0;
          teamTotals.to += stats.TO || 0;
        });
        
        const oppTable = tables.find((t, idx) => idx !== targetTableIdx && t.querySelectorAll('a[href*="/player/"]').length > 0);
        const oppTotals = { reb: 0, oreb: 0, dreb: 0, to: 0 };
        if (oppTable) {
          const oppHeaderRow = oppTable.querySelector('thead tr, tr:first-child');
          const oppHeaders = Array.from(oppHeaderRow.querySelectorAll('th, td')).map(th => th.textContent.trim());
          const oppRows = Array.from(oppTable.querySelectorAll('tbody tr, tr')).filter((r, idx) => {
            const isHeader = r.querySelector('th') || idx === 0;
            const isTotal = r.textContent.includes('Total') || r.className.includes('total');
            const hasPlayerLink = r.querySelector('a[href*="/player/"]');
            return !isHeader && !isTotal && hasPlayerLink;
          });
          
          oppRows.forEach(r => {
            const stats = parseRow(r, oppHeaders);
            oppTotals.reb += stats.REB || 0;
            oppTotals.oreb += stats.OREB || 0;
            oppTotals.dreb += stats.DREB || 0;
            oppTotals.to += stats.TO || 0;
          });
        }
        
        return { playerStats, teamTotals, oppTotals };
      }, playerSlug);
      
      if (!gameData) {
        throw new Error('Player row not found in be-basketball boxscore tables.');
      }
      
      const ps = gameData.playerStats;
      const tt = gameData.teamTotals;
      const ot = gameData.oppTotals;
      
      const fga = ps.FGA || (ps.FGM || 0);
      const fta = ps.ftA || 0;
      const pts = ps.PTS || 0;
      const tsPct = fga + 0.44 * fta > 0 ? Math.round((pts / (2 * (fga + 0.44 * fta))) * 1000) / 10 : 0;
      const efgPct = fga > 0 ? Math.round(((ps.FGM || 0) + 0.5 * (ps['3ptsM'] || 0)) / fga * 1000) / 10 : 0;
      const tpAr = fga > 0 ? Math.round(((ps['3ptsA'] || 0) / fga) * 1000) / 10 : 0;
      const ftR = fga > 0 ? Math.round(((ps.ftA || 0) / fga) * 1000) / 10 : 0;
      
      const playerMin = ps.min || 1;
      const regulationMin = (leagueSlug === 'g-league') ? 48 : 40;
      
      const denomORB = (tt.oreb || (ps.OREB || 0)) + (ot.dreb || 0);
      const orbPct = denomORB > 0 ? Math.min(100.0, Math.round(((ps.OREB || 0) * regulationMin) / (playerMin * denomORB) * 1000) / 10) : 0;
      
      const denomDRB = (tt.dreb || (ps.DREB || 0)) + (ot.oreb || 0);
      const drbPct = denomDRB > 0 ? Math.min(100.0, Math.round(((ps.DREB || 0) * regulationMin) / (playerMin * denomDRB) * 1000) / 10) : 0;
      
      const denomTRB = (tt.reb || (ps.REB || 0)) + (ot.reb || 0);
      const trbPct = denomTRB > 0 ? Math.min(100.0, Math.round(((ps.REB || 0) * regulationMin) / (playerMin * denomTRB) * 1000) / 10) : 0;
      
      const astPct = Math.round((ps.AST || 0) * 100) / 100;
      const toPct = fga + 0.44 * fta + (ps.TO || 0) > 0 ? Math.round((ps.TO || 0) / (fga + 0.44 * fta + (ps.TO || 0)) * 1000) / 10 : 0;
      const astToRatio = ps.TO > 0 ? Math.round(((ps.AST || 0) / ps.TO) * 100) / 100 : ps.AST > 0 ? 10.0 : 0.0;
      
      const stlPct = Math.round((ps.STL || 0) * 10) / 10;
      const blkPct = Math.round((ps.BLK || 0) * 10) / 10;
      
      const advancedStats = {
        pir: ps.PIR || ps.EVAL || 0,
        pie: ps.PIE || 0,
        usgPct: ps['USG%'] || 0,
        poss: ps.poss || 0,
        tsPct,
        efgPct,
        tpAr,
        ftR,
        orbPct,
        drbPct,
        trbPct,
        astPct,
        toPct,
        astToRatio,
        stlPct,
        blkPct
      };
      
      saveBoxscoreCache(gameUrl, advancedStats);
      return advancedStats;
    }

  } catch (err) {
    console.error(`[Scraper] Error scraping game boxscore:`, err.message);
    throw err;
  } finally {
    await page.close();
  }
}

/**
 * Scrape an entire league: teams → players → stats.
 * This is the main high-level function.
 * 
 * @param {string} slug - League slug
 * @returns {Array} All scraped players
 */
async function scrapeFullLeague(slug, targetSeason = '2025-2026') {
  const leagueConfig = LEAGUES.find(l => l.slug === slug);
  if (!leagueConfig) {
    throw new Error(`Unknown league slug: ${slug}`);
  }

  // Reset progress
  progress = {
    status: 'scraping',
    league: leagueConfig.name,
    leagueSlug: slug,
    totalTeams: 0,
    scrapedTeams: 0,
    totalPlayers: 0,
    scrapedPlayers: 0,
    currentTeam: '',
    currentPlayer: '',
    errors: [],
    startedAt: new Date().toISOString(),
    completedAt: null
  };

  const allPlayers = [];

  try {
    await initBrowser();

    if (slug === 'primera-feb') {
      return await scrapeDbasketLeague(targetSeason);
    }

    // Step 1: Scrape teams
    console.log(`[Scraper] Starting full league scrape for: ${leagueConfig.name}`);
    const teams = await scrapeLeagueTeams(slug);
    progress.totalTeams = teams.length;

    if (teams.length === 0) {
      progress.status = 'error';
      progress.errors.push({ type: 'league', slug, error: 'No teams found' });
      return allPlayers;
    }

    // Step 2: For each team, scrape players
    for (let t = 0; t < teams.length; t++) {
      const team = teams[t];
      progress.currentTeam = team.name;
      console.log(`[Scraper] Scraping team ${t + 1}/${teams.length}: ${team.name}`);

      await delay(1500); // Be respectful

      const playerLinks = await scrapeTeamPlayers(team.slug);
      progress.totalPlayers += playerLinks.length;

      // Step 3: For each player, scrape stats
      for (let p = 0; p < playerLinks.length; p++) {
        const playerLink = playerLinks[p];
        progress.currentPlayer = playerLink.name;
        console.log(`[Scraper]   Player ${p + 1}/${playerLinks.length}: ${playerLink.name}`);

        await delay(1000); // Be respectful

        try {
          const playerData = await scrapePlayerStats(playerLink.slug, {
            teamName: team.name,
            teamSlug: team.slug,
            leagueName: leagueConfig.name,
            leagueSlug: slug
          });

          if (playerData) {
            allPlayers.push(...playerData);
          }
        } catch (err) {
          console.error(`[Scraper]   Failed to scrape ${playerLink.name}:`, err.message);
          progress.errors.push({ type: 'player', slug: playerLink.slug, error: err.message });
        }

        progress.scrapedPlayers++;
      }

      progress.scrapedTeams++;
    }

    // Step 4: Deduplicate allPlayers so we only keep one record per player per season in this league
    const uniquePlayersMap = new Map();
    for (const p of allPlayers) {
      if (!p.season) continue;
      const key = `${p.slug}_${p.season}`;
      if (uniquePlayersMap.has(key)) {
        const existing = uniquePlayersMap.get(key);
        // Prefer the record that has a longer (fuller) team name
        const isExistingAbbr = existing.team && existing.team.length <= 3;
        const isNewAbbr = p.team && p.team.length <= 3;
        if (isExistingAbbr && !isNewAbbr) {
          uniquePlayersMap.set(key, p);
        }
      } else {
        uniquePlayersMap.set(key, p);
      }
    }
    const deduplicatedPlayers = Array.from(uniquePlayersMap.values());

    // Step 5: Group all scraped players by season (merging all seasons scraped from profiles)
    const playersBySeason = {};
    for (const p of deduplicatedPlayers) {
      if (!playersBySeason[p.season]) playersBySeason[p.season] = [];
      playersBySeason[p.season].push(p);
    }

    // Step 6: For each season, merge with existing data and save
    for (const [season, seasonPlayers] of Object.entries(playersBySeason)) {
      const seasonFilePath = path.join(DATA_DIR, `players-${season}.json`);
      let existingPlayers = [];
      if (fs.existsSync(seasonFilePath)) {
        try {
          const raw = fs.readFileSync(seasonFilePath, 'utf-8');
          const data = JSON.parse(raw);
          existingPlayers = data.players || [];
        } catch (err) {
          console.error(`[Scraper] Error loading season file ${seasonFilePath}:`, err.message);
        }
      }

      // Remove old data for this league in this specific season, keep others
      const otherLeaguePlayers = existingPlayers.filter(p => p.leagueSlug !== slug);
      const mergedPlayers = [...otherLeaguePlayers, ...seasonPlayers];

      saveDatabase(mergedPlayers, season);
    }

    progress.status = 'done';
    progress.completedAt = new Date().toISOString();
    console.log(`[Scraper] League scrape complete. ${allPlayers.length} records scraped across multiple seasons.`);

    return allPlayers;

  } catch (err) {
    console.error(`[Scraper] Fatal error during league scrape:`, err.message);
    progress.status = 'error';
    progress.errors.push({ type: 'fatal', error: err.message });
    throw err;
  }
}

/**
 * Scrape player bio and advanced stats from dbasket.net player profile page.
 */
async function scrapeDbasketPlayerBioAndAdvanced(playerSlug, targetSeason) {
  const page = await browser.newPage();
  const url = `https://dbasket.net/players/${playerSlug}`;
  try {
    console.log(`[Scraper] Scraping dbasket player page: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    
    // Wait for player card details
    await page.waitForSelector('.player-card', { timeout: 10000 });
    
    // Translate season to dbasket Temp column text format (e.g. 2025-2026 -> 2025/26)
    const parts = targetSeason.split('-');
    const dbasketTemp = parts.length === 2 ? `${parts[0]}/${parts[1].slice(-2)}` : '2025/26';
    
    const bioAndAdvanced = await page.evaluate((dbasketTemp) => {
      const bio = {
        position: '',
        height: '',
        nationality: '',
        age: null,
        tsPct: 0,
        efgPct: 0,
        usgPct: 0
      };
      
      // 1. Extract position & height
      const metaSpans = document.querySelectorAll('.player-right .meta-row span');
      if (metaSpans.length > 0) {
        const rawPos = metaSpans[0].textContent.trim().toLowerCase();
        if (rawPos.includes('base') || rawPos.includes('escolta')) {
          bio.position = 'Guard';
        } else if (rawPos.includes('alero') || rawPos.includes('ala-pívot') || rawPos.includes('ala') || rawPos.includes('ala-pivot')) {
          bio.position = 'Forward';
        } else if (rawPos.includes('pívot') || rawPos.includes('pivot')) {
          bio.position = 'Center';
        } else {
          bio.position = 'Guard';
        }
      }
      if (metaSpans.length > 1) {
        bio.height = metaSpans[1].textContent.trim(); // e.g. "185 cm"
      }
      
      // 2. Extract country
      const countryEl = document.querySelector('.stat-country .value');
      if (countryEl) {
        bio.nationality = countryEl.textContent.trim();
      }
      
      // 3. Extract age
      const ageEl = document.querySelector('.stat-birth .value');
      if (ageEl) {
        const m = ageEl.textContent.match(/(\d+)\s*años/);
        if (m) {
          bio.age = parseInt(m[1]);
        }
      }
      
      // 4. Extract advanced stats from the advanced stats table
      const advTable = document.getElementById('advanced-0');
      if (advTable) {
        const rows = advTable.querySelectorAll('tbody tr');
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('td'));
          if (cells.length < 19) continue;
          
          const tempText = cells[0].textContent.trim();
          const ligaText = cells[1].textContent.trim();
          
          if (tempText === dbasketTemp && (ligaText === 'Prim. FEB' || ligaText === 'Primera FEB')) {
            const parseVal = (idx) => parseFloat(cells[idx].textContent.replace('%', '').replace(',', '.')) || 0;
            bio.tsPct = parseVal(7);
            bio.efgPct = parseVal(8);
            bio.tpAr = parseVal(9); // RT3
            bio.ftR = parseVal(10); // RTL
            bio.orbPct = parseVal(11); // %RO
            bio.drbPct = parseVal(12); // %RD
            bio.trbPct = parseVal(13); // %REB
            bio.astPct = parseVal(14); // %ASI
            bio.stlPct = parseVal(15); // %ROB
            bio.blkPct = parseVal(16); // %TAP
            bio.toPct = parseVal(17); // %PER
            bio.usgPct = parseVal(18); // %USO
            if (cells[19]) {
              bio.poss = parseVal(19); // Ritmo
            }
            break;
          }
        }
      }
      
      return bio;
    }, dbasketTemp);
    
    return bioAndAdvanced;
  } catch (err) {
    console.error(`[Scraper] Error scraping dbasket player details for ${playerSlug}:`, err.message);
    return null;
  } finally {
    try {
      await page.close();
    } catch (closeErr) {
      // Ignored
    }
  }
}

/**
 * Scrape the entire Primera FEB league from dbasket.net
 */
async function scrapeDbasketLeague(targetSeason) {
  const allPlayers = [];
  
  // Reset progress specifically for dbasket
  progress = {
    status: 'scraping',
    league: 'Primera FEB',
    leagueSlug: 'primera-feb',
    totalTeams: 0,
    scrapedTeams: 0,
    totalPlayers: 0,
    scrapedPlayers: 0,
    currentTeam: '',
    currentPlayer: '',
    errors: [],
    startedAt: new Date().toISOString(),
    completedAt: null
  };

  const parts = targetSeason.split('-');
  let dbasketSeason = parts.length === 2 ? `${parts[0]}-${parts[1].slice(-2)}` : '2025-26';
  
  const page = await browser.newPage();
  try {
    console.log(`[Scraper] Starting dbasket scrape for Primera FEB (${targetSeason})`);
    
    // Step 1: Get teams
    const indexUrl = `${DBASKET_BASE_URL}/seasons/pfeb/${dbasketSeason}`;
    console.log(`[Scraper] Loading index page: ${indexUrl}`);
    await page.goto(indexUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    const teams = await page.evaluate(() => {
      // Parse using window.chartStats if available
      try {
        if (window.chartStats && Array.from(window.chartStats).length > 0) {
          return window.chartStats.map(t => ({
            name: t.abreviatura,
            abbr: t.abreviatura
          }));
        }
      } catch (e) {}
      
      // Fallback
      const links = Array.from(document.querySelectorAll('a[href*="/teams/"]'));
      const list = [];
      const seen = new Set();
      for (const link of links) {
        const href = link.getAttribute('href');
        const m = href.match(/\/teams\/([A-Z0-9]+)/i);
        if (m) {
          const abbr = m[1].toUpperCase();
          if (!seen.has(abbr)) {
            seen.add(abbr);
            list.push({ name: link.textContent.trim() || abbr, abbr });
          }
        }
      }
      return list;
    });

    console.log(`[Scraper] Found ${teams.length} teams in Primera FEB.`);
    progress.totalTeams = teams.length;
    
    if (teams.length === 0) {
      throw new Error('No teams found in Primera FEB season page');
    }
    
    // Step 2: For each team, get players
    for (let t = 0; t < teams.length; t++) {
      const team = teams[t];
      console.log(`[Scraper] Scraping dbasket team ${t + 1}/${teams.length}: ${team.abbr}`);
      
      const teamUrl = `${DBASKET_BASE_URL}/teams/${team.abbr}/${dbasketSeason}/pfeb`;
      await page.goto(teamUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Extract team name
      const teamDetails = await page.evaluate(() => {
        const h1 = document.querySelector('h1.team-name');
        let name = '';
        if (h1) {
          name = h1.textContent.split('-')[0].trim();
        }
        return { name };
      });
      
      const teamName = teamDetails.name || team.name;
      progress.currentTeam = teamName;
      
      // Extract players from table
      const teamPlayers = await page.evaluate(() => {
        const tables = Array.from(document.querySelectorAll('.tabla-boxscore'));
        const table = tables.find(t => {
          const firstTh = t.querySelector('thead th');
          return firstTh && firstTh.textContent.trim().toLowerCase().includes('jugador');
        });
        if (!table) return [];
        
        const headerRow = table.querySelector('thead tr');
        if (!headerRow) return [];
        const headers = Array.from(headerRow.querySelectorAll('th')).map(th => th.textContent.trim());
        
        const rows = table.querySelectorAll('tbody tr');
        const list = [];
        
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('td'));
          if (cells.length < 5) continue;
          
          const linkEl = cells[0].querySelector('a');
          if (!linkEl) continue;
          
          const pName = linkEl.textContent.trim();
          const href = linkEl.getAttribute('href');
          const pSlug = href.split('/').pop();
          
          const getStatByHeader = (headerName) => {
            const idx = headers.indexOf(headerName);
            if (idx !== -1 && cells[idx]) {
              const text = cells[idx].textContent.trim();
              return parseFloat(text.replace('%', '').replace(',', '.')) || 0;
            }
            return 0;
          };
          
          list.push({
            name: pName,
            slug: pSlug,
            stats: {
              gp: getStatByHeader('PJ'),
              min: getStatByHeader('MIN'),
              pts: getStatByHeader('PTS'),
              reb: getStatByHeader('REB'),
              oreb: getStatByHeader('RO'),
              dreb: getStatByHeader('RD'),
              ast: getStatByHeader('ASI'),
              stl: getStatByHeader('ROB'),
              blk: getStatByHeader('TAP'),
              to: getStatByHeader('PER'),
              pf: getStatByHeader('FP'),
              fgPct: getStatByHeader('%TC'),
              tpPct: getStatByHeader('%T3'),
              twoPPct: getStatByHeader('%T2'),
              ftPct: getStatByHeader('%TL'),
              eval: getStatByHeader('VAL')
            }
          });
        }
        return list;
      });
      
      console.log(`[Scraper] Team ${teamName} has ${teamPlayers.length} players.`);
      progress.totalPlayers += teamPlayers.length;
      
      // Step 3: Visit each player page to get bio & advanced stats
      for (const p of teamPlayers) {
        progress.currentPlayer = p.name;
        console.log(`[Scraper]   Scraping player bio & advanced stats: ${p.name}`);
        
        await delay(1000); // Courtesy delay
        
        const details = await scrapeDbasketPlayerBioAndAdvanced(p.slug, targetSeason);
        
        const playerObj = {
          slug: p.slug,
          name: p.name,
          position: (details && details.position) || 'Guard',
          height: (details && details.height) || '',
          age: (details && details.age) || null,
          nationality: (details && details.nationality) || '',
          team: teamName,
          teamSlug: team.abbr,
          league: 'Primera FEB',
          leagueSlug: 'primera-feb',
          season: targetSeason,
          stats: {
            ...p.stats,
            tsPct: (details && details.tsPct) || 0,
            efgPct: (details && details.efgPct) || 0,
            usgPct: (details && details.usgPct) || 0,
            pir: p.stats.eval || 0,
            pie: 0, // not available on dbasket
            poss: (details && details.poss) || 0,
            tpAr: (details && details.tpAr) || 0,
            ftR: (details && details.ftR) || 0,
            orbPct: (details && details.orbPct) || 0,
            drbPct: (details && details.drbPct) || 0,
            trbPct: (details && details.trbPct) || 0,
            astPct: (details && details.astPct) || 0,
            toPct: (details && details.toPct) || 0,
            astToRatio: p.stats.to > 0 ? (p.stats.ast / p.stats.to) : 0,
            stlPct: (details && details.stlPct) || 0,
            blkPct: (details && details.blkPct) || 0
          }
        };
        
        allPlayers.push(playerObj);
        progress.scrapedPlayers++;
      }
      progress.scrapedTeams++;
    }
    
    // Save to partitioned season database
    const seasonFilePath = path.join(DATA_DIR, `players-${targetSeason}.json`);
    let existingPlayers = [];
    if (fs.existsSync(seasonFilePath)) {
      try {
        const raw = fs.readFileSync(seasonFilePath, 'utf-8');
        const data = JSON.parse(raw);
        existingPlayers = data.players || [];
      } catch (err) {
        console.error(`[Scraper] Error loading season file ${seasonFilePath}:`, err.message);
      }
    }
    
    const otherLeaguePlayers = existingPlayers.filter(p => p.leagueSlug !== 'primera-feb');
    const mergedPlayers = [...otherLeaguePlayers, ...allPlayers];
    
    saveDatabase(mergedPlayers, targetSeason);
    
    progress.status = 'done';
    progress.completedAt = new Date().toISOString();
    console.log(`[Scraper] Scraped Primera FEB complete. ${allPlayers.length} players added.`);
    
    return allPlayers;
    
  } catch (err) {
    console.error(`[Scraper] Fatal error during dbasket scraping:`, err.message);
    progress.status = 'error';
    progress.errors.push({ type: 'fatal', error: err.message });
    throw err;
  } finally {
    await page.close();
    await closeBrowser();
  }
}

/**
 * Get current scraping progress.
 */
function getProgress() {
  return { ...progress };
}

/**
 * Get configured leagues.
 */
function getLeagues() {
  return LEAGUES;
}

// ─── Standalone mode ──────────────────────────────────────────────────────────
if (process.argv.includes('--standalone')) {
  const slug = process.argv[process.argv.indexOf('--standalone') + 1] || 'liga-endesa';
  console.log(`[Scraper] Running standalone scrape for: ${slug}`);
  
  (async () => {
    try {
      const players = await scrapeFullLeague(slug);
      console.log(`[Scraper] Done. Scraped ${players.length} player entries.`);
    } catch (err) {
      console.error('[Scraper] Standalone scrape failed:', err);
    } finally {
      await closeBrowser();
      process.exit(0);
    }
  })();
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  initBrowser,
  closeBrowser,
  scrapeLeagueTeams,
  scrapeTeamPlayers,
  scrapePlayerStats,
  scrapeFullLeague,
  getProgress,
  getLeagues,
  loadDatabase,
  saveDatabase,
  scrapePlayerGames,
  scrapeDbasketPlayerBioAndAdvanced,
  scrapeGameBoxscore
};
