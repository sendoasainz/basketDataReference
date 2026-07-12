/**
 * stats-engine.js — Comparison engine for basketball player stats
 * 
 * Core logic: ±deviation is ABSOLUTE (not percentage).
 * If searching PIR 12 with deviation 1, players with 11-13 match.
 */

// ─── Stat keys available for comparison ───────────────────────────────────────
const STAT_KEYS = [
  'pts', 'reb', 'ast', 'stl', 'blk', 'to', 'min',
  'fgPct', 'tpPct', 'ftPct', 'twoPPct',
  'eval', 'gp', 'oreb', 'dreb', 'pf',
  'tsPct', 'efgPct', 'usgPct',
  'pir', 'pie', 'poss', 'tpAr', 'ftR',
  'orbPct', 'drbPct', 'trbPct', 'astPct', 'toPct',
  'astToRatio', 'stlPct', 'blkPct'
];

// Stat keys that typically appear in raw data (without advanced calculations)
const RAW_STAT_KEYS = [
  'pts', 'reb', 'ast', 'stl', 'blk', 'to', 'min',
  'fgPct', 'tpPct', 'ftPct', 'twoPPct',
  'eval', 'gp', 'oreb', 'dreb', 'pf'
];

// Only these 6 core stats are used for similarity comparison (by name).
// All stats are still DISPLAYED in the results table.
const COMPARISON_KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'eval'];

/**
 * Find a player by name (case-insensitive, partial match) and return
 * similar players within ±deviation on each stat.
 * 
 * @param {string} playerName - Name to search for
 * @param {Array} database - Array of player objects
 * @param {number} deviation - Absolute deviation (default 1)
 * @returns {object} { target, similar }
 */
function findSimilarByName(playerName, database, deviation = 1, season = null, leagueSlug = null) {
  if (!playerName || !database || database.length === 0) {
    return { target: null, similar: [], error: 'Invalid input or empty database' };
  }

  const searchName = playerName.toLowerCase().trim();

  // Find the target player — try exact match + season + leagueSlug first
  let target = null;
  if (season && leagueSlug) {
    target = database.find(p => 
      p.name && p.name.toLowerCase() === searchName && p.season === season && p.leagueSlug === leagueSlug
    );
  }

  if (!target && season) {
    target = database.find(p => 
      p.name && p.name.toLowerCase() === searchName && p.season === season
    );
  }
  
  if (!target) {
    target = database.find(p => 
      p.name && p.name.toLowerCase() === searchName
    );
  }

  if (!target) {
    target = database.find(p => 
      p.name && p.name.toLowerCase().includes(searchName)
    );
  }

  if (!target) {
    // Try matching individual words
    const words = searchName.split(/\s+/);
    target = database.find(p => {
      if (!p.name) return false;
      const pName = p.name.toLowerCase();
      return words.every(w => pName.includes(w));
    });
  }

  if (!target) {
    return { 
      target: null, 
      similar: [], 
      error: `Player "${playerName}" not found in database` 
    };
  }

  // Get the target's stats
  const targetStats = target.stats || {};
  
  // Compare only the 6 core stats (pts, reb, ast, stl, blk, eval)
  const comparableKeys = COMPARISON_KEYS.filter(key => 
    targetStats[key] !== undefined && targetStats[key] !== null
  );

  if (comparableKeys.length === 0) {
    return { target, similar: [], error: 'Target player has no comparable stats' };
  }

  // Find similar players
  const similar = [];

  for (const player of database) {
    // Skip the target player (same slug + season)
    if (player.slug === target.slug && player.season === target.season) {
      continue;
    }

    const playerStats = player.stats || {};
    let allMatch = true;
    let matchedKeys = 0;

    for (const key of comparableKeys) {
      const targetVal = targetStats[key];
      const playerVal = playerStats[key];

      if (playerVal === undefined || playerVal === null) {
        // If player doesn't have this stat, skip it but don't disqualify
        continue;
      }

      if (Math.abs(targetVal - playerVal) > deviation) {
        allMatch = false;
        break;
      }

      matchedKeys++;
    }

    // Must match on at least a few stats to be meaningful
    if (allMatch && matchedKeys >= Math.min(3, comparableKeys.length)) {
      const score = calculateSimilarityScore(targetStats, playerStats, comparableKeys);
      similar.push({
        ...player,
        similarityScore: score,
        matchedStats: matchedKeys,
        totalComparableStats: comparableKeys.length
      });
    }
  }

  // Sort by similarity score (highest first)
  similar.sort((a, b) => b.similarityScore - a.similarityScore);

  return {
    target,
    similar,
    deviation,
    comparableStats: comparableKeys,
    totalCandidates: database.length
  };
}

