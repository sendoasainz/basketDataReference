/* ============================================================
   BasketScout Pro — app.js
   Vanilla JS · Canvas Radar Chart · No external libraries
   Language: Spanish
   ============================================================ */

// ─── State ──────────────────────────────────────────────────
const state = {
  database: [],
  leagues: [],
  currentTab: 'search-name',
  searchResults: null,
  targetPlayer: null,
  selectedSimilar: null,
  isLoading: false,
  scrapeStatus: null,
  scrapePolling: null,
  autocompleteIndex: -1,
  showProjection: false,
  selectedFilterPositions: new Set(),
  comparisonPlayers: [null, null, null, null],
};

const LEAGUE_TRANSLATION_FACTORS = {
  'euroleague': 1.15,
  'eurocup': 0.95,
  'liga-endesa': 1.00,
  'basketbol-super-ligi': 0.90,
  'basketball-champions-league': 0.90,
  'vtb-united-league': 0.85,
  'aba-liga': 0.80,
  'g-league': 0.80,
  'lega-basket-serie-a': 0.775,
  'betclic-elite': 0.775,
  'easycredit-bbl': 0.775,
  'esake': 0.70,
  'betsafe-lkl': 0.70,
  'fiba-europe-cup': 0.65,
  'pbl': 0.60,
  'tbl': 0.60,
  'bnxt-league': 0.575,
  'primera-feb': 0.525,
  'orlen-basket-liga': 0.65
};

// ─── Stat metadata ──────────────────────────────────────────
const STAT_LABELS = {
  gp: 'PJ', min: 'MIN', pts: 'PTS', reb: 'REB', oreb: 'OREB', dreb: 'DREB',
  ast: 'AST', stl: 'ROB', blk: 'TAP', to: 'PER', pf: 'FP',
  fgPct: 'TC%', tpPct: 'T3%', twoPPct: 'T2%', ftPct: 'TL%',
  eval: 'VAL', tsPct: 'TS%', efgPct: 'eFG%',
  pir: 'PIR', pie: 'PIE', usgPct: 'USG%', poss: 'POSS.',
  tpAr: '3PAr', ftR: 'FTr', orbPct: 'ORB%', drbPct: 'DRB%',
  trbPct: 'TRB%', astPct: 'AST%', toPct: 'TO%', astToRatio: 'AST-TO RAT.',
  stlPct: 'STL%', blkPct: 'BLK%', netRtg: 'EST. NET RTG'
};

const PERCENTAGE_STATS = new Set([
  'fgPct', 'tpPct', 'twoPPct', 'ftPct', 'tsPct', 'efgPct',
  'usgPct', 'tpAr', 'ftR', 'orbPct', 'drbPct', 'trbPct',
  'astPct', 'toPct', 'stlPct', 'blkPct'
]);

const RADAR_AXES = ['pts', 'reb', 'ast', 'stl', 'blk', 'eval'];
const RADAR_LABELS = ['PTS', 'REB', 'AST', 'ROB', 'TAP', 'VAL'];

const POSITION_MAP = {
  Guard: 'Base / Escolta',
  Forward: 'Alero / Ala-Pívot',
  Center: 'Pívot',
};

// ─── Utility functions ──────────────────────────────────────
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function getPositionCategory(pos) {
  if (!pos) return 'Otros';
  const p = pos.toLowerCase();
  if (p.includes('point guard') || p.includes('base') || p === 'pg') return 'Base';
  if (p.includes('shooting guard') || p.includes('escolta') || p === 'sg') return 'Escolta';
  if (p.includes('small forward') || p.includes('alero') || p === 'sf' || p === 'forward-guard') return 'Alero';
  if (p.includes('power forward') || p.includes('ala-pívot') || p.includes('ala-pivot') || p === 'pf') return 'Ala-Pívot';
  if (p.includes('center-forward') || p.includes('pívot') || p.includes('pivot') || p === 'c' || p === 'center') return 'Pívot';
  
  if (p.includes('guard')) return 'Base/Escolta';
  if (p.includes('forward')) return 'Alero/Ala-Pívot';
  
  return 'Otros';
}

function matchesSelectedPositions(playerPos, selectedPosSet) {
  if (selectedPosSet.size === 0) return true;
  
  const category = getPositionCategory(playerPos);
  if (selectedPosSet.has(category)) return true;
  
  if (category === 'Base/Escolta') {
    return selectedPosSet.has('Base') || selectedPosSet.has('Escolta');
  }
  if (category === 'Alero/Ala-Pívot') {
    return selectedPosSet.has('Alero') || selectedPosSet.has('Ala-Pívot');
  }
  
  return false;
}

function formatStat(key, value) {
  if (value == null || value === '') return '—';
  if (PERCENTAGE_STATS.has(key)) return Number(value).toFixed(1) + '%';
  if (key === 'gp') return Math.round(value);
  return Number(value).toFixed(1);
}

function getStatLabel(key) {
  return STAT_LABELS[key] || key.toUpperCase();
}

function normalizeStatForChart(key, value, db) {
  let max = 0;
  for (const p of db) {
    const v = p.stats[key];
    if (v != null && v > max) max = v;
  }
  if (max === 0) return 0;
  return Math.min(value / max, 1);
}

function getPlayerTranslationFactor(player) {
  if (!player) return 1.0;
  return LEAGUE_TRANSLATION_FACTORS[player.leagueSlug] || 0.60;
}

function getProjectedStats(player) {
  const stats = { ...player.stats };
  if (player.trueNetRtg !== undefined) stats.trueNetRtg = player.trueNetRtg;
  if (player.rapm) {
    stats.offRapm = player.rapm.off;
    stats.defRapm = player.rapm.def;
    stats.netRapm = player.rapm.net;
  }
  
  if (!state.showProjection) return stats;
  
  const factor = getPlayerTranslationFactor(player);
  if (factor === 1.0) return stats;
  
  const projected = { ...stats };
  const volumeKeys = ['pts', 'reb', 'ast', 'stl', 'blk', 'eval', 'pir', 'oreb', 'dreb', 'to', 'pf'];
  
  for (const key of volumeKeys) {
    if (projected[key] !== undefined && projected[key] !== null) {
      projected[key] = Math.round((projected[key] * factor) * 10) / 10;
    }
  }
  return projected;
}

function $(id) { return document.getElementById(id); }
function $$(sel, ctx) { return (ctx || document).querySelectorAll(sel); }

// ─── DOM references ─────────────────────────────────────────
const dom = {};
function cacheDom() {
  dom.dbCount = $('db-count');
  dom.tabNav = $('tab-nav');
  dom.tabBtns = $$('.tab-btn');
  dom.tabContents = $$('.tab-content');
  dom.playerSearch = $('player-search');
  dom.autocomplete = $('autocomplete-dropdown');
  dom.devName = $('deviation-name');
  dom.devNameDown = $('dev-name-down');
  dom.devNameUp = $('dev-name-up');
  dom.btnFind = $('btn-find-similar');
  dom.devStats = $('deviation-stats');
  dom.devStatsDown = $('dev-stats-down');
  dom.devStatsUp = $('dev-stats-up');
  dom.filterPosition = $('filter-position');
  dom.filterSeason = $('filter-season');
  dom.leagueChipsStats = $('league-chips-stats');
  dom.btnSearchStats = $('btn-search-stats');
  dom.leagueSelectGrid = $('league-select-grid');
  dom.btnScrape = $('btn-scrape');
  dom.btnSelectAll = $('btn-select-all-leagues');
  dom.btnDeselectAll = $('btn-deselect-all-leagues');
  dom.scrapeArea = $('scrape-progress-area');
  dom.scrapeFill = $('scrape-progress-fill');
  dom.scrapeText = $('scrape-status-text');
  dom.dbSummary = $('db-summary-content');
  dom.btnExport = $('btn-export-json');
  dom.btnClear = $('btn-clear-cache');
  dom.scrapeSeason = $('scrape-season');
  dom.toggleProjection = $('toggle-projection');
  dom.resultsPanel = $('results-panel');
  dom.targetSection = $('target-player-section');
  dom.targetCard = $('target-player-card');
  dom.resultsTbody = $('results-tbody');
  dom.resultsCount = $('results-count');
  dom.radarContainer = $('radar-chart-container');
  dom.radarLegend = $('radar-legend');
  dom.radarCanvas = $('radar-canvas');
  dom.radarTooltip = $('radar-tooltip');
  dom.comparisonTableContainer = $('comparison-table-container');
  dom.loadingOverlay = $('loading-overlay');
  dom.matchupsModal = $('matchups-modal');
  dom.matchupsModalBody = $('matchups-modal-body');
  dom.btnCloseMatchups = $('btn-close-matchups');
  dom.resultsFilterContainer = $('results-filter-container');
  dom.positionFilterChips = $$('#position-filter-chips .filter-chip');
  
  // Comparador DOM reference
  dom.compareSearch = $('compare-search');
  dom.compareAutocomplete = $('compare-autocomplete-dropdown');
  dom.comparisonSlotsGrid = $('comparison-slots-grid');
  dom.comparisonResults = $('comparison-results');
  dom.compareRadarLegend = $('compare-radar-legend');
  dom.compareRadarCanvas = $('compare-radar-canvas');
  dom.compareRadarTooltip = $('compare-radar-tooltip');
  dom.compareTableContainer = $('compare-table-container');
}

// ─── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Unregister any active service workers on localhost to prevent caching issues in development
  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        const success = await registration.unregister();
        if (success) {
          console.log('[App] Service worker unregistered successfully.');
          window.location.reload();
          return;
        }
      }
    } catch (e) {
      console.warn('[App] Error unregistering service worker:', e);
    }
  }

  cacheDom();
  setupTabs();
  setupDeviationBtns();
  setupEventListeners();
  applyHashTab();
  await Promise.all([fetchLeagues(), fetchDatabase()]);
  updateDbStatus();
  renderDbSummary();
  renderLeagueFilters();
  renderLeagueSelectGrid();
  renderComparisonSlots();
});

// ─── API helpers ────────────────────────────────────────────
async function fetchLeagues() {
  try {
    const res = await fetch('/api/leagues');
    if (res.ok) {
      const data = await res.json();
      state.leagues = data.leagues || data || [];
    }
  } catch (e) {
    console.warn('No se pudieron cargar las ligas:', e);
  }
}

function calculateDatabasePercentiles() {
  if (!state.database || state.database.length === 0) return;
  
  // Group players by position
  const posGroups = {};
  for (const p of state.database) {
    const pos = p.position || 'Unknown';
    if (!posGroups[pos]) posGroups[pos] = [];
    posGroups[pos].push(p);
  }
  
  // Metrics to rank
  const metrics = [
    { key: 'pts', higherIsBetter: true },
    { key: 'reb', higherIsBetter: true },
    { key: 'ast', higherIsBetter: true },
    { key: 'stl', higherIsBetter: true },
    { key: 'blk', higherIsBetter: true },
    { key: 'to', higherIsBetter: false },
    { key: 'eval', higherIsBetter: true },
    { key: 'pir', higherIsBetter: true },
    { key: 'pie', higherIsBetter: true },
    { key: 'netRtg', higherIsBetter: true },
    { key: 'usgPct', higherIsBetter: true },
    { key: 'tsPct', higherIsBetter: true },
    { key: 'efgPct', higherIsBetter: true },
    { key: 'astToRatio', higherIsBetter: true },
    { key: 'trueNetRtg', higherIsBetter: true },
    { key: 'offRapm', higherIsBetter: true },
    { key: 'defRapm', higherIsBetter: true }
  ];
  
  for (const pos in posGroups) {
    const players = posGroups[pos];
    
    for (const metric of metrics) {
      // Extract valid values for this metric
      const values = [];
      for (const p of players) {
        const stats = getProjectedStats(p);
        const v = stats[metric.key];
        if (v !== undefined && v !== null && !isNaN(v)) {
          values.push(v);
        }
      }
      
      // Sort values (ascending)
      values.sort((a, b) => a - b);
      if (values.length === 0) continue;
      
      for (const p of players) {
        const stats = getProjectedStats(p);
        const v = stats[metric.key];
        if (v !== undefined && v !== null && !isNaN(v)) {
          // Find rank using binary search or simple indexOf since arrays are small
          // To handle duplicates properly, finding the first index or average index
          const countBelow = values.filter(x => x < v).length;
          const countEqual = values.filter(x => x === v).length;
          // Rank formula: (countBelow + 0.5 * countEqual) / total
          let pct = ((countBelow + 0.5 * countEqual) / values.length) * 100;
          
          if (!metric.higherIsBetter) {
            pct = 100 - pct;
          }
          
          if (!p.percentiles) p.percentiles = {};
          p.percentiles[metric.key] = Math.round(pct);
        }
      }
    }
  }
}

async function fetchDatabase() {
  showLoading(true);
  try {
    const res = await fetch('/api/database');
    if (res.ok) {
      const data = await res.json();
      state.database = data.players || data || [];
      calculateDatabasePercentiles();
    }
  } catch (e) {
    console.warn('No se pudo cargar la base de datos:', e);
  }
  showLoading(false);
}

function showLoading(show, message) {
  state.isLoading = show;
  dom.loadingOverlay.style.display = show ? 'flex' : 'none';
  const textNode = dom.loadingOverlay.querySelector('p');
  if (textNode) {
    textNode.textContent = show && message ? message : 'Cargando…';
  }
}

// ─── Tab Navigation ─────────────────────────────────────────
function setupTabs() {
  dom.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tabId) {
  state.currentTab = tabId;
  dom.tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  dom.tabContents.forEach(tc => {
    const id = tc.id.replace('tab-', '');
    tc.classList.toggle('active', id === tabId);
  });
  window.location.hash = tabId;
}

function applyHashTab() {
  const hash = window.location.hash.replace('#', '');
  if (hash && document.getElementById('tab-' + hash)) switchTab(hash);
}

window.addEventListener('hashchange', applyHashTab);

// ─── Deviation +/- buttons ──────────────────────────────────
function setupDeviationBtns() {
  const step = 0.5;
  dom.devNameDown.addEventListener('click', () => { 
    dom.devName.value = Math.max(0.1, parseFloat(dom.devName.value || 1) - step).toFixed(1); 
    handleDeviationChange('name');
  });
  dom.devNameUp.addEventListener('click', () => { 
    dom.devName.value = (parseFloat(dom.devName.value || 1) + step).toFixed(1); 
    handleDeviationChange('name');
  });
  dom.devStatsDown.addEventListener('click', () => { 
    dom.devStats.value = Math.max(0.1, parseFloat(dom.devStats.value || 1) - step).toFixed(1); 
    handleDeviationChange('stats');
  });
  dom.devStatsUp.addEventListener('click', () => { 
    dom.devStats.value = (parseFloat(dom.devStats.value || 1) + step).toFixed(1); 
    handleDeviationChange('stats');
  });
}

function handleDeviationChange(type) {
  if (type === 'name') {
    if (state.targetPlayer) {
      const deviation = parseFloat(dom.devName.value) || 1;
      const results = findSimilarPlayers(state.targetPlayer.stats, state.database, deviation, {}, state.targetPlayer);
      state.searchResults = results;
      renderResultsTable(state.searchResults);
    }
  } else if (type === 'stats') {
    if (state.searchResults && !state.targetPlayer && dom.resultsPanel.style.display !== 'none') {
      handleSearchByStats();
    }
  }
}

// ─── Event Listeners ────────────────────────────────────────
function setupEventListeners() {
  // Search by name
  dom.playerSearch.addEventListener('input', debounce(handleAutocomplete, 300));
  dom.playerSearch.addEventListener('keydown', handleAutocompleteKey);
  dom.btnFind.addEventListener('click', handleSearchByName);
  dom.devName.addEventListener('change', () => handleDeviationChange('name'));
  dom.devName.addEventListener('input', () => handleDeviationChange('name'));
  document.addEventListener('click', e => {
    if (!dom.autocomplete.contains(e.target) && e.target !== dom.playerSearch) {
      hideAutocomplete();
    }
  });

  // Search by stats
  dom.btnSearchStats.addEventListener('click', handleSearchByStats);
  dom.devStats.addEventListener('change', () => handleDeviationChange('stats'));
  dom.devStats.addEventListener('input', () => handleDeviationChange('stats'));

  // Data management
  dom.btnScrape.addEventListener('click', handleScrape);
  dom.btnSelectAll.addEventListener('click', () => toggleAllLeagues(true));
  dom.btnDeselectAll.addEventListener('click', () => toggleAllLeagues(false));
  dom.btnExport.addEventListener('click', handleExport);
  dom.btnClear.addEventListener('click', handleClearCache);
  dom.toggleProjection.addEventListener('change', function() {
    state.showProjection = this.checked;
    renderResults();
  });

  // Position filter chips events
  dom.positionFilterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const pos = chip.dataset.pos;
      if (state.selectedFilterPositions.has(pos)) {
        state.selectedFilterPositions.delete(pos);
        chip.classList.remove('active');
      } else {
        state.selectedFilterPositions.add(pos);
        chip.classList.add('active');
      }
      renderResultsTable(state.searchResults);
    });
  });

  // Matchups modal events
  if (dom.btnCloseMatchups) {
    dom.btnCloseMatchups.addEventListener('click', hideMatchupsModal);
  }

  // Comparador events
  if (dom.compareSearch) {
    dom.compareSearch.addEventListener('input', debounce(handleCompareAutocomplete, 300));
    dom.compareSearch.addEventListener('keydown', handleCompareAutocompleteKey);
  }

  document.addEventListener('click', e => {
    if (dom.compareAutocomplete && !dom.compareAutocomplete.contains(e.target) && e.target !== dom.compareSearch) {
      hideCompareAutocomplete();
    }
  });

  if (dom.resultsTbody) {
    dom.resultsTbody.addEventListener('click', e => {
      const btn = e.target.closest('.btn-compare-add');
      if (btn) {
        e.stopPropagation();
        const slug = btn.dataset.slug;
        const season = btn.dataset.season;
        const leagueSlug = btn.dataset.league;
        const player = state.database.find(p => p.slug === slug && p.season === season && p.leagueSlug === leagueSlug);
        if (player) {
          if (state.targetPlayer) {
            const currentExists = state.comparisonPlayers.some(p => p && p.slug === state.targetPlayer.slug && p.season === state.targetPlayer.season && p.leagueSlug === state.targetPlayer.leagueSlug);
            if (!currentExists) {
              const freeIndex = state.comparisonPlayers.indexOf(null);
              if (freeIndex !== -1) {
                state.comparisonPlayers[freeIndex] = state.targetPlayer;
              }
            }
          }
          addPlayerToComparison(player);
        }
      }
    });
  }
  if (dom.matchupsModal) {
    dom.matchupsModal.addEventListener('click', e => {
      if (e.target === dom.matchupsModal) hideMatchupsModal();
    });
  }
  if (dom.targetCard) {
    dom.targetCard.addEventListener('click', e => {
      const btn = e.target.closest('#btn-show-matchups');
      if (btn) {
        const slug = btn.getAttribute('data-slug');
        const season = btn.getAttribute('data-season');
        handleShowMatchups(slug, season);
      }
    });
  }
}

// ─── Autocomplete ───────────────────────────────────────────
function handleAutocomplete() {
  const query = dom.playerSearch.value.trim().toLowerCase();
  if (query.length < 2) { hideAutocomplete(); return; }

  const matches = state.database
    .filter(p => p.name.toLowerCase().includes(query))
    .slice(0, 12);

  if (matches.length === 0) { hideAutocomplete(); return; }

  state.autocompleteIndex = -1;
  dom.autocomplete.innerHTML = matches.map((p, i) => `
    <div class="autocomplete-item" data-index="${i}" data-slug="${p.slug}" data-name="${p.name}" data-season="${p.season}" data-league="${p.leagueSlug}">
      <div>
        <span class="ac-name">${highlightMatch(p.name, query)}</span>
        <span class="ac-meta">${p.team} · ${p.league} · ${p.season}</span>
      </div>
    </div>
  `).join('');

  dom.autocomplete.classList.add('show');

  $$('.autocomplete-item', dom.autocomplete).forEach(item => {
    item.addEventListener('click', () => {
      dom.playerSearch.value = item.dataset.name;
      const targetSeason = item.dataset.season;
      const targetLeague = item.dataset.league;
      hideAutocomplete();
      handleSearchByName(targetSeason, targetLeague);
    });
  });
}

function highlightMatch(text, query) {
  const idx = text.toLowerCase().indexOf(query);
  if (idx === -1) return text;
  return text.slice(0, idx) + '<strong style="color:var(--accent-orange)">' + text.slice(idx, idx + query.length) + '</strong>' + text.slice(idx + query.length);
}

function handleAutocompleteKey(e) {
  const items = $$('.autocomplete-item', dom.autocomplete);
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    state.autocompleteIndex = Math.min(state.autocompleteIndex + 1, items.length - 1);
    updateAutocompleteHighlight(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    state.autocompleteIndex = Math.max(state.autocompleteIndex - 1, 0);
    updateAutocompleteHighlight(items);
  } else if (e.key === 'Enter' && state.autocompleteIndex >= 0) {
    e.preventDefault();
    const item = items[state.autocompleteIndex];
    dom.playerSearch.value = item.dataset.name;
    const targetSeason = item.dataset.season;
    const targetLeague = item.dataset.league;
    hideAutocomplete();
    handleSearchByName(targetSeason, targetLeague);
  } else if (e.key === 'Escape') {
    hideAutocomplete();
  }
}

function updateAutocompleteHighlight(items) {
  items.forEach((it, i) => it.classList.toggle('highlighted', i === state.autocompleteIndex));
}

function hideAutocomplete() {
  dom.autocomplete.classList.remove('show');
  state.autocompleteIndex = -1;
}

// ─── Search by Name ─────────────────────────────────────────
async function handleSearchByName(seasonFilter, leagueSlugFilter) {
  const name = dom.playerSearch.value.trim();
  if (!name) return;

  const deviation = parseFloat(dom.devName.value) || 1;

  // Try API first, fall back to client-side
  let target = null;
  let results = [];

  try {
    const res = await fetch('/api/compare/by-name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, deviation, season: seasonFilter, leagueSlug: leagueSlugFilter })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        target = data.target;
        // Normalize API response: API returns flat player objects with similarityScore,
        // but renderResultsTable expects { player, similarity }
        results = (data.similar || []).map(p => ({
          player: p,
          similarity: p.similarityScore || 0
        }));
      }
    }
  } catch (_) { /* fallback */ }

  // Client-side fallback
  if (!target) {
    if (seasonFilter && leagueSlugFilter) {
      target = state.database.find(p => p.name.toLowerCase() === name.toLowerCase() && p.season === seasonFilter && p.leagueSlug === leagueSlugFilter);
    }
    if (!target && seasonFilter) {
      target = state.database.find(p => p.name.toLowerCase() === name.toLowerCase() && p.season === seasonFilter);
    }
    if (!target) {
      target = state.database.find(p => p.name.toLowerCase() === name.toLowerCase());
    }
    if (!target) {
      target = state.database.find(p => p.name.toLowerCase().includes(name.toLowerCase()));
    }
    if (target) {
      results = findSimilarPlayers(target.stats, state.database, deviation, {}, target);
    }
  }

  if (!target) {
    alert('No se encontró al jugador «' + name + '».');
    return;
  }

  state.targetPlayer = target;
  state.searchResults = results;
  state.selectedSimilar = null;
  renderResults(true, true);
}

// ─── Search by Stats ────────────────────────────────────────
async function handleSearchByStats() {
  const inputs = $$('.stat-input');
  const stats = {};
  inputs.forEach(inp => {
    const val = inp.value.trim();
    if (val !== '') stats[inp.dataset.stat] = parseFloat(val);
  });

  const deviation = parseFloat(dom.devStats.value) || 1;
  const position = dom.filterPosition.value;
  const season = dom.filterSeason.value;
  const selectedLeagues = [];
  $$('.league-chip.selected', dom.leagueChipsStats).forEach(ch => selectedLeagues.push(ch.dataset.slug));

  const filters = { position, season, leagues: selectedLeagues };

  // Try API or return all if empty
  let results = [];
  if (Object.keys(stats).length === 0) {
    results = state.database.map(p => ({ player: p, similarity: 100 }));
  } else {
    try {
      const body = { stats, deviation, leagues: selectedLeagues };
      const res = await fetch('/api/compare/by-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          results = (data.matches || data.similar || []).map(p => ({
            player: p,
            similarity: p.similarityScore || 0
          }));
        }
      }
    } catch (_) { /* fallback */ }

    // Client-side fallback
    if (results.length === 0) {
      results = findSimilarPlayers(stats, state.database, deviation, filters);
    }
  }

  state.targetPlayer = null;
  state.searchResults = results;
  state.selectedSimilar = null;
  renderResults(false, true);
}

// ─── Client-side comparison engine ──────────────────────────
const COMPARISON_KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'eval'];

function findSimilarPlayers(targetStats, database, deviation = 1, filters = {}, excludePlayer = null) {
  let statKeys = Object.keys(targetStats).filter(k => targetStats[k] != null && targetStats[k] !== '');
  
  // If searching by name (excludePlayer is provided), restrict comparison to the 6 core stats
  if (excludePlayer) {
    statKeys = statKeys.filter(k => COMPARISON_KEYS.includes(k));
  }
  
  if (statKeys.length === 0) return [];

  const results = [];

  for (const player of database) {
    // Skip the target player itself
    if (excludePlayer && player.slug === excludePlayer.slug && player.season === excludePlayer.season) continue;

    // Apply filters
    if (filters.position && player.position !== filters.position) continue;
    if (filters.season && player.season !== filters.season) continue;
    if (filters.leagues && filters.leagues.length > 0 && !filters.leagues.includes(player.leagueSlug)) continue;

    let allMatch = true;
    let totalCloseness = 0;

    for (const key of statKeys) {
      const target = targetStats[key];
      const actual = player.stats[key];
      if (actual == null) { allMatch = false; break; }

      const diff = Math.abs(actual - target);
      if (diff > deviation) {
        allMatch = false;
        break;
      }

      // Closeness: 1 = exact match, 0 = at boundary
      const closeness = deviation > 0 ? 1 - (diff / deviation) : (diff === 0 ? 1 : 0);
      totalCloseness += closeness;
    }

    if (allMatch) {
      const similarity = (totalCloseness / statKeys.length) * 100;
      results.push({ player, similarity });
    }
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, 100);
}

// ─── Render Results ─────────────────────────────────────────
function renderResults(showTarget, resetFilters = false) {
  dom.resultsPanel.style.display = 'block';
  dom.resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (resetFilters) {
    state.selectedFilterPositions.clear();
    dom.positionFilterChips.forEach(chip => chip.classList.remove('active'));
  }

  if (state.searchResults && state.searchResults.length > 0) {
    dom.resultsFilterContainer.style.display = 'flex';
  } else {
    dom.resultsFilterContainer.style.display = 'none';
  }

  // Target player: show it if explicitly requested, or if not specified but targetPlayer is present
  const shouldShowTarget = (showTarget !== undefined) ? showTarget : !!state.targetPlayer;

  if (shouldShowTarget && state.targetPlayer) {
    dom.targetSection.style.display = 'block';
    renderTargetPlayer(state.targetPlayer);
  } else {
    dom.targetSection.style.display = 'none';
  }

  // Results table
  renderResultsTable(state.searchResults);

  // Hide radar until selection
  dom.radarContainer.style.display = 'none';
}