/**
 * Find players matching specific input stats within ±deviation.
 * 
 * @param {object} inputStats - Stats to match (e.g. { pts: 15, reb: 7, ast: 3 })
 * @param {Array} database - Array of player objects
 * @param {number} deviation - Absolute deviation (default 1)
 * @param {object} filters - Optional filters: { leagues: [], positions: [], minGP: number }
 * @returns {object} { matches, query }
 */
function findSimilarByStats(inputStats, database, deviation = 1, filters = {}) {
  if (!inputStats || Object.keys(inputStats).length === 0) {
    return { matches: [], error: 'No stats provided' };
  }

  if (!database || database.length === 0) {
    return { matches: [], error: 'Empty database' };
  }

  // Normalize input stat keys
  const normalizedInput = {};
  for (const [key, value] of Object.entries(inputStats)) {
    const normalizedKey = normalizeStatKey(key);
    if (normalizedKey && typeof value === 'number') {
      normalizedInput[normalizedKey] = value;
    }
  }

  const searchKeys = Object.keys(normalizedInput);
  if (searchKeys.length === 0) {
    return { matches: [], error: 'No valid numeric stats provided' };
  }

  // Apply filters to database
  let candidates = [...database];

  if (filters.leagues && filters.leagues.length > 0) {
    const leagueSlugs = filters.leagues.map(l => l.toLowerCase());
    candidates = candidates.filter(p => 
      leagueSlugs.includes((p.leagueSlug || '').toLowerCase()) ||
      leagueSlugs.includes((p.league || '').toLowerCase())
    );
  }

  if (filters.positions && filters.positions.length > 0) {
    const positions = filters.positions.map(p => p.toLowerCase());
    candidates = candidates.filter(p =>
      positions.some(pos => (p.position || '').toLowerCase().includes(pos))
    );
  }

  if (filters.minGP && typeof filters.minGP === 'number') {
    candidates = candidates.filter(p =>
      p.stats && p.stats.gp && p.stats.gp >= filters.minGP
    );
  }

  // Find matching players
  const matches = [];

  for (const player of candidates) {
    const playerStats = player.stats || {};
    let allMatch = true;
    let matchedKeys = 0;

    for (const key of searchKeys) {
      const inputVal = normalizedInput[key];
      const playerVal = playerStats[key];

      if (playerVal === undefined || playerVal === null) {
        // Player doesn't have this stat — skip but don't disqualify
        continue;
      }

      if (Math.abs(inputVal - playerVal) > deviation) {
        allMatch = false;
        break;
      }

      matchedKeys++;
    }

    if (allMatch && matchedKeys >= Math.min(2, searchKeys.length)) {
      const score = calculateSimilarityScore(normalizedInput, playerStats, searchKeys);
      matches.push({
        ...player,
        similarityScore: score,
        matchedStats: matchedKeys,
        totalSearchStats: searchKeys.length
      });
    }
  }

  // Sort by similarity score
  matches.sort((a, b) => b.similarityScore - a.similarityScore);

  return {
    matches,
    query: normalizedInput,
    deviation,
    searchKeys,
    totalCandidates: candidates.length,
    totalDatabase: database.length,
    filtersApplied: {
      leagues: filters.leagues || [],
      positions: filters.positions || [],
      minGP: filters.minGP || null
    }
  };
}