function renderTargetPlayer(player) {
  // Resolve percentiles if not present (e.g. came from API)
  if (!player.percentiles) {
    const localP = state.database.find(p => p.slug === player.slug && p.season === player.season);
    if (localP && localP.percentiles) {
      player.percentiles = localP.percentiles;
    }
  }

  const initials = player.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const displayStats = getProjectedStats(player);
  
  const basicKeys = ['gp', 'min', 'pts', 'reb', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'to', 'pf', 'eval'];
  const shootingKeys = ['fgPct', 'tpPct', 'twoPPct', 'ftPct', 'tsPct', 'efgPct', 'tpAr', 'ftR'];
  const advancedKeys = ['pir', 'pie', 'netRtg', 'usgPct', 'poss', 'orbPct', 'drbPct', 'trbPct', 'astPct', 'toPct', 'astToRatio', 'stlPct', 'blkPct'];

  const makeGroupHtml = (keys, title, icon) => {
    const itemsHtml = keys.map(key => {
      const val = displayStats[key];
      if (val === undefined || val === null || val === '') return '';
      const isProjected = state.showProjection && 
                          ['pts', 'reb', 'ast', 'stl', 'blk', 'eval', 'pir', 'oreb', 'dreb', 'to', 'pf'].includes(key) && 
                          player.leagueSlug !== 'liga-endesa';
      const pct = player.percentiles ? player.percentiles[key] : null;
      let pctHtml = '';
      if (pct !== undefined && pct !== null) {
        let colorClass = 'pct-red';
        if (pct >= 90) colorClass = 'pct-gold';
        else if (pct >= 67) colorClass = 'pct-green';
        else if (pct >= 34) colorClass = 'pct-yellow';
        
        pctHtml = `
          <div class="percentile-wrapper" title="Percentil ${pct}">
            <div class="percentile-bg">
              <div class="percentile-bar ${colorClass}" style="width: ${pct}%;"></div>
            </div>
          </div>
        `;
      }
      
      return `
        <div class="stat-value ${isProjected ? 'projected-active' : ''}">
          <div class="stat-number">${formatStat(key, val)}</div>
          <div class="stat-label">${getStatLabel(key)}</div>
          ${pctHtml}
        </div>
      `;
    }).join('');

    if (!itemsHtml) return '';

    return `
      <div class="player-stats-section">
        <h4 class="stats-section-title">${icon} ${title}</h4>
        <div class="player-stats-grid">${itemsHtml}</div>
      </div>
    `;
  };

  const basicHtml = makeGroupHtml(basicKeys, 'Estadísticas Promedio', '📊');
  const shootingHtml = makeGroupHtml(shootingKeys, 'Efectividad y Tiros', '🎯');
  const advancedHtml = makeGroupHtml(advancedKeys, 'Métricas Avanzadas', '⚡');
  
  let rapmHtml = '';
  if (player.rapm) {
    const makeRapmValue = (val, key, label) => {
      const pct = player.percentiles ? player.percentiles[key] : null;
      let pctHtml = '';
      if (pct !== undefined && pct !== null) {
        let colorClass = 'pct-red';
        if (pct >= 90) colorClass = 'pct-gold';
        else if (pct >= 67) colorClass = 'pct-green';
        else if (pct >= 34) colorClass = 'pct-yellow';
        pctHtml = `
          <div class="percentile-wrapper" title="Percentil ${pct}">
            <div class="percentile-bg">
              <div class="percentile-bar ${colorClass}" style="width: ${pct}%;"></div>
            </div>
          </div>
        `;
      }
      return `
          <div class="stat-value">
            <div class="stat-number" style="color: ${val > 0 ? '#10b981' : 'var(--text-primary)'}">${val > 0 ? '+' : ''}${val.toFixed(1)}</div>
            <div class="stat-label">${label}</div>
            ${pctHtml}
          </div>
      `;
    };

    rapmHtml = `
      <div class="player-stats-section" style="border: 1px solid rgba(16, 185, 129, 0.3); background: rgba(16, 185, 129, 0.03);">
        <h4 class="stats-section-title" style="color: #10b981;">🛡️ Impacto Real en Pista (RAPM)</h4>
        <div class="player-stats-grid">
          ${makeRapmValue(player.rapm.off, 'offRapm', 'OFF RAPM')}
          ${makeRapmValue(player.rapm.def, 'defRapm', 'DEF RAPM')}
          ${makeRapmValue(player.trueNetRtg, 'trueNetRtg', 'NET RAPM')}
        </div>
      </div>
    `;
  }

  let badgeHtml = '';
  if (state.showProjection) {
    const factor = getPlayerTranslationFactor(player);
    if (factor === 1.0) {
      badgeHtml = `<span class="projection-badge" style="background: rgba(16, 185, 129, 0.15); border-color: rgba(16, 185, 129, 0.3); color: #10b981;">Liga Endesa</span>`;
    } else {
      badgeHtml = `<span class="projection-badge">🔮 Proyección ACB (Factor: ${factor.toFixed(3)})</span>`;
    }
  }

  dom.targetCard.innerHTML = `
    <div class="player-info">
      <div class="player-avatar">${initials}</div>
      <div class="player-name-big">${player.name}</div>
      <div class="player-team">${formatTeamName(player.team, state.database, player.leagueSlug)}</div>
      <div class="player-meta">
        <span class="badge badge-position">${POSITION_MAP[player.position] || player.position}</span>
        <span class="badge badge-league">${player.league}</span>
        <span class="badge badge-season">${player.season}</span>
      </div>
      <div class="player-meta" style="margin-top:0.4rem;">
        <span style="color:var(--text-muted);font-size:0.82rem;">
          ${player.height || ''} · ${player.age ? player.age + ' años' : ''} · ${player.nationality || ''}
        </span>
        ${badgeHtml ? '<br>' + badgeHtml : ''}
      </div>
      <div class="player-actions" style="margin-top:0.8rem;">
        <button class="btn-matchups" id="btn-show-matchups" data-slug="${player.slug}" data-season="${player.season}">
          📈 Ver Análisis de Rivales
        </button>
      </div>
    </div>
    <div class="player-stats-wrapper" style="flex:2; display:flex; flex-direction:column; gap:0.5rem; width: 100%;">
      ${basicHtml}
      ${shootingHtml}
      ${advancedHtml}
      ${rapmHtml}
      
      <div id="league-averages-chart-container-${player.slug}" class="player-stats-section" style="margin-top: 0.5rem; display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <h4 class="stats-section-title" style="margin-bottom: 0;">📉 Jugador vs Media de Liga (${POSITION_MAP[player.position] || player.position})</h4>
          <div class="chart-toggle-controls" style="display: flex; gap: 0.5rem;">
            <button class="btn-toggle-chart active" data-type="tornado" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; border-radius: 4px; background: var(--primary); color: white; border: none; cursor: pointer;">Tornado</button>
            <button class="btn-toggle-chart" data-type="radar" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; border-radius: 4px; background: var(--surface); color: var(--text-primary); border: 1px solid var(--border); cursor: pointer;">Telaraña</button>
          </div>
        </div>
        <div class="chart-content">
          <div class="spinner" style="text-align: center; color: var(--text-muted); padding: 1rem;">Calculando medias...</div>
        </div>
      </div>
    </div>
  `;

  // Asynchronously fetch and render the averages chart
  setTimeout(() => renderLeagueAveragesChart(player, `league-averages-chart-container-${player.slug}`), 0);
}

// Global state for charts to allow toggling
window.currentAveragesChartData = null;

async function renderLeagueAveragesChart(player, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  try {
    container.style.display = 'block';
    
    // Fetch averages
    const res = await fetch(`/api/league-averages?league=${encodeURIComponent(player.leagueSlug)}&season=${encodeURIComponent(player.season)}`);
    const data = await res.json();
    
    if (!data.success || !data.averages) {
      container.querySelector('.chart-content').innerHTML = '<div style="color:var(--text-muted); font-style:italic;">No hay datos de medias suficientes para esta liga y temporada.</div>';
      return;
    }

    // Determine basic position group
    let posGroup = 'Forward';
    const rawPos = (player.position || '').toLowerCase();
    if (rawPos.includes('guard') || rawPos === 'g' || rawPos === 'pg' || rawPos === 'sg') posGroup = 'Guard';
    else if (rawPos.includes('center') || rawPos === 'c') posGroup = 'Center';

    const averages = data.averages[posGroup];
    if (!averages || Object.keys(averages).length === 0) {
      container.querySelector('.chart-content').innerHTML = '<div style="color:var(--text-muted); font-style:italic;">No hay suficientes jugadores en esta posición para calcular la media.</div>';
      return;
    }

    // Keys to compare
    const keys = ['pts', 'reb', 'ast', 'stl', 'blk'];
    const labels = ['PTS', 'REB', 'AST', 'ROB', 'TAP'];
    
    // Prepare data
    const playerValues = [];
    const avgValues = [];
    const diffs = [];
    const maxVals = [];
    
    for (const key of keys) {
      const pVal = player.stats[key] || 0;
      const aVal = averages[key] || 0;
      playerValues.push(pVal);
      avgValues.push(aVal);
      diffs.push(pVal - aVal);
      maxVals.push(Math.max(pVal, aVal));
    }

    // Store globally for toggle
    window.currentAveragesChartData = {
      player,
      keys,
      labels,
      playerValues,
      avgValues,
      diffs,
      maxVals
    };

    // Draw initial chart (Tornado)
    drawChartTornado(container.querySelector('.chart-content'));

    // Attach toggle listeners
    const toggleBtns = container.querySelectorAll('.btn-toggle-chart');
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        toggleBtns.forEach(b => {
          b.classList.remove('active');
          b.style.background = 'var(--surface)';
          b.style.color = 'var(--text-primary)';
          b.style.border = '1px solid var(--border)';
        });
        const targetBtn = e.currentTarget;
        targetBtn.classList.add('active');
        targetBtn.style.background = 'var(--primary)';
        targetBtn.style.color = 'white';
        targetBtn.style.border = 'none';

        const type = targetBtn.dataset.type;
        if (type === 'tornado') drawChartTornado(container.querySelector('.chart-content'));
        else drawChartRadar(container.querySelector('.chart-content'));
      });
    });

  } catch (err) {
    console.error('Error rendering averages chart:', err);
    container.querySelector('.chart-content').innerHTML = '<div style="color:#ef4444;">Error al cargar las medias.</div>';
  }
}

function drawChartTornado(contentEl) {
  const d = window.currentAveragesChartData;
  if (!d) return;

  // Maximum absolute difference to scale the bars (with a minimum baseline so small diffs are visible)
  const maxAbsDiff = Math.max(...d.diffs.map(Math.abs), 1);

  let html = '<div style="display: flex; flex-direction: column; gap: 0.8rem; padding: 0.5rem 0;">';
  
  html += `
    <div style="display: flex; justify-content: center; margin-bottom: 0.5rem; gap: 2rem; font-size: 0.8rem;">
      <span style="display: flex; align-items: center; gap: 0.3rem;"><span style="display: inline-block; width: 12px; height: 12px; background: #ef4444; border-radius: 2px;"></span> Peor que Media</span>
      <span style="display: flex; align-items: center; gap: 0.3rem;"><span style="display: inline-block; width: 12px; height: 12px; background: #10b981; border-radius: 2px;"></span> Mejor que Media</span>
    </div>
  `;

  for (let i = 0; i < d.keys.length; i++) {
    const diff = d.diffs[i];
    const isPositive = diff >= 0;
    
    // Scale 0 to 100% (where 100% is maxAbsDiff)
    // We limit width to 45% of the container to leave room for the center label
    const widthPct = (Math.abs(diff) / maxAbsDiff) * 45;
    
    const color = isPositive ? '#10b981' : '#ef4444';
    
    const leftBarWidth = isPositive ? 0 : widthPct;
    const rightBarWidth = isPositive ? widthPct : 0;
    
    const leftText = !isPositive ? `\${d.playerValues[i].toFixed(1)} <span style="font-size:0.7rem; color:var(--text-muted)">vs \${d.avgValues[i].toFixed(1)}</span>` : '';
    const rightText = isPositive ? `<span style="font-size:0.7rem; color:var(--text-muted)">\${d.avgValues[i].toFixed(1)} vs</span> \${d.playerValues[i].toFixed(1)}` : '';

    html += `
      <div style="display: flex; align-items: center; width: 100%; height: 24px; position: relative;">
        <!-- Left side (Negative) -->
        <div style="flex: 1; display: flex; justify-content: flex-end; align-items: center; padding-right: 0.5rem;">
          <span style="font-size: 0.8rem; margin-right: 0.5rem; font-family: monospace;">\${leftText}</span>
          <div style="height: 16px; background: \${!isPositive ? color : 'transparent'}; width: \${leftBarWidth}%; border-radius: 4px 0 0 4px; transition: width 0.4s ease;"></div>
        </div>
        
        <!-- Center Label -->
        <div style="width: 40px; text-align: center; font-weight: 600; font-size: 0.8rem; z-index: 1;">
          \${d.labels[i]}
        </div>
        
        <!-- Right side (Positive) -->
        <div style="flex: 1; display: flex; justify-content: flex-start; align-items: center; padding-left: 0.5rem;">
          <div style="height: 16px; background: \${isPositive ? color : 'transparent'}; width: \${rightBarWidth}%; border-radius: 0 4px 4px 0; transition: width 0.4s ease;"></div>
          <span style="font-size: 0.8rem; margin-left: 0.5rem; font-family: monospace;">\${rightText}</span>
        </div>
        
        <!-- Center line -->
        <div style="position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: var(--border); transform: translateX(-50%); z-index: 0;"></div>
      </div>
    `;
  }
  
  html += '</div>';
  contentEl.innerHTML = html;
}

function drawChartRadar(contentEl) {
  const d = window.currentAveragesChartData;
  if (!d) return;

  // We need a canvas element
  contentEl.innerHTML = '<div style="width: 100%; max-width: 400px; margin: 0 auto; aspect-ratio: 1; position: relative;"><canvas id="league-averages-radar"></canvas></div>';
  
  const canvas = document.getElementById('league-averages-radar');
  if (!canvas) return;

  if (window.leagueAvgChartInstance) {
    window.leagueAvgChartInstance.destroy();
  }

  // Calculate scales (max value for each stat + 20%)
  const scales = {};
  for (let i = 0; i < d.keys.length; i++) {
    scales[d.labels[i]] = Math.max(d.maxVals[i] * 1.2, 1);
  }

  // Normalize data for radar (0 to 100 based on the individual scale)
  const normalizedPlayer = d.playerValues.map((v, i) => (v / scales[d.labels[i]]) * 100);
  const normalizedAvg = d.avgValues.map((v, i) => (v / scales[d.labels[i]]) * 100);

  // Use Chart.js if available, otherwise manual canvas drawing
  if (window.Chart) {
    window.leagueAvgChartInstance = new Chart(canvas, {
      type: 'radar',
      data: {
        labels: d.labels,
        datasets: [
          {
            label: d.player.name,
            data: normalizedPlayer,
            backgroundColor: 'rgba(59, 130, 246, 0.2)',
            borderColor: 'rgb(59, 130, 246)',
            pointBackgroundColor: 'rgb(59, 130, 246)',
            borderWidth: 2
          },
          {
            label: 'Media de Liga',
            data: normalizedAvg,
            backgroundColor: 'rgba(156, 163, 175, 0.2)',
            borderColor: 'rgb(156, 163, 175)',
            pointBackgroundColor: 'rgb(156, 163, 175)',
            borderWidth: 2,
            borderDash: [5, 5]
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            min: 0,
            max: 100,
            ticks: { display: false },
            grid: { color: 'rgba(128, 128, 128, 0.2)' },
            angleLines: { color: 'rgba(128, 128, 128, 0.2)' },
            pointLabels: {
              color: '#888',
              font: { size: 12, family: 'Inter' }
            }
          }
        },
        plugins: {
          legend: { position: 'bottom', labels: { color: '#888' } },
          tooltip: {
            callbacks: {
              label: function(context) {
                const label = context.dataset.label || '';
                const idx = context.dataIndex;
                const actualValue = label === 'Media de Liga' ? d.avgValues[idx] : d.playerValues[idx];
                return `\${label}: \${actualValue.toFixed(1)}`;
              }
            }
          }
        }
      }
    });
  } else {
    // If Chart.js is not loaded, just show a message
    contentEl.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-muted);">El motor de gráficos no está cargado. Prueba el diagrama de Tornado.</div>';
  }
}

function renderResultsTable(results) {
  if (!results || results.length === 0) {
    dom.resultsTbody.innerHTML = `<tr><td colspan="44" style="text-align:center;padding:2rem;color:var(--text-muted);">No se encontraron jugadores.</td></tr>`;
    dom.resultsCount.textContent = '0 resultados';
    return;
  }

  // Filter by position
  const filteredResults = results.filter(r => {
    return matchesSelectedPositions(r.player.position, state.selectedFilterPositions);
  });

  if (filteredResults.length === 0) {
    dom.resultsTbody.innerHTML = `<tr><td colspan="44" style="text-align:center;padding:2rem;color:var(--text-muted);">No hay jugadores en las posiciones seleccionadas.</td></tr>`;
    dom.resultsCount.textContent = '0 de ' + results.length + ' resultados';
    return;
  }

  // Apply sorting if a column is selected
  if (state.currentSortColumn) {
    filteredResults.sort((a, b) => {
      let valA, valB;
      if (state.currentSortColumn === 'similarity') {
        valA = a.similarity;
        valB = b.similarity;
      } else {
        const statsA = getProjectedStats(a.player);
        const statsB = getProjectedStats(b.player);
        valA = statsA[state.currentSortColumn];
        valB = statsB[state.currentSortColumn];
        
        // Handle missing values
        if (valA === undefined || valA === null || isNaN(valA)) valA = -9999;
        if (valB === undefined || valB === null || isNaN(valB)) valB = -9999;
      }
      
      if (state.sortAscending) {
        return valA - valB;
      } else {
        return valB - valA;
      }
    });
  }

  const countText = state.selectedFilterPositions.size > 0
    ? `${filteredResults.length} de ${results.length} resultados`
    : `${results.length} resultado${results.length !== 1 ? 's' : ''}`;
  dom.resultsCount.textContent = countText;

  dom.resultsTbody.innerHTML = filteredResults.map((r, i) => {
    const p = r.player;
    const s = getProjectedStats(p);
    const sim = r.similarity;
    const simClass = sim >= 80 ? 'similarity-high' : sim >= 50 ? 'similarity-mid' : 'similarity-low';
    
    const isProj = state.showProjection && p.leagueSlug !== 'liga-endesa';
    const getCellHtml = (key) => {
      const formatted = formatStat(key, s[key]);
      if (isProj && ['pts', 'reb', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'to', 'pf', 'eval', 'pir'].includes(key)) {
        return `<span class="projected-text">${formatted}</span>`;
      }
      return formatted;
    };

    return `
      <tr data-index="${i}" class="result-row">
        <td>${i + 1}</td>
        <td class="td-name">${p.name}</td>
        <td>${formatTeamName(p.team, state.database, p.leagueSlug)}</td>
        <td>${p.league}</td>
        <td>${p.season}</td>
        <td><span class="badge badge-position">${p.position}</span></td>
        <td>${getCellHtml('gp')}</td>
        <td>${getCellHtml('min')}</td>
        <td>${getCellHtml('pts')}</td>
        <td>${getCellHtml('reb')}</td>
        <td>${getCellHtml('oreb')}</td>
        <td>${getCellHtml('dreb')}</td>
        <td>${getCellHtml('ast')}</td>
        <td>${getCellHtml('stl')}</td>
        <td>${getCellHtml('blk')}</td>
        <td>${getCellHtml('to')}</td>
        <td>${getCellHtml('pf')}</td>
        <td>${getCellHtml('fgPct')}</td>
        <td>${getCellHtml('tpPct')}</td>
        <td>${getCellHtml('twoPPct')}</td>
        <td>${getCellHtml('ftPct')}</td>
        <td>${getCellHtml('eval')}</td>
        <!-- Avanzadas -->
        <td>${getCellHtml('pir')}</td>
        <td>${getCellHtml('pie')}</td>
        <td>${getCellHtml('netRtg')}</td>
        <td>${p.rapm && p.rapm.off !== undefined ? (p.rapm.off > 0 ? '+' : '') + p.rapm.off.toFixed(1) : '—'}</td>
        <td>${p.rapm && p.rapm.def !== undefined ? (p.rapm.def > 0 ? '+' : '') + p.rapm.def.toFixed(1) : '—'}</td>
        <td>${p.trueNetRtg !== undefined ? (p.trueNetRtg > 0 ? '+' : '') + p.trueNetRtg.toFixed(1) : '—'}</td>
        <td>${getCellHtml('usgPct')}</td>
        <td>${getCellHtml('poss')}</td>
        <td>${getCellHtml('tsPct')}</td>
        <td>${getCellHtml('efgPct')}</td>
        <td>${getCellHtml('tpAr')}</td>
        <td>${getCellHtml('ftR')}</td>
        <td>${getCellHtml('orbPct')}</td>
        <td>${getCellHtml('drbPct')}</td>
        <td>${getCellHtml('trbPct')}</td>
        <td>${getCellHtml('astPct')}</td>
        <td>${getCellHtml('toPct')}</td>
        <td>${getCellHtml('astToRatio')}</td>
        <td>${getCellHtml('stlPct')}</td>
        <td>${getCellHtml('blkPct')}</td>
        <td class="td-similarity ${simClass}">${sim.toFixed(1)}%</td>
        <td style="text-align:center;">
          <button class="btn-compare-add" data-slug="${p.slug}" data-season="${p.season}" data-league="${p.leagueSlug}" title="Añadir a la comparativa">
            ⚖️
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Click rows for radar
  $$('.result-row', dom.resultsTbody).forEach(row => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.dataset.index);
      const similar = filteredResults[idx].player;

      // Toggle selection
      $$('.result-row', dom.resultsTbody).forEach(r => r.classList.remove('selected-row'));
      row.classList.add('selected-row');

      state.selectedSimilar = similar;
      showRadarComparison();
    });
  });
}

// ─── Radar Chart ────────────────────────────────────────────
function showRadarComparison() {
  const p1 = state.targetPlayer;
  const p2 = state.selectedSimilar;
  if (!p2) return;

  dom.radarContainer.style.display = 'flex';
  dom.radarContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Legend
  const name1 = p1 ? p1.name : 'Objetivo';
  const name2 = p2.name;
  dom.radarLegend.innerHTML = `
    <div class="radar-legend-item">
      <div class="radar-legend-swatch" style="background:rgba(255,107,53,0.7);"></div>
      <span>${name1}</span>
    </div>
    <div class="radar-legend-item">
      <div class="radar-legend-swatch" style="background:rgba(59,130,246,0.7);"></div>
      <span>${name2}</span>
    </div>
  `;

  renderRadarChart(p1, p2);
  renderComparisonTable(p1, p2);
}

function renderComparisonTable(p1, p2) {
  if (!dom.comparisonTableContainer) return;
  
  const statsKeys = [
    // Basic
    'pts', 'reb', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'to', 'pf', 'eval',
    // Shooting
    'fgPct', 'tpPct', 'twoPPct', 'ftPct', 'tsPct', 'efgPct', 'tpAr', 'ftR',
    // Advanced
    'pir', 'pie', 'usgPct', 'poss', 'orbPct', 'drbPct', 'trbPct', 'astPct', 'toPct', 'astToRatio', 'stlPct', 'blkPct'
  ];

  const stats1 = p1 ? getProjectedStats(p1) : null;
  const stats2 = getProjectedStats(p2);

  const rowsHtml = statsKeys.map(key => {
    const val1 = stats1 ? stats1[key] : null;
    const val2 = stats2[key];
    
    if ((val1 === undefined || val1 === null || val1 === '') && (val2 === undefined || val2 === null || val2 === '')) return '';
    
    const label = getStatLabel(key);
    const displayVal1 = stats1 ? formatStat(key, val1) : '—';
    const displayVal2 = formatStat(key, val2);

    let targetBetterClass = '';
    let similarBetterClass = '';

    if (stats1 && val1 != null && val2 != null && val1 !== '' && val2 !== '') {
      const lowerIsBetter = ['to', 'pf', 'toPct'].includes(key);
      if (val1 !== val2) {
        if (lowerIsBetter) {
          if (val1 < val2) targetBetterClass = 'val-better';
          else similarBetterClass = 'val-better';
        } else {
          if (val1 > val2) targetBetterClass = 'val-better';
          else similarBetterClass = 'val-better';
        }
      }
    }

    return `
      <tr>
        <td class="stat-name-col">${label}</td>
        ${stats1 ? `<td class="val-target ${targetBetterClass}">${displayVal1}</td>` : ''}
        <td class="val-similar ${similarBetterClass}">${displayVal2}</td>
      </tr>
    `;
  }).join('');

  const targetNamePart = p1 ? p1.name.split(' ').pop() : 'Objetivo';
  const similarNamePart = p2.name.split(' ').pop();

  dom.comparisonTableContainer.innerHTML = `
    <table class="comparison-table">
      <thead>
        <tr>
          <th>Métrica</th>
          ${p1 ? `<th>${targetNamePart} (Objetivo)</th>` : ''}
          <th>${similarNamePart} (Similar)</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;
}

function renderRadarChart(player1, player2) {
  const canvas = dom.radarCanvas;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = 450;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  ctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;
  const radius = 160;
  const axes = RADAR_AXES;
  const labels = RADAR_LABELS;
  const n = axes.length;
  const angleStep = (2 * Math.PI) / n;
  const startAngle = -Math.PI / 2;

  ctx.clearRect(0, 0, size, size);

  // Normalize values
  const db = state.database;
  const stats1 = player1 ? getProjectedStats(player1) : {};
  const stats2 = getProjectedStats(player2);
  const vals1 = axes.map(k => player1 ? normalizeStatForChart(k, stats1[k] || 0, db) : 0);
  const vals2 = axes.map(k => normalizeStatForChart(k, stats2[k] || 0, db));

  // Draw grid
  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0];
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
  ctx.lineWidth = 1;

  for (const level of gridLevels) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const angle = startAngle + i * angleStep;
      const x = cx + Math.cos(angle) * radius * level;
      const y = cy + Math.sin(angle) * radius * level;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Draw axes
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
  for (let i = 0; i < n; i++) {
    const angle = startAngle + i * angleStep;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    ctx.stroke();
  }

  // Draw labels
  ctx.font = '600 13px "Outfit", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#94a3b8';

  for (let i = 0; i < n; i++) {
    const angle = startAngle + i * angleStep;
    const lx = cx + Math.cos(angle) * (radius + 28);
    const ly = cy + Math.sin(angle) * (radius + 28);
    ctx.fillText(labels[i], lx, ly);
  }

  // Draw percentage labels on grid
  ctx.font = '400 10px "Inter", sans-serif';
  ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
  for (const level of gridLevels) {
    const y = cy - radius * level;
    ctx.fillText(Math.round(level * 100) + '%', cx + 16, y);
  }

  // Draw player 1 polygon (orange)
  if (player1) {
    drawPolygon(ctx, cx, cy, radius, vals1, startAngle, angleStep, n,
      'rgba(255, 107, 53, 0.25)', 'rgba(255, 107, 53, 0.85)', 2.5);
    // Draw dots
    drawDots(ctx, cx, cy, radius, vals1, startAngle, angleStep, n, 'rgba(255, 107, 53, 1)');
  }

  // Draw player 2 polygon (blue)
  drawPolygon(ctx, cx, cy, radius, vals2, startAngle, angleStep, n,
    'rgba(59, 130, 246, 0.2)', 'rgba(59, 130, 246, 0.8)', 2.5);
  drawDots(ctx, cx, cy, radius, vals2, startAngle, angleStep, n, 'rgba(59, 130, 246, 1)');

  // Draw raw value labels near dots
  ctx.font = '600 11px "Outfit", sans-serif';
  for (let i = 0; i < n; i++) {
    const angle = startAngle + i * angleStep;

    if (player1) {
      const v1 = stats1[axes[i]] || 0;
      const r1 = vals1[i] * radius;
      const x1 = cx + Math.cos(angle) * r1;
      const y1 = cy + Math.sin(angle) * r1;
      ctx.fillStyle = 'rgba(255, 140, 66, 0.9)';
      ctx.fillText(formatStat(axes[i], v1), x1 + 12, y1 - 8);
    }

    const v2 = stats2[axes[i]] || 0;
    const r2 = vals2[i] * radius;
    const x2 = cx + Math.cos(angle) * r2;
    const y2 = cy + Math.sin(angle) * r2;
    ctx.fillStyle = 'rgba(96, 165, 250, 0.9)';
    ctx.fillText(formatStat(axes[i], v2), x2 - 12, y2 + 14);
  }
}

function drawPolygon(ctx, cx, cy, radius, values, startAngle, angleStep, n, fillColor, strokeColor, lineWidth) {
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const idx = i % n;
    const angle = startAngle + idx * angleStep;
    const r = values[idx] * radius;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawDots(ctx, cx, cy, radius, values, startAngle, angleStep, n, color) {
  for (let i = 0; i < n; i++) {
    const angle = startAngle + i * angleStep;
    const r = values[i] * radius;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// ─── League Filters (Stats tab) ─────────────────────────────
function renderLeagueFilters() {
  if (!dom.leagueChipsStats) return;
  dom.leagueChipsStats.innerHTML = state.leagues.map(l => `
    <div class="league-chip" data-slug="${l.slug}">${l.name}</div>
  `).join('');

  $$('.league-chip', dom.leagueChipsStats).forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('selected'));
  });
}

// ─── League Select Grid (Data tab) ──────────────────────────
function renderLeagueSelectGrid() {
  if (!dom.leagueSelectGrid) return;
  const defaultLeagues = [
    { slug: 'euroleague', name: 'EuroLeague' },
    { slug: 'eurocup', name: 'EuroCup' },
    { slug: 'liga-endesa', name: 'Liga Endesa' },
    { slug: 'betclic-elite', name: 'Betclic ELITE' },
    { slug: 'lega-basket-serie-a', name: 'Lega Basket Serie A' },
    { slug: 'esake', name: 'ESAKE' },
    { slug: 'aba-liga', name: 'ABA Liga' },
    { slug: 'basketball-champions-league', name: 'Basketball Champions League' },
    { slug: 'fiba-europe-cup', name: 'FIBA Europe Cup' },
    { slug: 'primera-feb', name: 'Primera FEB' },
    { slug: 'bnxt-league', name: 'BNXT League' },
    { slug: 'basketbol-super-ligi', name: 'BSL (Turquía)' },
    { slug: 'betsafe-lkl', name: 'LKL (Lituania)' },
    { slug: 'easycredit-bbl', name: 'BBL (Alemania)' },
    { slug: 'g-league', name: 'G League' },
    { slug: 'orlen-basket-liga', name: 'Orlen Basket Liga' }
  ];

  const leagueList = state.leagues.length > 0 ? state.leagues : defaultLeagues;

  dom.leagueSelectGrid.innerHTML = leagueList.map(l => `
    <label class="league-select-item" data-slug="${l.slug}">
      <input type="checkbox" value="${l.slug}" />
      <span>${l.name}</span>
    </label>
  `).join('');

  $$('.league-select-item', dom.leagueSelectGrid).forEach(item => {
    const cb = item.querySelector('input');
    cb.addEventListener('change', () => item.classList.toggle('checked', cb.checked));
  });
}

function toggleAllLeagues(select) {
  $$('.league-select-item input[type="checkbox"]', dom.leagueSelectGrid).forEach(cb => {
    cb.checked = select;
    cb.closest('.league-select-item').classList.toggle('checked', select);
  });
}

// ─── Scraping ───────────────────────────────────────────────
async function handleScrape() {
  const selected = [];
  $$('.league-select-item input:checked', dom.leagueSelectGrid).forEach(cb => selected.push(cb.value));

  if (selected.length === 0) {
    alert('Selecciona al menos una liga.');
    return;
  }

  dom.btnScrape.disabled = true;
  dom.scrapeArea.style.display = 'block';
  dom.scrapeFill.style.width = '0%';
  dom.scrapeText.textContent = 'Iniciando descarga…';

  let totalScraped = 0;

  // Process leagues ONE BY ONE (sequential queue)
  for (let i = 0; i < selected.length; i++) {
    const slug = selected[i];
    const leagueName = findLeagueName(slug);

    dom.scrapeText.textContent = `Liga ${i + 1}/${selected.length}: ${leagueName} — Iniciando…`;

    // 1. Send scrape request
    try {
      const res = await fetch('/api/scrape/league', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, season: dom.scrapeSeason.value })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          // A scrape is already running. Wait for it to finish and retry this index.
          dom.scrapeText.textContent = `Liga ${i + 1}/${selected.length}: ${leagueName} — Servidor ocupado, esperando turno…`;
          await waitForScrapeComplete(i, selected.length, "Liga activa");
          i--; // Retry this same league on the next loop iteration
          continue;
        } else {
          console.warn(`Liga ${slug} rechazada con error ${res.status}:`, data.error);
          dom.scrapeText.textContent = `Liga ${i + 1}/${selected.length}: ${leagueName} — Error: ${data.error || 'Rechazada'}`;
          await sleep(3000);
          continue;
        }
      }
    } catch (e) {
      console.warn('Error enviando petición de scraping:', slug, e);
      await sleep(3000);
      continue;
    }

    // 2. Wait for this league to finish scraping (poll until done)
    await waitForScrapeComplete(i, selected.length, leagueName);
    totalScraped++;
  }

  // 3. All leagues done — reload database
  dom.scrapeFill.style.width = '100%';
  dom.scrapeText.textContent = '¡Descarga completada! Actualizando base de datos…';

  await fetchDatabase();
  updateDbStatus();
  renderDbSummary();
  renderLeagueFilters();

  dom.btnScrape.disabled = false;
  dom.scrapeText.textContent = `✅ Completado: ${totalScraped} liga${totalScraped !== 1 ? 's' : ''} descargadas. ${state.database.length} jugadores en la base de datos.`;
}