/**
 * Calculate a normalized similarity score (0-100) between two stat sets.
 * Score is based on how close each stat is — closer means higher score.
 * 
 * @param {object} stats1 - First stat set (reference)
 * @param {object} stats2 - Second stat set (candidate)
 * @param {Array} statKeys - Keys to compare
 * @returns {number} Similarity score 0-100
 */
function calculateSimilarityScore(stats1, stats2, statKeys) {
  if (!statKeys || statKeys.length === 0) return 0;

  let totalScore = 0;
  let comparisons = 0;

  for (const key of statKeys) {
    const val1 = stats1[key];
    const val2 = stats2[key];

    if (val1 === undefined || val1 === null || val2 === undefined || val2 === null) {
      continue;
    }

    // Calculate closeness for this stat
    // Use the max possible range to normalize
    const maxRange = getStatMaxRange(key);
    const diff = Math.abs(val1 - val2);
    
    // Score: 100 when identical, 0 when diff equals maxRange
    const statScore = Math.max(0, 100 * (1 - diff / maxRange));
    totalScore += statScore;
    comparisons++;
  }

  if (comparisons === 0) return 0;
  return Math.round((totalScore / comparisons) * 100) / 100;
}

/**
 * Get the approximate max range for a stat key (for normalization).
 */
function getStatMaxRange(key) {
  const ranges = {
    pts: 35,
    reb: 15,
    ast: 15,
    stl: 5,
    blk: 5,
    to: 8,
    min: 40,
    fgPct: 70,
    tpPct: 60,
    ftPct: 50,
    twoPPct: 70,
    eval: 40,
    gp: 50,
    oreb: 6,
    dreb: 12,
    pf: 5,
    tsPct: 50,
    efgPct: 50,
    usgPct: 40,
    pir: 40,
    pie: 30,
    poss: 30,
    tpAr: 100,
    ftR: 100,
    orbPct: 30,
    drbPct: 50,
    trbPct: 40,
    astPct: 60,
    toPct: 40,
    astToRatio: 10,
    stlPct: 10,
    blkPct: 10
  };
  return ranges[key] || 30;
}

/**
 * Calculate advanced stats from raw stats.
 * 
 * - TS% = PTS / (2 * (FGA + 0.44 * FTA)) * 100
 * - eFG% = (FGM + 0.5 * 3PM) / FGA * 100
 * - AST/TO = AST / TO
 * 
 * @param {object} rawStats - Raw player stats
 * @returns {object} Stats with advanced metrics added
 */
function calculateAdvancedStats(rawStats) {
  const stats = { ...rawStats };

  // True Shooting %
  // Requires: pts, fga (field goal attempts), fta (free throw attempts)
  if (stats.pts !== undefined && stats.fga !== undefined && stats.fta !== undefined) {
    const denominator = 2 * (stats.fga + 0.44 * stats.fta);
    stats.tsPct = denominator > 0
      ? Math.round((stats.pts / denominator) * 10000) / 100
      : 0;
  }

  // Effective FG%
  // Requires: fgm (field goals made), tpm (3-pointers made), fga
  if (stats.fgm !== undefined && stats.tpm !== undefined && stats.fga !== undefined) {
    stats.efgPct = stats.fga > 0
      ? Math.round(((stats.fgm + 0.5 * stats.tpm) / stats.fga) * 10000) / 100
      : 0;
  }

  // AST/TO ratio
  if (stats.ast !== undefined && stats.to !== undefined) {
    stats.astToRatio = stats.to > 0
      ? Math.round((stats.ast / stats.to) * 100) / 100
      : stats.ast > 0 ? Infinity : 0;
  }

  // Approximate TS% from percentages if raw attempts not available
  if (stats.tsPct === undefined && stats.pts !== undefined && stats.fgPct !== undefined && stats.ftPct !== undefined) {
    // Rough estimation when we only have percentages
    // This is a simplified approximation
    const estimatedFGA = stats.pts / (stats.fgPct / 100 * 2 || 1);
    const estimatedFTA = estimatedFGA * 0.3; // rough ratio
    const denom = 2 * (estimatedFGA + 0.44 * estimatedFTA);
    if (denom > 0) {
      stats.tsPct = Math.round((stats.pts / denom) * 10000) / 100;
    }
  }

  return stats;
}