function findLeagueName(slug) {
  const league = state.leagues.find(l => l.slug === slug);
  return league ? league.name : slug;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Poll /api/scrape/status every 2s until isRunning becomes false.
 * Updates progress bar and status text during scraping.
 */
async function waitForScrapeComplete(leagueIndex, totalLeagues, leagueName) {
  const POLL_INTERVAL = 2000;
  const MAX_WAIT = 60 * 60 * 1000; // 60 minutes max per league (e.g. EuroLeague takes ~15 mins)
  const startTime = Date.now();

  // Initial delay to let the server change status to 'scraping'
  await sleep(1000);

  while (Date.now() - startTime < MAX_WAIT) {
    await sleep(POLL_INTERVAL);

    try {
      const res = await fetch('/api/scrape/status');
      if (!res.ok) continue;

      const data = await res.json();

      if (data.isRunning) {
        // Update progress bar: combine league-level and player-level progress
        const leagueBasePct = (leagueIndex / totalLeagues) * 100;
        const leaguePct = data.total > 0 ? (data.progress / data.total) : 0;
        const overallPct = leagueBasePct + (leaguePct * (100 / totalLeagues));
        dom.scrapeFill.style.width = Math.min(overallPct, 99).toFixed(1) + '%';

        // Show detailed status
        dom.scrapeText.textContent = `Liga ${leagueIndex + 1}/${totalLeagues}: ${data.currentTask || leagueName}`;
      } else {
        // Scraping for this league is done (status is 'done', 'error', or 'idle')
        return;
      }
    } catch (_) {
      // Network error, keep polling
    }
  }

  // Timeout reached
  console.warn(`Timeout esperando scraping de ${leagueName}`);
}

// ─── Database Summary ───────────────────────────────────────
function updateDbStatus() {
  dom.dbCount.textContent = state.database.length;
}

function renderDbSummary() {
  if (!dom.dbSummary) return;

  if (state.database.length === 0) {
    dom.dbSummary.innerHTML = '<p style="color:var(--text-muted);grid-column:1/-1;">No hay datos cargados. Descarga ligas desde esta pestaña.</p>';
    return;
  }

  // Group by league
  const byLeague = {};
  for (const p of state.database) {
    const key = p.league || 'Desconocida';
    if (!byLeague[key]) byLeague[key] = 0;
    byLeague[key]++;
  }

  dom.dbSummary.innerHTML = Object.entries(byLeague)
    .sort((a, b) => b[1] - a[1])
    .map(([league, count]) => `
      <div class="db-summary-item">
        <div class="league-name">${league}</div>
        <div class="player-count">${count} <span style="font-size:0.7rem;color:var(--text-muted);-webkit-text-fill-color:var(--text-muted);">jugadores</span></div>
      </div>
    `).join('');
}

// ─── Export & Clear ─────────────────────────────────────────
function handleExport() {
  if (state.database.length === 0) {
    alert('No hay datos para exportar.');
    return;
  }
  const blob = new Blob([JSON.stringify(state.database, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'basketscout-database-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function handleClearCache() {
  const warningMsg = `<strong>ATENCIÓN:</strong> Esto eliminará permanentemente todos los archivos de base de datos de jugadores de todas las temporadas de tu disco duro.<br><br>Si tu intención es conservar los datos, actualizarlos o migrar de versión, <strong>NO</strong> debes limpiar la caché. Solo necesitas detener y reiniciar el servidor en tu consola.`;

  showDangerConfirm(warningMsg, async () => {
    try {
      const res = await fetch('/api/database/clear', { method: 'POST' });
      if (res.ok) {
        await fetchDatabase();
        updateDbStatus();
        renderDbSummary();
        renderLeagueFilters();
        dom.resultsPanel.style.display = 'none';
        alert('Caché de datos eliminada correctamente.');
      } else {
        alert('Error al intentar eliminar la caché.');
      }
    } catch (e) {
      console.error('Error al limpiar la caché:', e);
      alert('Error al intentar eliminar la caché.');
    }
  });
}

function showDangerConfirm(message, onAccept) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style.zIndex = '2000'; // Asegurar que esté por encima de todo

  modal.innerHTML = `
    <div class="modal-content" style="max-width: 500px; padding: 2rem; text-align: center; border: 1px solid var(--accent-red); box-shadow: 0 10px 30px rgba(239, 68, 68, 0.25);">
      <h3 style="color: var(--accent-red); margin-bottom: 1rem; font-family: 'Outfit', sans-serif; font-size: 1.4rem;">⚠️ Confirmación de Seguridad</h3>
      <p style="color: var(--text-secondary); margin-bottom: 1.5rem; line-height: 1.5; font-size: 0.95rem;">${message}</p>
      <div style="display: flex; justify-content: center; gap: 1rem; margin-top: 1.5rem;">
        <button id="custom-confirm-cancel" class="btn-secondary" style="padding: 0.5rem 1.2rem; cursor: pointer;">Cancelar</button>
        <button id="custom-confirm-accept" class="btn-primary" style="padding: 0.5rem 1.2rem; background: var(--accent-red); border-color: var(--accent-red); opacity: 0.5; cursor: not-allowed;" disabled>
          Aceptar (<span id="confirm-countdown">5</span>s)
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const acceptBtn = modal.querySelector('#custom-confirm-accept');
  const cancelBtn = modal.querySelector('#custom-confirm-cancel');
  const countdownSpan = modal.querySelector('#confirm-countdown');

  let secondsLeft = 5;
  const interval = setInterval(() => {
    secondsLeft--;
    if (secondsLeft <= 0) {
      clearInterval(interval);
      acceptBtn.disabled = false;
      acceptBtn.style.opacity = '1';
      acceptBtn.style.cursor = 'pointer';
      acceptBtn.innerHTML = '<span>🗑️ Aceptar Borrado</span>';
    } else {
      countdownSpan.textContent = secondsLeft;
    }
  }, 1000);

  cancelBtn.addEventListener('click', () => {
    clearInterval(interval);
    modal.remove();
  });

  acceptBtn.addEventListener('click', () => {
    clearInterval(interval);
    modal.remove();
    onAccept();
  });
}

// ─── Matchups Modal Control & Rendering ─────────────────────
function hideMatchupsModal() {
  if (dom.matchupsModal) {
    dom.matchupsModal.style.display = 'none';
  }
}

async function handleShowMatchups(slug, season, leagueSlug) {
  showLoading(true, "Descargando partidos y analizando rivales en tiempo real…");
  try {
    const res = await fetch('/api/player/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, season, leagueSlug })
    });
    
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Error en la petición');
    }
    
    const data = await res.json();
    renderMatchupsModalContent(data);
    dom.matchupsModal.style.display = 'flex';
  } catch (err) {
    console.error('Error al obtener partidos:', err);
    alert('No se pudo analizar el rendimiento del jugador: ' + err.message);
  } finally {
    showLoading(false);
  }
}

function renderMatchupsModalContent(data) {
  const p = data.player;
  const a = data.analysis;
  
  // Find all records for this player to populate season/competition options
  const playerRecords = state.database.filter(record => record.slug === p.slug);
  const selectorOptionsHtml = playerRecords.map(record => {
    const isSelected = record.season === p.season && record.leagueSlug === p.leagueSlug;
    return `
      <option value="${record.season}|${record.leagueSlug}" ${isSelected ? 'selected' : ''}>
        Temporada ${record.season} — ${record.league} (${record.team})
      </option>
    `;
  }).join('');

  const selectorBarHtml = playerRecords.length > 1
    ? `
      <div class="matchups-selector-bar" style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:0.6rem 1rem; border-radius:var(--radius-lg); margin-bottom:1.25rem; border:1px solid var(--border-subtle);">
        <span style="font-size:0.88rem; font-weight:600; color:var(--text-secondary);">Seleccionar Competición y Temporada:</span>
        <select id="select-matchups-config" class="input-field" style="width:auto; min-width:320px; padding:0.35rem 0.5rem; margin:0; font-size:0.82rem; border-color:var(--accent-orange); color:var(--text-primary); background:var(--bg-card);">
          ${selectorOptionsHtml}
        </select>
      </div>
    `
    : '';

  const setupSelectorListener = () => {
    const configSelector = dom.matchupsModalBody.querySelector('#select-matchups-config');
    if (configSelector) {
      configSelector.addEventListener('change', () => {
        const [selectedSeason, selectedLeagueSlug] = configSelector.value.split('|');
        handleShowMatchups(p.slug, selectedSeason, selectedLeagueSlug);
      });
    }
  };

  if (!a.success) {
    dom.matchupsModalBody.innerHTML = `
      ${selectorBarHtml}
      <p style="text-align:center;padding:2rem;color:var(--text-muted);">${a.error || 'Error al calcular análisis.'}</p>
    `;
    setupSelectorListener();
    return;
  }
  
  if (a.analyzedGamesCount === 0) {
    dom.matchupsModalBody.innerHTML = `
      ${selectorBarHtml}
      <div style="text-align:center;padding:3rem 1.5rem;color:var(--text-muted);">
        <p style="font-size:1.2rem;margin-bottom:0.5rem;">⚠️ No se encontraron partidos registrados</p>
        <p style="font-size:0.9rem;">No hay partidos disputados por ${p.name} para la temporada ${p.season} en be-basketball.com.</p>
      </div>
    `;
    setupSelectorListener();
    return;
  }
  
  // 1. Summary box (Insight)
  let bestOpp = a.bestMatchups.length > 0 ? a.bestMatchups[0] : null;
  let worstOpp = a.worstMatchups.length > 0 ? a.worstMatchups[0] : null;
  
  let bestOppName = bestOpp ? getTeamFullName(bestOpp.opponent, state.database, p.leagueSlug) : '';
  let worstOppName = worstOpp ? getTeamFullName(worstOpp.opponent, state.database, p.leagueSlug) : '';
  
  let insightText = `Análisis de competitividad para <strong>${p.name}</strong> en la temporada <strong>${p.season}</strong> (basado en ${a.analyzedGamesCount} partidos analizados). `;
  if (bestOpp && worstOpp) {
    insightText += `Destaca su rendimiento positivo contra <strong>${bestOppName}</strong> (Net Score medio de +${bestOpp.avgNetScore.toFixed(1)}), mientras que su rendimiento decae principalmente contra <strong>${worstOppName}</strong> (Net Score medio de ${worstOpp.avgNetScore.toFixed(1)}).`;
  } else if (bestOpp) {
    insightText += `Muestra una gran comodidad y rendimiento positivo contra <strong>${bestOppName}</strong> (Net Score medio de +${bestOpp.avgNetScore.toFixed(1)}).`;
  } else if (worstOpp) {
    insightText += `Su rendimiento decae principalmente contra <strong>${worstOppName}</strong> (Net Score medio de ${worstOpp.avgNetScore.toFixed(1)}).`;
  } else {
    insightText += `Muestra un rendimiento muy equilibrado contra todos los rivales, manteniéndose en su línea de estadísticas medias de la temporada.`;
  }
  
  // 2. Best / Worst Columns HTML
  const renderRivalCard = (rival, isGood) => {
    const scoreSign = rival.avgNetScore > 0 ? `+${rival.avgNetScore.toFixed(1)}` : rival.avgNetScore.toFixed(1);
    const statsHtml = ['pts', 'reb', 'ast', 'stl', 'blk', 'eval'].map(key => {
      const val = rival.statsAvg[key];
      const diff = rival.diffsAvg[key];
      const diffSign = diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
      const diffClass = diff > 0 ? 'pos' : (diff < 0 ? 'neg' : '');
      return `
        <div class="rival-stat-item">
          <div style="color:var(--text-dim);font-weight:600;">${getStatLabel(key)}</div>
          <div class="rival-stat-num">${formatStat(key, val)}</div>
          <div class="rival-stat-diff ${diffClass}">${diff === 0 ? '=' : diffSign}</div>
        </div>
      `;
    }).join('');
    
    return `
      <div class="rival-card ${isGood ? 'good' : 'bad'}">
        <div class="rival-name-row">
          <span class="rival-name">vs ${formatTeamName(rival.opponent, state.database, p.leagueSlug)} (${rival.count} part.)</span>
          <span class="rival-score-badge">SCORE: ${scoreSign}</span>
        </div>
        <div class="rival-stats-grid">${statsHtml}</div>
      </div>
    `;
  };
  
  const bestListHtml = a.bestMatchups.map(m => renderRivalCard(m, true)).join('');
  const worstListHtml = a.worstMatchups.map(m => renderRivalCard(m, false)).join('');
  
  // 3. Games log table HTML
  const getCellClass = (color) => {
    if (color === 'green') return 'cell-green';
    if (color === 'red') return 'cell-red';
    return 'cell-yellow';
  };
  
  const getSign = (diff) => {
    return diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
  };
  
  const gamesTableHtml = a.games.map((g, idx) => {
    const s = g.stats;
    const c = g.analysis.colors;
    const d = g.analysis.diffs;
    const scoreClass = g.analysis.status === 'good' ? 'cell-green' : (g.analysis.status === 'bad' ? 'cell-red' : 'cell-yellow');
    const scoreSign = g.analysis.netScore > 0 ? `+${g.analysis.netScore}` : g.analysis.netScore;
    
    const actionBtnHtml = g.gameUrl
      ? `<button class="btn-game-advanced btn-action" data-idx="${idx}" data-url="${g.gameUrl}" data-league="${p.leagueSlug || 'liga-endesa'}">⚡ Avanzadas</button>`
      : `<span style="color:var(--text-dim);">—</span>`;

    return `
      <tr>
        <td>${g.date}</td>
        <td class="td-name">vs ${formatTeamName(g.opponent, state.database, p.leagueSlug)}</td>
        <td style="text-align:center;">${g.score}</td>
        <td style="text-align:center;">${s.min}</td>
        <td class="${getCellClass(c.pts)}" title="Media: ${formatStat('pts', p.averages.pts)} (Dif: ${getSign(d.pts)})">${formatStat('pts', s.pts)}</td>
        <td class="${getCellClass(c.reb)}" title="Media: ${formatStat('reb', p.averages.reb)} (Dif: ${getSign(d.reb)})">${formatStat('reb', s.reb)}</td>
        <td class="${getCellClass(c.ast)}" title="Media: ${formatStat('ast', p.averages.ast)} (Dif: ${getSign(d.ast)})">${formatStat('ast', s.ast)}</td>
        <td class="${getCellClass(c.stl)}" title="Media: ${formatStat('stl', p.averages.stl)} (Dif: ${getSign(d.stl)})">${formatStat('stl', s.stl)}</td>
        <td class="${getCellClass(c.blk)}" title="Media: ${formatStat('blk', p.averages.blk)} (Dif: ${getSign(d.blk)})">${formatStat('blk', s.blk)}</td>
        <td class="${getCellClass(c.eval)}" title="Media: ${formatStat('eval', p.averages.eval)} (Dif: ${getSign(d.eval)})">${formatStat('eval', s.eval)}</td>
        <td class="${scoreClass}" style="text-align:center;font-weight:700;">${scoreSign}</td>
        <td style="text-align:center;padding: 4px;">${actionBtnHtml}</td>
      </tr>
      <tr class="game-advanced-row" id="game-adv-row-${idx}" style="display:none; background: rgba(16, 20, 30, 0.35);">
        <td colspan="12" style="padding: 12px 16px; border-bottom: 1px solid var(--border-subtle);">
          <div class="game-adv-container" id="game-adv-container-${idx}"></div>
        </td>
      </tr>
    `;
  }).join('');
  
  dom.matchupsModalBody.innerHTML = `
    ${selectorBarHtml}
    
    <!-- Resumen analitico -->
    <div class="matchups-summary-box">
      ${insightText}
      <br/>
      <small style="color:var(--text-dim);display:block;margin-top:0.4rem;">
        * Nota: La Puntuación Neta (SCORE) se calcula comparando las 6 estadísticas core contra su media general. Verde = +1, Rojo = -1, Amarillo = 0.
      </small>
    </div>
    
    <!-- Top Rivales -->
    <div class="matchups-columns">
      <div>
        <h3 class="matchups-column-title good">🟢 Rinde Mejor Contra (Top Rivales)</h3>
        <div class="rivals-list">
          ${bestListHtml || '<p style="color:var(--text-muted);font-size:0.88rem;padding:0.5rem;">No se detectaron rivales por encima de la media.</p>'}
        </div>
      </div>
      <div>
        <h3 class="matchups-column-title bad">🔴 Sufre Más Contra (Peores Rivales)</h3>
        <div class="rivals-list">
          ${worstListHtml || '<p style="color:var(--text-muted);font-size:0.88rem;padding:0.5rem;">No se detectaron rivales por debajo de la media.</p>'}
        </div>
      </div>
    </div>
    
    <!-- Historial de Partidos Completo -->
    <div style="margin-top:2rem;">
      <h3 class="modal-title" style="margin-bottom:0.75rem;">📋 Historial Completo de Partidos (${p.season})</h3>
      <div class="table-wrapper">
        <table class="results-table matchups-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Partido</th>
              <th style="text-align:center;">Resultado</th>
              <th style="text-align:center;">Min</th>
              <th>PTS</th>
              <th>REB</th>
              <th>AST</th>
              <th>ROB</th>
              <th>TAP</th>
              <th>VAL</th>
              <th style="text-align:center;">PUNT. NETA</th>
              <th style="text-align:center;">Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${gamesTableHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Set up season/competition config selector listener
  setupSelectorListener();

  // Set up click handlers for advanced stats buttons
  const advButtons = dom.matchupsModalBody.querySelectorAll('.btn-game-advanced');
  advButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = btn.dataset.idx;
      const gameUrl = btn.dataset.url;
      const leagueSlug = btn.dataset.league;
      const row = document.getElementById(`game-adv-row-${idx}`);
      const container = document.getElementById(`game-adv-container-${idx}`);

      if (!row || !container) return;

      // Toggle row visibility
      if (row.style.display === 'table-row') {
        row.style.display = 'none';
        btn.classList.remove('active');
        return;
      }

      row.style.display = 'table-row';
      btn.classList.add('active');

      // If data is already loaded, don't fetch again
      if (container.dataset.loaded === 'true') return;

      // Show loader
      container.innerHTML = `
        <div style="display:flex; align-items:center; gap:0.6rem; color:var(--text-muted); font-size:0.85rem; padding:0.5rem 0;">
          <div class="spinner-small" style="width:14px; height:16px; border:2px solid var(--border-subtle); border-top-color:var(--accent-orange); border-radius:50%; animation: spin 0.8s linear infinite;"></div>
          <span>Cargando estadísticas avanzadas del acta del partido...</span>
        </div>
      `;

      try {
        const response = await fetch(`/api/player/${p.slug}/game-advanced?gameUrl=${encodeURIComponent(gameUrl)}&leagueSlug=${leagueSlug}`);
        const result = await response.json();

        if (!result.success) {
          throw new Error(result.error || 'Error al descargar datos del acta.');
        }

        const stats = result.stats;

        // Render advanced metrics grid
        const metrics = [
          { key: 'pir', label: 'PIR', icon: '📊' },
          { key: 'pie', label: 'PIE', icon: '🎯' },
          { key: 'usgPct', label: 'USG%', icon: '🔥' },
          { key: 'poss', label: 'POSS.', icon: '⏱️' },
          { key: 'tsPct', label: 'TS%', icon: '🎯' },
          { key: 'efgPct', label: 'eFG%', icon: '⚡' },
          { key: 'tpAr', label: '3PAr', icon: '🏹' },
          { key: 'ftR', label: 'FTr', icon: '🏀' },
          { key: 'orbPct', label: 'ORB%', icon: '💪' },
          { key: 'drbPct', label: 'DRB%', icon: '🛡️' },
          { key: 'trbPct', label: 'TRB%', icon: '📈' },
          { key: 'astPct', label: 'AST%', icon: '🤝' },
          { key: 'toPct', label: 'TO%', icon: '⚠️' },
          { key: 'astToRatio', label: 'AST-TO RAT.', icon: '⚖️' },
          { key: 'stlPct', label: 'STL%', icon: '👟' },
          { key: 'blkPct', label: 'BLK%', icon: '🚫' }
        ];

        const gridHtml = metrics.map(m => {
          const val = stats[m.key];
          const formatted = formatStat(m.key, val);
          return `
            <div class="game-adv-card">
              <div class="game-adv-header">
                <span>${m.icon}</span>
                <span class="game-adv-title">${m.label}</span>
              </div>
              <div class="game-adv-value">${formatted}</div>
            </div>
          `;
        }).join('');

        container.innerHTML = `
          <div class="game-adv-grid-layout">
            ${gridHtml}
          </div>
        `;
        container.dataset.loaded = 'true';

      } catch (err) {
        console.error('Error al cargar avanzadas del partido:', err);
        container.innerHTML = `
          <div style="color:var(--accent-red); font-size:0.85rem; padding:0.5rem 0;">
            ⚠️ Error: ${err.message}. Por favor, inténtalo de nuevo.
          </div>
        `;
        container.dataset.loaded = 'false';
      }
    });
  });
}

/**
 * Helper to translate team abbreviations (e.g. BAR, JLB, EST) to full team names.
 */
function getTeamFullName(abbrev, database, leagueSlug) {
  if (!abbrev) return 'Desconocido';
  const cleanAbbrev = abbrev.trim().toUpperCase();

  const leagueStaticMaps = {
    'liga-endesa': {
      'BAR': 'FC Barcelona', 'FCB': 'FC Barcelona',
      'MAD': 'Real Madrid', 'RMB': 'Real Madrid', 'REA': 'Real Madrid',
      'MAL': 'Unicaja Málaga', 'UNI': 'Unicaja Málaga',
      'BAS': 'Baskonia', 'BKN': 'Baskonia',
      'VAL': 'Valencia Basket',
      'TEN': 'La Laguna Tenerife', 'CBC': 'La Laguna Tenerife',
      'JOV': 'Joventut Badalona', 'PEN': 'Joventut Badalona',
      'CAN': 'Dreamland Gran Canaria', 'GCA': 'Dreamland Gran Canaria',
      'MAN': 'BAXI Manresa', 'BAX': 'BAXI Manresa',
      'ZAR': 'Casademont Zaragoza', 'CAS': 'Casademont Zaragoza',
      'BIL': 'Surne Bilbao Basket', 'SBB': 'Surne Bilbao Basket',
      'MUR': 'UCAM Murcia', 'UCM': 'UCAM Murcia',
      'BRE': 'Río Breogán', 'SGB': 'Río Breogán',
      'GIR': 'Bàsquet Girona', 'EVG': 'Bàsquet Girona',
      'AND': 'MoraBanc Andorra', 'BCA': 'MoraBanc Andorra',
      'GRA': 'Coviran Granada', 'CBG': 'Coviran Granada',
      'COR': 'Leyma Coruña', 'LEY': 'Leyma Coruña',
      'LLE': 'Hiopos Lleida', 'HFL': 'Hiopos Lleida'
    },
    'primera-feb': {
      'EST': 'Movistar Estudiantes',
      'SPB': 'Silbo San Pablo Burgos', 'BUR': 'Silbo San Pablo Burgos',
      'GIP': 'Inveready Gipuzkoa', 'GBC': 'Inveready Gipuzkoa',
      'TIZ': 'Grupo Ureta Tizona Burgos',
      'FUE': 'Flexicar Fuenlabrada',
      'ALI': 'HLA Alicante', 'HLA': 'HLA Alicante',
      'OUE': 'Club Ourense Baloncesto', 'COB': 'Club Ourense Baloncesto',
      'BET': 'Real Betis Baloncesto', 'RBB': 'Real Betis Baloncesto',
      'OBR': 'Monbus Obradoiro', 'MCO': 'Monbus Obradoiro',
      'MEN': 'Hestia Menorca',
      'CAN': 'Grupo Alega Cantabria',
      'CAS': 'Cáceres Patrimonio',
      'MEL': 'CB Melilla',
      'CLA': 'CB Clavijo',
      'PRA': 'CB Prat',
      'ISB': 'Juaristi ISB', 'JUA': 'Juaristi ISB',
      'ZOR': 'Zamora Enamora',
      'ALB': 'Albacete Basket',
      'LLE': 'Força Lleida',
      'SEV': 'Caja 87 Sevilla',
      'PAL': 'Palencia Baloncesto',
      'MOR': 'CB Morón',
      'CAR': 'CB Cartagena'
    },
    'betclic-elite': {
      'ASM': 'AS Monaco', 'MON': 'AS Monaco',
      'LDLC': 'LDLC ASVEL', 'ASV': 'LDLC ASVEL',
      'PAR': 'Paris Basketball',
      'JLB': 'JL Bourg',
      'MSB': 'Le Mans Sarthe',
      'CSP': 'Limoges CSP',
      'JDA': 'JDA Dijon',
      'BCM': 'Gravelines-Dunkerque',
      'SQB': 'Saint-Quentin',
      'JSF': 'Nanterre 92', 'NAN': 'Nanterre 92',
      'CHO': 'Cholet Basket', 'CB': 'Cholet Basket',
      'SIG': 'SIG Strasbourg',
      'SLUC': 'SLUC Nancy',
      'ESSM': 'ESSM Le Portel', 'POR': 'ESSM Le Portel',
      'CHA': 'Champagne Basket', 'CC': 'Champagne Basket',
      'ADA': 'ADA Blois',
      'ROA': 'Chorale Roanne',
      'MET': 'Metropolitans 92', 'PL': 'Metropolitans 92',
      'ROC': 'La Rochelle',
      'SPU': 'Elan Béarnais Pau-Orthez', 'POU': 'Elan Béarnais Pau-Orthez'
    },
    'easycredit-bbl': {
      'BAY': 'FC Bayern Munich', 'FCB': 'FC Bayern Munich',
      'ALB': 'Alba Berlin',
      'ULM': 'ratiopharm ulm',
      'LUD': 'MHP RIESEN Ludwigsburg',
      'BON': 'Telekom Baskets Bonn',
      'VEG': 'Rasta Vechta', 'VEC': 'Rasta Vechta',
      'WUR': 'Würzburg Baskets',
      'CHE': 'NINERS Chemnitz', 'NIN': 'NINERS Chemnitz',
      'HAM': 'Veolia Towers Hamburg',
      'OLD': 'EWE Baskets Oldenburg', 'EWE': 'EWE Baskets Oldenburg',
      'BAM': 'Bamberg Baskets',
      'ROS': 'Rostock Seawolves',
      'BRA': 'Braunschweig',
      'WEI': 'Syntainics MBC',
      'MBC': 'Syntainics MBC',
      'GOT': 'BG Göttingen',
      'TUE': 'Tigers Tübingen', 'TUG': 'Tigers Tübingen',
      'KRA': 'Crailsheim Merlins', 'HAK': 'Crailsheim Merlins',
      'HEI': 'MLP Academics Heidelberg', 'MLP': 'MLP Academics Heidelberg',
      'SKY': 'Fraport Skyliners'
    },
    'esake': {
      'PAO': 'PAOK',
      'PAN': 'Panathinaikos',
      'OLY': 'Olympiacos',
      'AEK': 'AEK Atenas',
      'PAOK': 'PAOK',
      'ARI': 'Aris',
      'PER': 'Peristeri',
      'PRO': 'Promitheas Patras',
      'KOL': 'Kolossos Rodou',
      'MAR': 'Maroussi',
      'LAV': 'Lavrio',
      'KAR': 'Karditsas'
    },
    'lega-basket-serie-a': {
      'MIL': 'Olimpia Milano', 'EA7': 'Olimpia Milano',
      'VIR': 'Virtus Bologna', 'BOL': 'Virtus Bologna',
      'VEN': 'Reyer Venezia',
      'BRE': 'Germani Brescia', 'GER': 'Germani Brescia',
      'TOR': 'Bertram Derthona Tortona',
      'REG': 'Reggio Emilia',
      'SAS': 'Dinamo Sassari', 'DIN': 'Dinamo Sassari',
      'TRE': 'Dolomiti Energia Trento',
      'PIS': 'Estra Pistoia',
      'NAP': 'Gevi Napoli',
      'VAR': 'Openjobmetis Varese',
      'TVS': 'NutriBullet Treviso',
      'SCO': 'Givova Scafati',
      'CRE': 'Vanoli Cremona',
      'PES': 'Carpegna Prosciutto Pesaro',
      'BRI': 'Happy Casa Brindisi',
      'CAN': 'Pallacanestro Cantù',
      'TRI': 'Pallacanestro Trieste'
    },
    'basketbol-super-ligi': {
      'FEN': 'Fenerbahçe',
      'EFS': 'Anadolu Efes',
      'BES': 'Beşiktaş',
      'GAL': 'Galatasaray',
      'KAR': 'Pınar Karşıyaka', 'KSK': 'Pınar Karşıyaka',
      'TOB': 'Tofaş',
      'DAR': 'Darüşşafaka',
      'TTA': 'Türk Telekom', 'TEL': 'Türk Telekom',
      'PET': 'Aliağa Petkimspor', 'ALI': 'Aliağa Petkimspor',
      'BAH': 'Bahçeşehir Koleji',
      'BOD': 'Çağdaş Bodrumspor',
      'BUI': 'Bursaspor', 'BUR': 'Bursaspor',
      'MAN': 'Manisa BBSK',
      'MER': 'Mersin Spor',
      'BUY': 'Büyükçekmece',
      'SAM': 'Samsunspor'
    },
    'betsafe-lkl': {
      'ZAL': 'Zalgiris Kaunas', 'LIT': 'Zalgiris Kaunas',
      'RYT': 'Rytas Vilnius',
      'WOL': 'Wolves Vilnius',
      'LIE': 'Lietkabelis',
      'JUV': 'Juventus Utena', 'UTE': 'Juventus Utena',
      'NEP': 'Neptunas Klaipeda',
      'SIA': 'Siauliai',
      'MAZ': 'Mazaikiai',
      'JON': 'CBet Jonava',
      'NEV': 'Nevezis',
      'GAR': 'Gargzdai'
    },
    'aba-liga': {
      'PAR': 'Partizan Belgrade', 'PTS': 'Partizan Belgrade',
      'ZVE': 'Crvena Zvezda', 'CZV': 'Crvena Zvezda',
      'BUD': 'Budućnost Podgorica',
      'CED': 'Cedevita Olimpija', 'OLI': 'Cedevita Olimpija',
      'MEGA': 'Mega MIS', 'MEG': 'Mega MIS',
      'ZAD': 'Zadar',
      'IGO': 'Igokea',
      'SCD': 'SC Derby',
      'SPL': 'Split',
      'CIB': 'Cibona',
      'FMP': 'FMP Meridian',
      'KRK': 'Krka',
      'BOR': 'Borac Čačak',
      'MOR': 'Mornar Bar',
      'SUB': 'Spartak Subotica',
      'MAZ': 'Mazaikiai',
      'DUK': 'Dubai BC',
      'DUB': 'Dubai BC'
    },
    'fiba-europe-cup': {
      'NOR': 'Norrköping Dolphins',
      'KOR': 'Kortrijk Spurs',
      'BRN': 'PUMPA Basket Brno',
      'CHO': 'Cholet Basket', 'CB': 'Cholet Basket',
      'SBB': 'Surne Bilbao Basket', 'BIL': 'Surne Bilbao Basket',
      'CAS': 'Casademont Zaragoza', 'ZAR': 'Casademont Zaragoza',
      'POR': 'FC Porto',
      'SPO': 'Sporting CP',
      'SAB': 'Sabah BC',
      'ANW': 'Anwil Włocławek',
      'KAL': 'BC Kalev/Cramo'
    },
    'g-league': {
      'CLE': 'Cleveland Charge',
      'MOT': 'Motor City Cruise',
      'IOW': 'Iowa Wolves',
      'RCR': 'Rip City Remix',
      'GRG': 'Grand Rapids Gold',
      'BUL': 'Windy City Bulls',
      'GRE': 'Greensboro Swarm',
      'NOB': 'Indiana Mad Ants',
      'LAK': 'Salt Lake City Stars',
      'WES': 'Westchester Knicks',
      'BIR': 'Birmingham Squadron',
      'CLI': 'San Diego Clippers',
      'RAP': 'Raptors 905',
      'LON': 'Long Island Nets',
      'WAR': 'Santa Cruz Warriors',
      'SUN': 'South Bay Lakers',
      'KIN': 'Stockton Kings',
      'SLC': 'Salt Lake City Stars',
      'TEX': 'Texas Legends',
      'OKL': 'Oklahoma City Blue',
      'DEL': 'Delaware Blue Coats',
      'MNE': 'Maine Celtics',
      'RGB': 'Rio Grande Valley Vipers',
      'WIS': 'Wisconsin Herd',
      'CAP': 'Capitanes CDMX',
      'OSC': 'Osceola Magic',
      'SOU': 'South Bay Lakers',
      'STO': 'Stockton Kings',
      'VAL': 'Valley Suns'
    },
    'euroleague': {
      'REA': 'Real Madrid', 'MAD': 'Real Madrid', 'RMB': 'Real Madrid',
      'BAR': 'FC Barcelona', 'FCB': 'FC Barcelona',
      'BAS': 'Baskonia', 'BKN': 'Baskonia',
      'OLY': 'Olympiacos',
      'PAO': 'Panathinaikos',
      'FEN': 'Fenerbahçe',
      'EFS': 'Anadolu Efes',
      'MIL': 'Olimpia Milano', 'EA7': 'Olimpia Milano',
      'VIR': 'Virtus Bologna', 'BOL': 'Virtus Bologna',
      'ASM': 'AS Monaco', 'MON': 'AS Monaco',
      'LDLC': 'LDLC ASVEL', 'ASV': 'LDLC ASVEL',
      'PAR': 'Paris Basketball',
      'BAY': 'FC Bayern Munich', 'FCB': 'FC Bayern Munich',
      'ALB': 'Alba Berlin',
      'MTA': 'Maccabi Tel Aviv',
      'ZAL': 'Zalgiris Kaunas',
      'PTS': 'Partizan Belgrade',
      'ZVE': 'Crvena Zvezda', 'CZV': 'Crvena Zvezda'
    },
    'eurocup': {
      'VAL': 'Valencia Basket',
      'JLB': 'JL Bourg',
      'HAP': 'Hapoel Tel Aviv', 'HTA': 'Hapoel Tel Aviv',
      'ULM': 'ratiopharm ulm',
      'LUD': 'MHP RIESEN Ludwigsburg',
      'HAM': 'Veolia Towers Hamburg',
      'ANK': 'Türk Telekom', 'TTA': 'Türk Telekom',
      'VEN': 'Reyer Venezia',
      'TRE': 'Dolomiti Energia Trento',
      'BUD': 'Budućnost Podgorica',
      'CED': 'Cedevita Olimpija', 'OLI': 'Cedevita Olimpija',
      'LIE': 'Lietkabelis',
      'WOL': 'Wolves Vilnius',
      'ARI': 'Aris',
      'BJK': 'Beşiktaş', 'BES': 'Beşiktaş',
      'BAH': 'Bahçeşehir Koleji',
      'CLU': 'U-BT Cluj-Napoca',
      'SLO': 'Trefl Sopot', 'SOP': 'Trefl Sopot'
    },
    'orlen-basket-liga': {
      'ANW': 'Anwil Włocławek',
      'SOP': 'Trefl Sopot', 'TRE': 'Trefl Sopot',
      'SZC': 'King Szczecin', 'KIN': 'King Szczecin',
      'WKS': 'Śląsk Wrocław', 'SLO': 'Śląsk Wrocław',
      'SPC': 'Spójnia Stargard', 'SPO': 'Spójnia Stargard',
      'STA': 'Stal Ostrów Wielkopolski',
      'LEG': 'Legia Warszawa',
      'DZK': 'Dziki Warszawa', 'DZI': 'Dziki Warszawa',
      'CZS': 'Czarni Słupsk', 'SLA': 'Czarni Słupsk',
      'GDY': 'Arka Gdynia', 'ARK': 'Arka Gdynia',
      'TOR': 'Twarde Pierniki Toruń',
      'DAB': 'MKS Dąbrowa Górnicza', 'MKS': 'MKS Dąbrowa Górnicza',
      'GLI': 'GTK Gliwice', 'GTK': 'GTK Gliwice',
      'ZIE': 'Zastal Zielona Góra', 'ZAS': 'Zastal Zielona Góra',
      'LUB': 'Start Lublin',
      'LAN': 'Górnik Wałbrzych', 'GOR': 'Górnik Wałbrzych',
      'RAD': 'HydroTruck Radom'
    }
  };

  if (leagueSlug && leagueStaticMaps[leagueSlug] && leagueStaticMaps[leagueSlug][cleanAbbrev]) {
    return leagueStaticMaps[leagueSlug][cleanAbbrev];
  }

  const generalStaticMap = {
    'BAR': 'FC Barcelona', 'FCB': 'FC Barcelona',
    'MAD': 'Real Madrid', 'RMB': 'Real Madrid', 'REA': 'Real Madrid',
    'MAL': 'Unicaja Málaga', 'UNI': 'Unicaja Málaga',
    'BAS': 'Baskonia', 'BKN': 'Baskonia',
    'VAL': 'Valencia Basket',
    'TEN': 'La Laguna Tenerife', 'CBC': 'La Laguna Tenerife',
    'JOV': 'Joventut Badalona', 'PEN': 'Joventut Badalona',
    'CAN': 'Dreamland Gran Canaria', 'GCA': 'Dreamland Gran Canaria',
    'MAN': 'BAXI Manresa', 'BAX': 'BAXI Manresa',
    'ZAR': 'Casademont Zaragoza', 'CAS': 'Casademont Zaragoza',
    'BIL': 'Surne Bilbao Basket', 'SBB': 'Surne Bilbao Basket',
    'MUR': 'UCAM Murcia', 'UCM': 'UCAM Murcia',
    'BRE': 'Río Breogán', 'SGB': 'Río Breogán',
    'GIR': 'Bàsquet Girona', 'EVG': 'Bàsquet Girona',
    'AND': 'MoraBanc Andorra', 'BCA': 'MoraBanc Andorra',
    'GRA': 'Coviran Granada', 'CBG': 'Coviran Granada',
    'COR': 'Leyma Coruña', 'LEY': 'Leyma Coruña',
    'LLE': 'Hiopos Lleida', 'HFL': 'Hiopos Lleida',
    'PER': 'Peristeri',
    'PAO': 'PAOK',
    'PAN': 'Panathinaikos',
    'OLY': 'Olympiacos',
    'AEK': 'AEK Atenas',
    'PAOK': 'PAOK',
    'ARI': 'Aris',
    'PRO': 'Promitheas Patras',
    'KOL': 'Kolossos Rodou',
    'MAR': 'Maroussi',
    'LAV': 'Lavrio',
    'KAR': 'Karditsas',
    'ASM': 'AS Monaco', 'MON': 'AS Monaco',
    'LDLC': 'LDLC ASVEL', 'ASV': 'LDLC ASVEL',
    'PAR': 'Paris Basketball',
    'JLB': 'JL Bourg',
    'MSB': 'Le Mans Sarthe',
    'CSP': 'Limoges CSP',
    'JDA': 'JDA Dijon',
    'BCM': 'Gravelines-Dunkerque',
    'SQB': 'Saint-Quentin',
    'JSF': 'Nanterre 92', 'NAN': 'Nanterre 92',
    'CHO': 'Cholet Basket', 'CB': 'Cholet Basket',
    'SIG': 'SIG Strasbourg',
    'SLUC': 'SLUC Nancy',
    'ESSM': 'ESSM Le Portel', 'POR': 'ESSM Le Portel',
    'CHA': 'Champagne Basket', 'CC': 'Champagne Basket',
    'ADA': 'ADA Blois',
    'ROA': 'Chorale Roanne',
    'MET': 'Metropolitans 92', 'PL': 'Metropolitans 92',
    'ROC': 'La Rochelle',
    'SPU': 'Elan Béarnais Pau-Orthez', 'POU': 'Elan Béarnais Pau-Orthez',
    'EST': 'Movistar Estudiantes',
    'SPB': 'Silbo San Pablo Burgos', 'BUR': 'Silbo San Pablo Burgos',
    'GIP': 'Inveready Gipuzkoa', 'GBC': 'Inveready Gipuzkoa',
    'TIZ': 'Grupo Ureta Tizona Burgos',
    'FUE': 'Flexicar Fuenlabrada',
    'ALI': 'HLA Alicante', 'HLA': 'HLA Alicante',
    'OUE': 'Club Ourense Baloncesto', 'COB': 'Club Ourense Baloncesto',
    'BET': 'Real Betis Baloncesto', 'RBB': 'Real Betis Baloncesto',
    'OBR': 'Monbus Obradoiro', 'MCO': 'Monbus Obradoiro',
    'MEN': 'Hestia Menorca',
    'CAS': 'Cáceres Patrimonio',
    'MEL': 'CB Melilla',
    'CLA': 'CB Clavijo',
    'PRA': 'CB Prat',
    'ISB': 'Juaristi ISB', 'JUA': 'Juaristi ISB',
    'ZOR': 'Zamora Enamora',
    'ALB': 'Albacete Basket',
    'LLE': 'Força Lleida'
  };

  if (generalStaticMap[cleanAbbrev]) {
    return generalStaticMap[cleanAbbrev];
  }

  // 2. Dynamic matching from the loaded database (state.database)
  if (database && database.length > 0) {
    const teamMap = new Map();
    for (const p of database) {
      if (p.team && p.teamSlug) {
        teamMap.set(p.teamSlug, p.team);
      }
    }
    const teams = Array.from(teamMap.values());

    const cleanStr = (str) => {
      return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    };

    const normAbbrev = cleanStr(cleanAbbrev);

    // Strategy A: Word starting with the abbreviation (e.g. "EST" -> "Estudiantes")
    for (const team of teams) {
      const normTeam = cleanStr(team);
      const words = normTeam.split(/[\s-]+/);
      for (const w of words) {
        if (w.startsWith(normAbbrev)) {
          return team;
        }
      }
    }

    // Strategy B: Initials matching (e.g. "JDA" -> "JDA Dijon")
    for (const team of teams) {
      const normTeam = cleanStr(team);
      const words = normTeam.split(/[\s-]+/).filter(w => w.length > 0);
      if (words.length >= normAbbrev.length) {
        let match = true;
        for (let i = 0; i < normAbbrev.length; i++) {
          if (words[i][0] !== normAbbrev[i]) {
            match = false;
            break;
          }
        }
        if (match) return team;
      }
    }
  }

  return abbrev;
}