/**
 * Normalize season strings.
 */
function normalizeSeason(seasonStr) {
  if (!seasonStr) return null;
  const cleaned = seasonStr.replace(/\//g, '-').trim();
  if (cleaned.match(/^(26-27|2026-2027|26\/27)$/)) return '2026-2027';
  if (cleaned.match(/^(25-26|2025-2026|25\/26)$/)) return '2025-2026';
  if (cleaned.match(/^(24-25|2024-2025|24\/25)$/)) return '2024-2025';
  return null;
}

/**
 * Normalize a stat key to our standard format.
 */
function normalizeStatKey(key) {
  if (!key) return null;
  const map = {
    'pts': 'pts', 'points': 'pts', 'ppg': 'pts',
    'reb': 'reb', 'rebounds': 'reb', 'rpg': 'reb',
    'ast': 'ast', 'assists': 'ast', 'apg': 'ast',
    'stl': 'stl', 'steals': 'stl', 'spg': 'stl',
    'blk': 'blk', 'blocks': 'blk', 'bpg': 'blk',
    'to': 'to', 'turnovers': 'to', 'tov': 'to',
    'min': 'min', 'minutes': 'min', 'mpg': 'min',
    'gp': 'gp', 'games': 'gp',
    'pf': 'pf', 'fouls': 'pf',
    'oreb': 'oreb',
    'dreb': 'dreb',
    'fgpct': 'fgPct', 'fg%': 'fgPct', 'fgPct': 'fgPct',
    'tppct': 'tpPct', '3p%': 'tpPct', 'tpPct': 'tpPct', '3ppct': 'tpPct',
    'twoppct': 'twoPPct', '2p%': 'twoPPct', 'twoPPct': 'twoPPct',
    'ftpct': 'ftPct', 'ft%': 'ftPct', 'ftPct': 'ftPct',
    'eval': 'eval', 'eff': 'eval',
    'pir': 'pir',
    'pie': 'pie',
    'poss': 'poss', 'poss.': 'poss',
    'tspct': 'tsPct', 'ts%': 'tsPct', 'tsPct': 'tsPct',
    'efgpct': 'efgPct', 'efg%': 'efgPct', 'efgPct': 'efgPct',
    'usgpct': 'usgPct', 'usg%': 'usgPct', 'usgPct': 'usgPct',
    'tpar': 'tpAr', '3par': 'tpAr',
    'ftr': 'ftR',
    'orbpct': 'orbPct', 'orb%': 'orbPct',
    'drbpct': 'drbPct', 'drb%': 'drbPct',
    'trbpct': 'trbPct', 'trb%': 'trbPct',
    'astpct': 'astPct', 'ast%': 'astPct',
    'topct': 'toPct', 'to%': 'toPct',
    'asttoratio': 'astToRatio', 'ast-to rat.': 'astToRatio', 'ast-to ratio': 'astToRatio',
    'stlpct': 'stlPct', 'stl%': 'stlPct',
    'blkpct': 'blkPct', 'blk%': 'blkPct'
  };
  return map[key] || map[key.toLowerCase()] || null;
}

function getLeagueSlug(leagueName) {
  if (!leagueName) return '';
  const cleaned = leagueName.toLowerCase().trim();
  
  if (cleaned.includes('endesa') || cleaned.includes('acb') || cleaned === 'esp' || cleaned === 'esp 1') return 'liga-endesa';
  if (cleaned.includes('fiba europe') || cleaned.includes('fec') || cleaned.includes('fiba ec')) return 'fiba-europe-cup';
  if (cleaned.includes('champions') || cleaned.includes('bcl')) return 'basketball-champions-league';
  if (cleaned.includes('feb') || cleaned.includes('adecco') || cleaned.includes('oro') || cleaned.includes('primera feb')) return 'primera-feb';
  if (cleaned.includes('bbl') || cleaned.includes('easycredit') || cleaned === 'ger' || cleaned === 'ger 1' || cleaned === 'deu') return 'easycredit-bbl';
  if (cleaned.includes('betclic') || cleaned.includes('lnb') || cleaned === 'fra' || cleaned === 'fra 1') return 'betclic-elite';
  if (cleaned.includes('lega') || cleaned.includes('lba') || cleaned === 'ita' || cleaned === 'ita 1') return 'lega-basket-serie-a';
  if (cleaned.includes('esake') || cleaned.includes('gbl') || cleaned === 'grc' || cleaned === 'grc 1') return 'esake';
  if (cleaned.includes('aba') || cleaned.includes('adriatic')) return 'aba-liga';
  if (cleaned.includes('bnxt')) return 'bnxt-league';
  if (cleaned.includes('bsl') || cleaned.includes('tbf') || cleaned === 'tur' || cleaned === 'tur 1') return 'basketbol-super-ligi';
  if (cleaned.includes('lkl') || cleaned === 'ltu' || cleaned === 'ltu 1') return 'betsafe-lkl';
  if (cleaned.includes('g league') || cleaned.includes('g-league') || cleaned === 'glg') return 'g-league';
  
  return cleaned;
}

/**
 * Compare player game logs against season averages.
 * Categorizes stats into Green (+1), Red (-1), or Yellow (0).
 * Identifies the top 3 best and worst opponent matchups.
 */
function analyzePlayerMatchups(playerStats, gameLogs) {
  if (!playerStats || !gameLogs || gameLogs.length === 0) {
    return { success: false, error: 'Faltan estadísticas del jugador o historial de partidos' };
  }

  const targetSeason = normalizeSeason(playerStats.season) || '2025-2026';
  const coreStats = ['pts', 'reb', 'ast', 'stl', 'blk', 'eval'];

  // Filter game logs to keep only the requested season and league/competition
  const filteredGames = gameLogs.filter(game => {
    const gameSeason = normalizeSeason(game.season);
    if (gameSeason !== targetSeason && gameSeason) return false;
    
    if (playerStats.league && game.league) {
      const pSlug = getLeagueSlug(playerStats.league);
      const gSlug = getLeagueSlug(game.league);
      if (pSlug && gSlug) {
        return pSlug === gSlug;
      }
    }
    return true;
  });

  if (filteredGames.length === 0) {
    return {
      success: true,
      playerSlug: playerStats.slug,
      season: targetSeason,
      analyzedGamesCount: 0,
      bestMatchups: [],
      worstMatchups: [],
      allMatchupsByOpponent: [],
      games: []
    };
  }

  const gamesAnalyzed = [];
  const opponentMap = new Map();

  for (const game of filteredGames) {
    const avgStats = playerStats.stats || {};

    let greens = 0;
    let reds = 0;
    let yellows = 0;
    let netScore = 0;
    const colors = {};
    const diffs = {};

    for (const stat of coreStats) {
      const gameVal = game[stat];
      const avgVal = avgStats[stat];

      if (gameVal === undefined || gameVal === null || avgVal === undefined || avgVal === null) {
        colors[stat] = 'yellow';
        diffs[stat] = 0;
        continue;
      }

      const diff = gameVal - avgVal;
      diffs[stat] = Math.round(diff * 100) / 100;

      if (diff > 0.5) {
        greens++;
        colors[stat] = 'green';
        netScore += 1;
      } else if (diff < -0.5) {
        reds++;
        colors[stat] = 'red';
        netScore -= 1;
      } else {
        yellows++;
        colors[stat] = 'yellow';
      }
    }

    const gameAnalysis = {
      date: game.date || '—',
      opponent: game.opponent || 'Desconocido',
      score: game.score || '—',
      gameUrl: game.gameUrl || null,
      season: game.season || targetSeason,
      stats: {
        pts: game.pts || 0,
        reb: game.reb || 0,
        ast: game.ast || 0,
        stl: game.stl || 0,
        blk: game.blk || 0,
        eval: game.eval || 0,
        min: game.min || 0
      },
      analysis: {
        greens,
        reds,
        yellows,
        netScore,
        status: netScore > 0 ? 'good' : (netScore < 0 ? 'bad' : 'normal'),
        colors,
        diffs
      }
    };

    gamesAnalyzed.push(gameAnalysis);

    // Group by opponent
    const oppName = gameAnalysis.opponent;
    if (!opponentMap.has(oppName)) {
      opponentMap.set(oppName, {
        opponent: oppName,
        count: 0,
        totalNetScore: 0,
        statsSum: { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, eval: 0, min: 0 },
        games: []
      });
    }

    const oppData = opponentMap.get(oppName);
    oppData.count += 1;
    oppData.totalNetScore += netScore;
    oppData.games.push(gameAnalysis);
    
    // Sum stats for averaging
    oppData.statsSum.pts += game.pts || 0;
    oppData.statsSum.reb += game.reb || 0;
    oppData.statsSum.ast += game.ast || 0;
    oppData.statsSum.stl += game.stl || 0;
    oppData.statsSum.blk += game.blk || 0;
    oppData.statsSum.eval += game.eval || 0;
    oppData.statsSum.min += game.min || 0;
  }

  // Calculate averages per opponent
  const allMatchups = Array.from(opponentMap.values()).map(opp => {
    const avgNetScore = Math.round((opp.totalNetScore / opp.count) * 100) / 100;
    return {
      opponent: opp.opponent,
      count: opp.count,
      avgNetScore,
      status: avgNetScore > 0 ? 'good' : (avgNetScore < 0 ? 'bad' : 'normal'),
      statsAvg: {
        pts: Math.round((opp.statsSum.pts / opp.count) * 10) / 10,
        reb: Math.round((opp.statsSum.reb / opp.count) * 10) / 10,
        ast: Math.round((opp.statsSum.ast / opp.count) * 10) / 10,
        stl: Math.round((opp.statsSum.stl / opp.count) * 10) / 10,
        blk: Math.round((opp.statsSum.blk / opp.count) * 10) / 10,
        eval: Math.round((opp.statsSum.eval / opp.count) * 10) / 10,
        min: Math.round((opp.statsSum.min / opp.count) * 10) / 10
      },
      diffsAvg: {
        pts: Math.round(((opp.statsSum.pts / opp.count) - (playerStats.stats.pts || 0)) * 10) / 10,
        reb: Math.round(((opp.statsSum.reb / opp.count) - (playerStats.stats.reb || 0)) * 10) / 10,
        ast: Math.round(((opp.statsSum.ast / opp.count) - (playerStats.stats.ast || 0)) * 10) / 10,
        stl: Math.round(((opp.statsSum.stl / opp.count) - (playerStats.stats.stl || 0)) * 10) / 10,
        blk: Math.round(((opp.statsSum.blk / opp.count) - (playerStats.stats.blk || 0)) * 10) / 10,
        eval: Math.round(((opp.statsSum.eval / opp.count) - (playerStats.stats.eval || 0)) * 10) / 10
      }
    };
  });

  // Sort matchups to find best and worst
  const bestMatchups = allMatchups
    .filter(m => m.avgNetScore > 0)
    .sort((a, b) => b.avgNetScore - a.avgNetScore)
    .slice(0, 3);

  const worstMatchups = allMatchups
    .filter(m => m.avgNetScore < 0)
    .sort((a, b) => a.avgNetScore - b.avgNetScore)
    .slice(0, 3);

  return {
    success: true,
    playerSlug: playerStats.slug,
    season: targetSeason,
    analyzedGamesCount: filteredGames.length,
    bestMatchups,
    worstMatchups,
    allMatchupsByOpponent: allMatchups.sort((a, b) => b.avgNetScore - a.avgNetScore),
    games: gamesAnalyzed
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  findSimilarByName,
  findSimilarByStats,
  calculateSimilarityScore,
  calculateAdvancedStats,
  STAT_KEYS,
  RAW_STAT_KEYS,
  analyzePlayerMatchups
};