function formatTeamName(abbrev, database, leagueSlug) {
  if (!abbrev) return 'Desconocido';
  const fullName = getTeamFullName(abbrev, database, leagueSlug);
  if (fullName === abbrev) return abbrev;
  return `${fullName} (${abbrev})`;
}

// ─── Keyboard shortcut: Enter on search ─────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement === dom.playerSearch && !dom.autocomplete.classList.contains('show')) {
    handleSearchByName();
  }
});

// ============================================================
// COMPARATOR IMPLEMENTATION
// ============================================================
let compareAutocompleteIndex = -1;

function handleCompareAutocomplete() {
  const val = dom.compareSearch.value.trim();
  if (val.length < 2) {
    hideCompareAutocomplete();
    return;
  }

  const query = val.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const matches = [];
  const seen = new Set();

  for (const p of state.database) {
    const normName = p.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (normName.includes(query)) {
      const key = `${p.slug}_${p.season}_${p.leagueSlug}`;
      if (!seen.has(key)) {
        seen.add(key);
        matches.push(p);
      }
      if (matches.length >= 10) break;
    }
  }

  if (matches.length === 0) {
    dom.compareAutocomplete.innerHTML = '<div class="autocomplete-suggestion">No se encontraron jugadores</div>';
    dom.compareAutocomplete.classList.add('show');
    return;
  }

  compareAutocompleteIndex = -1;
  dom.compareAutocomplete.innerHTML = matches.map((p, idx) => {
    const formattedTeam = formatTeamName(p.team, state.database, p.leagueSlug);
    return `
      <div class="autocomplete-suggestion" data-index="${idx}">
        <span style="font-weight:600;">${p.name}</span>
        <span style="color:var(--text-muted); font-size:0.75rem; margin-left:0.5rem;">
          ${formattedTeam} · ${p.league} · ${p.season}
        </span>
      </div>
    `;
  }).join('');

  dom.compareAutocomplete.classList.add('show');

  const items = dom.compareAutocomplete.querySelectorAll('.autocomplete-suggestion');
  items.forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.index);
      selectComparePlayer(matches[idx]);
    });
  });
}

function selectComparePlayer(player) {
  addPlayerToComparison(player);
  dom.compareSearch.value = '';
  hideCompareAutocomplete();
}

function handleCompareAutocompleteKey(e) {
  const items = dom.compareAutocomplete.querySelectorAll('.autocomplete-suggestion');
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    compareAutocompleteIndex = (compareAutocompleteIndex + 1) % items.length;
    updateCompareAutocompleteSelection(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    compareAutocompleteIndex = (compareAutocompleteIndex - 1 + items.length) % items.length;
    updateCompareAutocompleteSelection(items);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (compareAutocompleteIndex >= 0 && compareAutocompleteIndex < items.length) {
      items[compareAutocompleteIndex].click();
    }
  } else if (e.key === 'Escape') {
    hideCompareAutocomplete();
  }
}

function updateCompareAutocompleteSelection(items) {
  items.forEach((item, idx) => {
    item.classList.toggle('selected', idx === compareAutocompleteIndex);
  });
}

function hideCompareAutocomplete() {
  if (dom.compareAutocomplete) {
    dom.compareAutocomplete.classList.remove('show');
    compareAutocompleteIndex = -1;
  }
}

function addPlayerToComparison(player) {
  const exists = state.comparisonPlayers.some(p => p && p.slug === player.slug && p.season === player.season && p.leagueSlug === player.leagueSlug);
  if (exists) {
    alert(`${player.name} (${player.season}) ya está en la comparativa.`);
    return;
  }
  const freeIndex = state.comparisonPlayers.indexOf(null);
  if (freeIndex === -1) {
    alert("Ranuras llenas. Puedes comparar un máximo de 4 jugadores. Elimina uno antes de añadir otro.");
    return;
  }
  state.comparisonPlayers[freeIndex] = player;
  renderComparisonSlots();
  renderComparisonResults();
  switchTab('compare');
}

function removePlayerFromComparison(idx) {
  state.comparisonPlayers[idx] = null;
  renderComparisonSlots();
  renderComparisonResults();
}

function renderComparisonSlots() {
  if (!dom.comparisonSlotsGrid) return;
  dom.comparisonSlotsGrid.innerHTML = state.comparisonPlayers.map((p, idx) => {
    if (p === null) {
      return `
        <div class="comparison-slot slot-empty" onclick="focusCompareSearch()">
          <div style="font-size:1.5rem; margin-bottom:0.25rem;">➕</div>
          <div style="font-size:0.85rem; font-weight:600;">Añadir Jugador</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">Ranura ${idx + 1} libre</div>
        </div>
      `;
    }
    
    const initials = p.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const formattedTeam = formatTeamName(p.team, state.database, p.leagueSlug);
    
    return `
      <div class="comparison-slot slot-filled slot-${idx}">
        <button class="btn-slot-remove" onclick="removePlayerFromComparison(${idx})" title="Quitar jugador">&times;</button>
        <div style="display:flex; align-items:center; gap:0.75rem; overflow:hidden;">
          <div class="player-avatar" style="width:36px; height:36px; font-size:0.88rem; flex-shrink:0;">${initials}</div>
          <div style="overflow:hidden;">
            <div class="slot-player-name" title="${p.name}">${p.name}</div>
            <div class="slot-player-team" title="${formattedTeam}">${formattedTeam}</div>
          </div>
        </div>
        <div class="slot-player-meta" style="margin-top:0.5rem;">
          <span class="badge badge-position" style="font-size:0.68rem; padding:0.15rem 0.4rem;">${POSITION_MAP[p.position] || p.position}</span>
          <span class="badge badge-league" style="font-size:0.68rem; padding:0.15rem 0.4rem; white-space:nowrap; max-width:80px; overflow:hidden; text-overflow:ellipsis;" title="${p.league}">${p.league}</span>
          <span class="badge badge-season" style="font-size:0.68rem; padding:0.15rem 0.4rem;">${p.season}</span>
        </div>
      </div>
    `;
  }).join('');
}

function focusCompareSearch() {
  if (dom.compareSearch) {
    dom.compareSearch.focus();
    dom.compareSearch.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

const COMPARISON_ROWS = [
  { key: 'gp', label: 'Partidos Jugados (GP)' },
  { key: 'min', label: 'Minutos (MIN)', skipCompare: true },
  { key: 'pts', label: 'Puntos (PTS)' },
  { key: 'reb', label: 'Rebotes Totales (REB)' },
  { key: 'oreb', label: 'Rebotes Ofensivos (OREB)' },
  { key: 'dreb', label: 'Rebotes Defensivos (DREB)' },
  { key: 'ast', label: 'Asistencias (AST)' },
  { key: 'stl', label: 'Robos (ROB)' },
  { key: 'blk', label: 'Tapones (TAP)' },
  { key: 'to', label: 'Pérdidas (PER)', lowerIsBetter: true },
  { key: 'pf', label: 'Faltas Personales (FP)', lowerIsBetter: true },
  { key: 'fgPct', label: 'Tiros de Campo (TC%)' },
  { key: 'tpPct', label: 'Tiros de 3 (T3%)' },
  { key: 'twoPPct', label: 'Tiros de 2 (T2%)' },
  { key: 'ftPct', label: 'Tiros Libres (TL%)' },
  { key: 'eval', label: 'Valoración (VAL)' },
  { key: 'pir', label: 'PIR' },
  { key: 'pie', label: 'PIE' },
  { key: 'netRtg', label: 'Est. Net Rating' },
  { key: 'offRapm', label: 'OFF RAPM (Impacto Ofensivo)' },
  { key: 'defRapm', label: 'DEF RAPM (Impacto Defensivo)' },
  { key: 'trueNetRtg', label: 'NET RAPM (Impacto Total)' },
  { key: 'usgPct', label: 'Uso / USG%' },
  { key: 'poss', label: 'Posesiones (POSS.)' },
  { key: 'tsPct', label: 'TS%' },
  { key: 'efgPct', label: 'eFG%' },
  { key: 'tpAr', label: '3PAr' },
  { key: 'ftR', label: 'FTr' },
  { key: 'orbPct', label: 'ORB%' },
  { key: 'drbPct', label: 'DRB%' },
  { key: 'trbPct', label: 'TRB%' },
  { key: 'astPct', label: 'AST%' },
  { key: 'toPct', label: 'TO%', lowerIsBetter: true },
  { key: 'astToRatio', label: 'AST-TO RATIO' },
  { key: 'stlPct', label: 'STL%' },
  { key: 'blkPct', label: 'BLK%' }
];

function generateComparisonSummary(p1, p2) {
  if (!p1 || !p2) return '';
  const s1 = getProjectedStats(p1);
  const s2 = getProjectedStats(p2);
  
  let text = `<strong>Resumen de Scouting:</strong> `;
  let adv1 = [];
  let adv2 = [];
  
  // Basic scoring/volume
  if (s1.pts > s2.pts + 2) adv1.push('anotación bruta');
  if (s2.pts > s1.pts + 2) adv2.push('anotación bruta');
  
  // Playmaking
  if (s1.ast > s2.ast + 1.5 || (s1.astPct > s2.astPct + 5)) adv1.push('generación de juego');
  if (s2.ast > s1.ast + 1.5 || (s2.astPct > s1.astPct + 5)) adv2.push('generación de juego');
  
  // Rebounding
  const r1 = (s1.trbPct || s1.reb);
  const r2 = (s2.trbPct || s2.reb);
  if (r1 > r2 * 1.2) adv1.push('dominio del rebote');
  if (r2 > r1 * 1.2) adv2.push('dominio del rebote');
  
  // Efficiency
  if (s1.tsPct > s2.tsPct + 3) adv1.push('eficiencia de tiro (TS%)');
  if (s2.tsPct > s1.tsPct + 3) adv2.push('eficiencia de tiro (TS%)');
  
  // Defense / RAPM
  if (s1.defRapm !== undefined && s2.defRapm !== undefined) {
    if (s1.defRapm > s2.defRapm + 0.5) adv1.push('impacto defensivo (RAPM)');
    if (s2.defRapm > s1.defRapm + 0.5) adv2.push('impacto defensivo (RAPM)');
  }
  
  if (adv1.length === 0 && adv2.length === 0) {
    return text + `Ambos jugadores tienen perfiles estadísticos sumamente parejos.`;
  }
  
  if (adv1.length > 0) {
    text += `<span style="color:#ff6b35; font-weight:600;">${p1.name}</span> destaca principalmente en ${adv1.join(', ')}. `;
  }
  if (adv2.length > 0) {
    text += `<span style="color:#3b82f6; font-weight:600;">${p2.name}</span> es superior en ${adv2.join(', ')}.`;
  }
  
  return text;
}

function renderComparisonResults() {
  const activePlayers = state.comparisonPlayers.filter(p => p !== null);
  
  if (activePlayers.length < 2) {
    if (dom.comparisonResults) dom.comparisonResults.style.display = 'none';
    return;
  }
  
  if (dom.comparisonResults) dom.comparisonResults.style.display = 'block';
  
  // Render Summary if exactly 2 players
  const summaryEl = $('comparison-summary');
  if (summaryEl) {
    if (activePlayers.length === 2) {
      summaryEl.style.display = 'block';
      summaryEl.innerHTML = generateComparisonSummary(activePlayers[0], activePlayers[1]);
    } else {
      summaryEl.style.display = 'none';
      summaryEl.innerHTML = '';
    }
  }
  
  // Render side-by-side table
  renderMultiComparisonTable(activePlayers);
  
  // Render radar chart
  renderCompareRadarChart(activePlayers);
}

function renderMultiComparisonTable(activePlayers) {
  if (!dom.compareTableContainer) return;
  
  const isHeadToHead = activePlayers.length === 2;
  const colors = ['#ff6b35', '#3b82f6', '#10b981', '#a855f7'];

  // Build header row with player names
  const headerHtml = `
    <thead>
      <tr>
        <th class="stat-name-col">Estadística</th>
        ${activePlayers.map((p, idx) => `
          <th style="border-top: 3px solid ${colors[idx]}">
            ${p.name}
            <div style="font-size:0.75rem; font-weight:normal; color:var(--text-muted); margin-top:0.15rem;">
              ${p.season}
            </div>
            <div style="font-size:0.70rem; font-weight:normal; color:var(--text-dim); margin-top:0.1rem; line-height:1.2; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;" title="${p.league}">
              ${p.league}
            </div>
          </th>
          ${(isHeadToHead && idx === 0) ? '<th style="width: 140px; text-align: center; border-top: 3px solid transparent; font-size: 0.75rem; color: var(--text-muted);">Diferencia Visual</th>' : ''}
        `).join('')}
      </tr>
    </thead>
  `;
  
  const bodyHtml = `
    <tbody>
      ${COMPARISON_ROWS.map(row => {
        // Calculate best and worst values
        const playerStats = activePlayers.map(p => getProjectedStats(p));
        const rawVals = playerStats.map(s => s[row.key]);
        const validVals = rawVals.filter(v => v !== undefined && v !== null && v !== '' && !isNaN(v)).map(Number);
        
        let bestVal = null;
        let worstVal = null;
        
        if (!row.skipCompare && validVals.length > 0) {
          if (row.lowerIsBetter) {
            bestVal = Math.min(...validVals);
            worstVal = Math.max(...validVals);
          } else {
            bestVal = Math.max(...validVals);
            worstVal = Math.min(...validVals);
          }
        }
        
        const hasDiff = bestVal !== null && worstVal !== null && bestVal !== worstVal;
        
        let tugOfWarHtml = '';
        if (isHeadToHead) {
          const v1 = rawVals[0] !== undefined && rawVals[0] !== null && rawVals[0] !== '' && !isNaN(rawVals[0]) ? Number(rawVals[0]) : null;
          const v2 = rawVals[1] !== undefined && rawVals[1] !== null && rawVals[1] !== '' && !isNaN(rawVals[1]) ? Number(rawVals[1]) : null;
          
          if (v1 !== null && v2 !== null && (v1 !== 0 || v2 !== 0)) {
            const minV = Math.min(0, v1, v2);
            const nv1 = Math.abs(v1 - minV) + 0.01;
            const nv2 = Math.abs(v2 - minV) + 0.01;
            
            let p1Pct = (nv1 / (nv1 + nv2)) * 100;
            if (row.lowerIsBetter) {
              p1Pct = (nv2 / (nv1 + nv2)) * 100;
            }
            
            tugOfWarHtml = `
              <td style="vertical-align: middle; padding: 0 15px;">
                <div class="tug-of-war-container">
                  <div class="tug-bar p1-bar" style="width: ${p1Pct}%; background: ${colors[0]};"></div>
                  <div class="tug-bar p2-bar" style="width: ${100 - p1Pct}%; background: ${colors[1]};"></div>
                </div>
              </td>
            `;
          } else {
             tugOfWarHtml = `<td></td>`;
          }
        }

        return `
          <tr>
            <td class="stat-name-col">${row.label}</td>
            ${activePlayers.map((p, idx) => {
              const s = playerStats[idx];
              const val = s[row.key];
              const formatted = formatStat(row.key, val);
              
              let cellClass = '';
              let glowStyle = '';
              if (hasDiff && val !== undefined && val !== null && val !== '') {
                const numVal = Number(val);
                if (numVal === bestVal) {
                  cellClass = 'cell-best visual-glow';
                  glowStyle = `text-shadow: 0 0 8px ${colors[idx]}88; color: ${colors[idx]}; font-weight: 700;`;
                }
                else if (numVal === worstVal) cellClass = 'cell-worst visual-dim';
              }
              
              const isFirst = idx === 0;
              return `
                <td class="${cellClass}" style="${glowStyle}">${formatted}</td>
                ${(isHeadToHead && isFirst) ? tugOfWarHtml : ''}
              `;
            }).join('')}
          </tr>
        `;
      }).join('')}
    </tbody>
  `;
  
  dom.compareTableContainer.innerHTML = `
    <div class="comparison-table-wrapper">
      <table>
        ${headerHtml}
        ${bodyHtml}
      </table>
    </div>
  `;
}

function renderCompareRadarChart(activePlayers) {
  const canvas = dom.compareRadarCanvas;
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = 450;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  ctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;
  const radius = 160;
  const axes = RADAR_AXES;
  const labels = RADAR_LABELS;
  const n = axes.length;
  const angleStep = (2 * Math.PI) / n;
  const startAngle = -Math.PI / 2;

  ctx.clearRect(0, 0, size, size);

  // Render Legend
  if (dom.compareRadarLegend) {
    const colors = ['#ff6b35', '#3b82f6', '#10b981', '#a855f7'];
    dom.compareRadarLegend.innerHTML = activePlayers.map((p, idx) => `
      <span class="legend-item" style="display:inline-flex; align-items:center; gap:0.35rem; margin-right:1.25rem; font-size:0.88rem; font-weight:600;">
        <span class="legend-dot" style="width:10px; height:10px; border-radius:50%; background-color:${colors[idx]}; display:inline-block;"></span>
        ${p.name}
      </span>
    `).join('');
  }

  // Draw grid
  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0];
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
  ctx.lineWidth = 1;

  for (const level of gridLevels) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const angle = startAngle + i * angleStep;
      const x = cx + Math.cos(angle) * radius * level;
      const y = cy + Math.sin(angle) * radius * level;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Draw axes
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
  for (let i = 0; i < n; i++) {
    const angle = startAngle + i * angleStep;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    ctx.stroke();
  }

  // Draw labels
  ctx.font = '600 13px "Outfit", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#94a3b8';

  for (let i = 0; i < n; i++) {
    const angle = startAngle + i * angleStep;
    const lx = cx + Math.cos(angle) * (radius + 28);
    const ly = cy + Math.sin(angle) * (radius + 28);
    ctx.fillText(labels[i], lx, ly);
  }

  // Draw percentage labels on grid
  ctx.font = '400 10px "Inter", sans-serif';
  ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
  for (const level of gridLevels) {
    const y = cy - radius * level;
    ctx.fillText(Math.round(level * 100) + '%', cx + 16, y);
  }

  // Draw each player's polygon and dots
  const colors = [
    { fill: 'rgba(255, 107, 53, 0.16)', stroke: 'rgba(255, 107, 53, 0.85)', dot: '#ff6b35' },
    { fill: 'rgba(59, 130, 246, 0.14)', stroke: 'rgba(59, 130, 246, 0.85)', dot: '#3b82f6' },
    { fill: 'rgba(16, 185, 129, 0.14)', stroke: 'rgba(16, 185, 129, 0.85)', dot: '#10b981' },
    { fill: 'rgba(168, 85, 247, 0.14)', stroke: 'rgba(168, 85, 247, 0.85)', dot: '#a855f7' }
  ];

  const db = state.database;
  
  activePlayers.forEach((p, idx) => {
    const s = getProjectedStats(p);
    const vals = axes.map(k => normalizeStatForChart(k, s[k] || 0, db));
    const c = colors[idx];
    
    // Draw polygon
    drawPolygon(ctx, cx, cy, radius, vals, startAngle, angleStep, n, c.fill, c.stroke, 2.5);
    
    // Draw dots
    drawDots(ctx, cx, cy, radius, vals, startAngle, angleStep, n, c.dot);
  });
}

// Expose comparison functions globally for inline onclick handlers
window.removePlayerFromComparison = removePlayerFromComparison;
window.focusCompareSearch = focusCompareSearch;

// ─── Table Sorting ──────────────────────────────────────────
function handleTableSort(e) {
  if (!e.target.classList.contains('sortable')) return;
  const column = e.target.dataset.sort;
  
  if (state.currentSortColumn === column) {
    state.sortAscending = !state.sortAscending;
  } else {
    state.currentSortColumn = column;
    state.sortAscending = false; // default to descending (highest first)
  }
  
  // Update header arrows
  $$('.sortable').forEach(th => th.classList.remove('sort-asc', 'sort-desc'));
  e.target.classList.add(state.sortAscending ? 'sort-asc' : 'sort-desc');
  
  renderResultsTable(state.searchResults);
}

// Attach event listener
if ($('results-table')) {
  $('results-table').querySelector('thead').addEventListener('click', handleTableSort);
}
