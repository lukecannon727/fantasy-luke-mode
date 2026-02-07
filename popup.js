// Update whitelist status and guide steps
async function updateWhitelistStatus() {
  const statusDiv = document.getElementById('whitelistStatus');
  const step1 = document.getElementById('step1');
  const step2 = document.getElementById('step2');
  const verifyButton = document.getElementById('verifyButton');
  
  const gray = '#b0b0b0';
  const green = '#7cff00';
  function setStep1(color) {
    step1.style.color = color;
    const sub = step1.querySelector('.step1-subline');
    if (sub) sub.style.color = color;
  }
  function setStep2(color, text) {
    const el = step2.querySelector('.step-text');
    if (el) {
      el.style.color = color;
      if (text) el.textContent = text;
    }
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.url || !tab.url.includes('fantasy.top')) {
      statusDiv.className = 'status-pill error';
      statusDiv.textContent = 'Go to fantasy.top';
      setStep1(green);
      setStep2(gray);
      verifyButton.disabled = true;
      return;
    }

    const url = tab.url;
    const result = await chrome.storage.local.get(['whitelistedAddresses']);
    const whitelist = result.whitelistedAddresses || [];
    const match = url.match(/\/player\/(0x[a-fA-F0-9]+)/);
    let isWhitelisted;
    if (match) {
      const address = match[1].toLowerCase();
      isWhitelisted = whitelist.includes(address);
    } else {
      isWhitelisted = whitelist.length > 0 && url.includes('/deckbuilder');
    }

    if (!match && !isWhitelisted) {
      statusDiv.className = 'status-pill error';
      statusDiv.textContent = 'Verify first';
      setStep1(green);
      setStep2(gray);
      verifyButton.disabled = true;
      return;
    }

    if (isWhitelisted) {
      statusDiv.className = 'status-pill active';
      statusDiv.textContent = 'Whitelisted';
      verifyButton.disabled = true;
      verifyButton.textContent = 'Verified';

      if (url.includes('/deckbuilder')) {
        setStep1(gray);
        setStep2(green);
      } else {
        setStep1(gray);
        setStep2(gray);
      }
    } else {
      statusDiv.className = 'status-pill verify';
      statusDiv.textContent = 'Verify';
      setStep1('#ff6b6b');
      setStep2(gray);
      verifyButton.disabled = false;
      verifyButton.textContent = 'Verify';
    }
  } catch (error) {
    statusDiv.className = 'status-pill error';
    statusDiv.textContent = 'Error';
  }
}

// Update cache info on popup open
async function updateCacheInfo() {
  const result = await chrome.storage.local.get(['historicalDataCache', 'cacheTimestamp', 'lastCalculatedScores', 'cardDataCache']);
  const cacheInfo = document.getElementById('cacheInfo');
  
  if (result.cacheTimestamp) {
    const cacheDate = new Date(result.cacheTimestamp);
    const now = new Date();
    const ageMs = now - cacheDate;
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
    const cardCount = result.historicalDataCache ? Object.keys(result.historicalDataCache).length : 0;
    const ageStr = ageDays > 0 ? `${ageDays}d old` : `${ageHours}h old`;
    cacheInfo.textContent = `${cardCount} heroes, ${ageStr}`;
    cacheInfo.style.color = ageDays >= 7 ? '#ff6b6b' : '#888';
    if (ageDays >= 7) cacheInfo.textContent += ' — refresh recommended';
    
    // Populate hero list for dropdown with scores and stars
    if (result.historicalDataCache && result.cardDataCache) {
      populateHeroList(result.cardDataCache, result.lastCalculatedScores);
    }
  } else {
    cacheInfo.textContent = 'Not loaded — click Refresh data';
  }
}

let allHeroOptions = []; // Store all hero options for filtering
let currentOverrides = {};
let selectedIndex = -1;

function validateOverrideScore(score) {
  if (typeof score !== 'number' || score < 0 || score > 1000) {
    throw new Error('Score override must be between 0 and 1000 (inclusive)');
  }
}

let sortColumn = 'heroKey'; // 'heroKey' | 'stars' | 'score' | 'scorePerStar'
let sortDirection = 'asc'; // 'asc' or 'desc'

function populateHeroList(cardData, calculatedScores = {}) {
  // cardData is an array of { heroKey, handle, name, stars }
  // Create a map of heroKey -> stars
  const heroStarsMap = new Map();
  cardData.forEach(card => {
    if (!heroStarsMap.has(card.heroKey)) {
      heroStarsMap.set(card.heroKey, card.stars);
    }
  });
  
  // Get unique heroKeys
  const uniqueHeroKeys = Array.from(new Set(cardData.map(c => c.heroKey)));
  
  const heroOptions = uniqueHeroKeys.map(heroKey => {
    const scoreData = calculatedScores[heroKey];
    const stars = heroStarsMap.get(heroKey) || 0;
    const algorithmScore = heroKey === '0XMAKESY' ? makesyExpectedScore(stars, undefined) : (scoreData ? scoreData.score : undefined);
    const hasOverride = currentOverrides.hasOwnProperty(heroKey);
    const score = hasOverride ? currentOverrides[heroKey] : (heroKey === '0XMAKESY' ? makesyExpectedScore(stars, currentOverrides['0XMAKESY']) : algorithmScore);
    const scorePerStar = (stars > 0 && score !== undefined) ? score / stars : undefined;
    return {
      heroKey: heroKey,
      score: score,
      algorithmScore: algorithmScore,
      stars: stars,
      scorePerStar: scorePerStar
    };
  });
  
  // Sort alphabetically
  heroOptions.sort((a, b) => a.heroKey.localeCompare(b.heroKey));
  
  // Store all options for filtering
  allHeroOptions = heroOptions;
  
  // Show dropdown if search box has focus
  const searchInput = document.getElementById('heroSearch');
  if (document.activeElement === searchInput) {
    updateHeroListFilter(searchInput.value);
  }
}

function sortHeroes(heroes) {
  return [...heroes].sort((a, b) => {
    let comparison = 0;
    if (sortColumn === 'heroKey') {
      comparison = a.heroKey.localeCompare(b.heroKey);
    } else if (sortColumn === 'stars') {
      comparison = (a.stars || 0) - (b.stars || 0);
    } else if (sortColumn === 'score') {
      const scoreA = a.score !== undefined ? a.score : -Infinity;
      const scoreB = b.score !== undefined ? b.score : -Infinity;
      comparison = scoreA - scoreB;
    } else if (sortColumn === 'scorePerStar') {
      const aVal = a.scorePerStar !== undefined ? a.scorePerStar : -Infinity;
      const bVal = b.scorePerStar !== undefined ? b.scorePerStar : -Infinity;
      comparison = aVal - bVal;
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });
}

function updateHeroListFilter(searchText) {
  const dropdown = document.getElementById('heroDropdown');
  dropdown.innerHTML = '';
  selectedIndex = -1;
  
  const searchLower = searchText.toLowerCase().trim();
  let filtered = allHeroOptions.filter(hero => 
    hero.heroKey.toLowerCase().includes(searchLower)
  );
  
  // Sort filtered results
  filtered = sortHeroes(filtered);
  
  if (filtered.length === 0 && searchText.trim()) {
    dropdown.classList.remove('hidden');
    const noResults = document.createElement('div');
    noResults.className = 'hero-dropdown-item';
    noResults.style.color = '#808080';
    noResults.style.cursor = 'default';
    noResults.textContent = 'No heroes found';
    dropdown.appendChild(noResults);
  } else if (filtered.length > 0) {
    dropdown.classList.remove('hidden');
    
    // Add header with sort buttons
    const header = document.createElement('div');
    header.className = 'hero-dropdown-header';
    
    const makeHeader = (col, label, title, defaultDir = 'asc') => {
      const btn = document.createElement('button');
      btn.className = `hero-dropdown-header-item ${sortColumn === col ? 'active' : 'inactive'}`;
      btn.title = title;
      const ind = sortColumn === col ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ' ⇅';
      btn.textContent = `${label}${ind}`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (sortColumn === col) {
          sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          sortColumn = col;
          sortDirection = defaultDir;
        }
        updateHeroListFilter(searchText);
      });
      return btn;
    };
    header.appendChild(makeHeader('stars', 'Stars', 'Sort by stars', 'desc'));
    header.appendChild(makeHeader('heroKey', 'Hero', 'Sort by hero name', 'asc'));
    header.appendChild(makeHeader('score', 'Score', 'Sort by expected score', 'desc'));
    header.appendChild(makeHeader('scorePerStar', 'Exp/⭐', 'Sort by expected score per star', 'desc'));
    dropdown.appendChild(header);
    
    // Add all filtered items (scrollable)
    filtered.forEach((hero, index) => {
      const item = document.createElement('div');
      item.className = 'hero-dropdown-item';
      item.dataset.heroKey = hero.heroKey;
      item.dataset.index = index;
      
      const starsSpan = document.createElement('span');
      starsSpan.className = 'hero-dropdown-score';
      starsSpan.textContent = hero.stars ? `${hero.stars}⭐` : '—';
      if (!hero.stars) starsSpan.style.color = '#808080';
      item.appendChild(starsSpan);
      const nameSpan = document.createElement('span');
      nameSpan.className = 'hero-dropdown-name';
      nameSpan.textContent = hero.heroKey;
      item.appendChild(nameSpan);
      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'hero-dropdown-score';
      const overrideVal = currentOverrides[hero.heroKey];
      if (overrideVal !== undefined) {
        const alg = hero.algorithmScore !== undefined ? hero.algorithmScore.toFixed(0) : '—';
        scoreSpan.innerHTML = `<span class="override-struck">${alg}</span> ${overrideVal.toFixed(0)}`;
      } else if (hero.heroKey === '0XMAKESY') {
        const makesyScore = makesyExpectedScore(hero.stars, currentOverrides['0XMAKESY']);
        scoreSpan.textContent = makesyScore !== undefined ? makesyScore.toFixed(0) : '—';
      } else if (hero.score !== undefined) {
        scoreSpan.textContent = hero.score.toFixed(0);
      } else {
        scoreSpan.textContent = '—';
        scoreSpan.style.color = '#808080';
      }
      item.appendChild(scoreSpan);
      const perStarSpan = document.createElement('span');
      perStarSpan.className = 'hero-dropdown-score';
      if (hero.scorePerStar !== undefined) {
        perStarSpan.textContent = String(Math.round(hero.scorePerStar));
      } else {
        perStarSpan.textContent = '—';
        perStarSpan.style.color = '#808080';
      }
      item.appendChild(perStarSpan);
      
      item.addEventListener('click', () => {
        selectHero(hero.heroKey);
      });
      
      item.addEventListener('mouseenter', () => {
        // Remove previous selection
        dropdown.querySelectorAll('.hero-dropdown-item').forEach(el => {
          el.classList.remove('selected');
        });
        item.classList.add('selected');
        selectedIndex = index;
      });
      
      dropdown.appendChild(item);
    });
  } else {
    dropdown.classList.add('hidden');
  }
}

function selectHero(heroKey) {
  const searchInput = document.getElementById('heroSearch');
  searchInput.value = heroKey;
  document.getElementById('heroDropdown').classList.add('hidden');
  searchInput.focus();
}

async function renderOverrides() {
  const overrideList = document.getElementById('overrideList');
  overrideList.innerHTML = '';

  const result = await chrome.storage.local.get(['cardDataCache', 'lastConfig']);
  const cardDataCache = result.cardDataCache || [];
  const heroStarsMap = new Map();
  cardDataCache.forEach(c => {
    if (c.heroKey && !heroStarsMap.has(c.heroKey)) heroStarsMap.set(c.heroKey, c.stars);
  });

  const removedDefaultMakesy = !!(result.lastConfig && result.lastConfig.removedDefaultMakesy);
  const makesyHasOverride = currentOverrides.hasOwnProperty('0XMAKESY');
  // Show default Makesy row only if user hasn't set an override and hasn't explicitly removed him
  if (!makesyHasOverride && !removedDefaultMakesy) {
    const makesyStars = heroStarsMap.get('0XMAKESY') || 0;
    const makesyScore = makesyExpectedScore(makesyStars, undefined);

    const makesyItem = document.createElement('div');
    makesyItem.className = 'override-item';
    makesyItem.innerHTML = `<span class="override-hero">${makesyStars ? makesyStars + '⭐ ' : ''}0XMAKESY</span> → <span class="override-score">${makesyScore}</span>`;

    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'override-buttons';
    const editBtn = document.createElement('button');
    editBtn.className = 'override-edit';
    editBtn.textContent = 'Edit';
    editBtn.title = 'Edit score';
    editBtn.onclick = async () => {
      const newScore = prompt('Enter new score for 0XMAKESY (or leave blank to use calculated score):', '');
      if (newScore !== null && newScore !== '') {
        const parsedScore = parseInt(newScore);
        if (isNaN(parsedScore)) {
          alert('Please enter a valid number');
          return;
        }
        try {
          validateOverrideScore(parsedScore);
          currentOverrides['0XMAKESY'] = parsedScore;
          await renderOverrides();
          const res = await chrome.storage.local.get(['lastConfig']);
          const config = res.lastConfig || { algorithm: 'exponentialSmoothing', scoreOverrides: {} };
          config.scoreOverrides = currentOverrides;
          await chrome.storage.local.set({ lastConfig: config });
        } catch (e) {
          alert(e.message);
        }
      }
    };
    const removeBtn = document.createElement('button');
    removeBtn.className = 'override-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove override';
    removeBtn.onclick = async () => {
      const res = await chrome.storage.local.get(['lastConfig']);
      const config = res.lastConfig || { algorithm: 'exponentialSmoothing', scoreOverrides: {} };
      config.removedDefaultMakesy = true;
      await chrome.storage.local.set({ lastConfig: config });
      await renderOverrides();
    };
    buttonGroup.appendChild(editBtn);
    buttonGroup.appendChild(removeBtn);
    makesyItem.appendChild(buttonGroup);
    overrideList.appendChild(makesyItem);
  }

  Object.entries(currentOverrides).forEach(([hero, score]) => {
    const item = document.createElement('div');
    item.className = 'override-item';
    const stars = heroStarsMap.get(hero);
    const starsLabel = stars ? stars + '⭐ ' : '';
    // 0XMAKESY: show rule-based score (1⭐ → override, other → 0)
    const displayScore = (hero === '0XMAKESY' && stars !== undefined) ? makesyExpectedScore(stars, score) : score;
    const text = document.createElement('span');
    text.innerHTML = `<span class="override-hero">${starsLabel}${hero}</span> → <span class="override-score ${displayScore === 0 ? 'blacklist' : ''}">${displayScore}</span>`;
    
    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'override-buttons';
    
    const editBtn = document.createElement('button');
    editBtn.className = 'override-edit';
    editBtn.textContent = 'Edit';
    editBtn.title = 'Edit score';
    editBtn.onclick = async () => {
      const newScore = prompt(`Enter new score for ${hero}:`, score);
      if (newScore !== null) {
        const parsedScore = parseInt(newScore);
        if (isNaN(parsedScore)) {
          alert('Please enter a valid number');
          return;
        }
        try {
          validateOverrideScore(parsedScore);
          currentOverrides[hero] = parsedScore;
          await renderOverrides();
          const result = await chrome.storage.local.get(['lastConfig']);
          const config = result.lastConfig || {
            algorithm: 'exponentialSmoothing',
            scoreOverrides: {}
          };
          config.scoreOverrides = currentOverrides;
          await chrome.storage.local.set({ lastConfig: config });
        } catch (e) {
          alert(e.message);
        }
      }
    };
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'override-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove override';
    removeBtn.onclick = async () => {
      delete currentOverrides[hero];
      const result = await chrome.storage.local.get(['lastConfig']);
      const config = result.lastConfig || {
        algorithm: 'exponentialSmoothing',
        scoreOverrides: {}
      };
      config.scoreOverrides = currentOverrides;
      if (hero === '0XMAKESY') config.removedDefaultMakesy = true;
      await chrome.storage.local.set({ lastConfig: config });
      await renderOverrides();
    };
    
    buttonGroup.appendChild(editBtn);
    buttonGroup.appendChild(removeBtn);
    
    item.appendChild(text);
    item.appendChild(buttonGroup);
    overrideList.appendChild(item);
  });
}

// Filter hero dropdown as user types
const heroSearchInput = document.getElementById('heroSearch');
heroSearchInput.addEventListener('input', (e) => {
  updateHeroListFilter(e.target.value);
});

heroSearchInput.addEventListener('focus', () => {
  if (heroSearchInput.value.trim()) {
    updateHeroListFilter(heroSearchInput.value);
  } else {
    updateHeroListFilter('');
  }
});

// Hide dropdown when clicking outside
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('heroDropdown');
  const searchInput = document.getElementById('heroSearch');
  if (!dropdown.contains(e.target) && e.target !== searchInput) {
    dropdown.classList.add('hidden');
  }
});

// Keyboard navigation
heroSearchInput.addEventListener('keydown', (e) => {
  const dropdown = document.getElementById('heroDropdown');
  if (dropdown.classList.contains('hidden')) return;
  
  const items = dropdown.querySelectorAll('.hero-dropdown-item:not([style*="cursor: default"])');
  
  if (items.length === 0) return;
  
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
    if (selectedIndex >= 0) {
      items[selectedIndex].scrollIntoView({ block: 'nearest' });
      items.forEach((item, idx) => {
        item.classList.toggle('selected', idx === selectedIndex);
      });
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIndex = Math.max(selectedIndex - 1, -1);
    if (selectedIndex >= 0) {
      items[selectedIndex].scrollIntoView({ block: 'nearest' });
      items.forEach((item, idx) => {
        item.classList.toggle('selected', idx === selectedIndex);
      });
    } else {
      // Clear selection if going above first item
      items.forEach(item => item.classList.remove('selected'));
    }
  } else if (e.key === 'Enter' && selectedIndex >= 0 && selectedIndex < items.length) {
    e.preventDefault();
    const heroKey = items[selectedIndex].dataset.heroKey;
    if (heroKey) {
      selectHero(heroKey);
    }
  } else if (e.key === 'Escape') {
    dropdown.classList.add('hidden');
    selectedIndex = -1;
  }
});

document.getElementById('addOverride').addEventListener('click', async () => {
  const heroInput = document.getElementById('heroSearch');
  const scoreInput = document.getElementById('overrideScore');
  
  let hero = heroInput.value.trim().toUpperCase();
  const score = parseInt(scoreInput.value);
  
  if (!hero) {
    alert('Please enter a hero name or handle');
    return;
  }
  
  if (isNaN(score)) {
    alert('Please enter a valid number');
    return;
  }
  try {
    validateOverrideScore(score);
  } catch (e) {
    alert(e.message);
    return;
  }

  currentOverrides[hero] = score;
  await renderOverrides();
  
  // Clear inputs and hide dropdown
  heroInput.value = '';
  scoreInput.value = '';
  document.getElementById('heroDropdown').classList.add('hidden');
  // Don't refocus - keep dropdown closed
  
  // Save overrides
  const result = await chrome.storage.local.get(['lastConfig']);
  const config = result.lastConfig || {
    algorithm: 'exponentialSmoothing',
    scoreOverrides: {}
  };
  config.scoreOverrides = currentOverrides;
  await chrome.storage.local.set({ lastConfig: config });
});


document.getElementById('refreshData').addEventListener('click', async () => {
  const button = document.getElementById('refreshData');
  const status = document.getElementById('status');
  
  button.disabled = true;
  status.className = 'status info';
  status.textContent = 'Refreshing historical data...';
  status.classList.remove('hidden');

  try {
    // Send message to background script (works from any page)
    const response = await chrome.runtime.sendMessage({
      action: 'refreshData'
    });

    if (response && response.success) {
      // Save current overrides after refresh
      const result = await chrome.storage.local.get(['lastConfig']);
      const config = result.lastConfig || {
        algorithm: 'exponentialSmoothing',
        scoreOverrides: {}
      };
      config.scoreOverrides = currentOverrides;
      await chrome.storage.local.set({ lastConfig: config });
      
      // Automatically calculate scores after refresh
      status.className = 'status info';
      status.textContent = 'Calculating expected scores...';
      
      const scoreSuccess = await calculateScoresAutomatically();
      
      if (scoreSuccess) {
        status.className = 'status success';
        status.textContent = `✓ Data refreshed! ${response.cardCount} cards, expected scores calculated`;
      } else {
        status.className = 'status success';
        status.textContent = `✓ Data refreshed! ${response.cardCount} cards loaded (scores will calculate on fantasy.top)`;
      }
      
      await updateCacheInfo();
    } else {
      status.className = 'status error';
      status.textContent = `✗ ${response?.error || 'Unknown error'}`;
    }
  } catch (error) {
    status.className = 'status error';
    status.textContent = `✗ Error: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});

// Helper function to calculate scores (reusable, works from anywhere)
async function calculateScoresAutomatically(showStatus = false) {
  try {
    const algorithm = document.getElementById('algorithm').value;
    
    const response = await chrome.runtime.sendMessage({
      action: 'calculateScores',
      config: {
        algorithm: algorithm
      }
    });
    
    if (response && response.success) {
      await updateCacheInfo(); // Refresh dropdown with new scores
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error calculating scores:', error);
    return false;
  }
}

// Default Makesy: 1⭐ → override or 300, 2+⭐ → 0. Score is derived from star count only.
const DEFAULT_MAKESY_1STAR = 300;
function makesyExpectedScore(stars, userOverride) {
  if (stars !== 1) return 0;
  return userOverride !== undefined ? userOverride : DEFAULT_MAKESY_1STAR;
}

// Load saved config
chrome.storage.local.get(['lastConfig'], async (result) => {
  if (result.lastConfig) {
    const config = result.lastConfig;
    document.getElementById('tournament').value = config.tournament || 'bronze';
    document.getElementById('algorithm').value = config.algorithm || 'exponentialSmoothing';
    currentOverrides = { ...(config.scoreOverrides || {}) };
    await renderOverrides();
  } else {
    document.getElementById('tournament').value = 'bronze';
    document.getElementById('algorithm').value = 'exponentialSmoothing';
    currentOverrides = { '0XMAKESY': DEFAULT_MAKESY_1STAR };
    await chrome.storage.local.set({
      lastConfig: {
        tournament: 'bronze',
        algorithm: 'exponentialSmoothing',
        scoreOverrides: currentOverrides
      }
    });
    await renderOverrides();
  }
});

// Save config when tournament or algorithm changes
function saveConfigFromForm() {
  return chrome.storage.local.get(['lastConfig']).then(result => {
    const config = result.lastConfig || { tournament: 'bronze', algorithm: 'exponentialSmoothing', scoreOverrides: {} };
    config.tournament = document.getElementById('tournament').value;
    config.algorithm = document.getElementById('algorithm').value;
    config.scoreOverrides = currentOverrides;
    return chrome.storage.local.set({ lastConfig: config });
  });
}

document.getElementById('tournament').addEventListener('change', saveConfigFromForm);

document.getElementById('algorithm').addEventListener('change', async () => {
  await saveConfigFromForm();
  
  // Automatically recalculate scores
  const status = document.getElementById('status');
  status.className = 'status info';
  status.textContent = 'Recalculating expected scores...';
  status.classList.remove('hidden');
  
  const success = await calculateScoresAutomatically();
  
  if (success) {
    status.className = 'status success';
    status.textContent = '✓ Expected scores recalculated';
    setTimeout(() => {
      status.classList.add('hidden');
    }, 2000);
  } else {
    status.className = 'status info';
    status.textContent = 'Expected scores will be recalculated when you navigate to fantasy.top';
    setTimeout(() => {
      status.classList.add('hidden');
    }, 3000);
  }
});

// Verify ownership button handler
document.getElementById('verifyButton').addEventListener('click', async () => {
  const button = document.getElementById('verifyButton');
  const status = document.getElementById('status');
  
  button.disabled = true;
  button.textContent = '⏳ Verifying...';
  status.className = 'status info';
  status.textContent = 'Verifying ownership...';
  status.classList.remove('hidden');
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url || !tab.url.includes('fantasy.top')) {
      status.className = 'status error';
      status.textContent = '✗ Please navigate to fantasy.top first';
      button.disabled = false;
      button.textContent = '🔍 Verify';
      return;
    }
    
    if (!tab.url.includes('/player/')) {
      status.className = 'status error';
      status.textContent = '✗ Please navigate to your portfolio page (fantasy.top/player/0x...)';
      button.disabled = false;
      button.textContent = '🔍 Verify';
      return;
    }
    
    // Send message to content script to verify ownership
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'verifyOwnership'
    });
    
    if (response && response.success) {
      status.className = 'status success';
      status.textContent = '✅ Verification complete! Luke Mode activated.';
      await updateWhitelistStatus();
      setTimeout(() => {
        status.classList.add('hidden');
      }, 3000);
    } else {
      status.className = 'status error';
      status.textContent = response?.error || '✗ Could not find lukecannon727 card. Make sure you own the card and it\'s visible on the page.';
      button.disabled = false;
      button.textContent = '🔍 Verify';
    }
  } catch (error) {
    status.className = 'status error';
    if (error.message.includes('Receiving end does not exist')) {
      status.textContent = '✗ Please refresh the fantasy.top page';
    } else {
      status.textContent = `✗ Error: ${error.message}`;
    }
    button.disabled = false;
    button.textContent = '🔍 Verify';
  }
});

// Build deck button handler
document.getElementById('buildDeck').addEventListener('click', async () => {
  const button = document.getElementById('buildDeck');
  const status = document.getElementById('status');
  
  button.disabled = true;
  status.className = 'status info';
  status.textContent = 'Building deck...';
  status.classList.remove('hidden');

  const config = {
    tournament: document.getElementById('tournament').value,
    algorithm: document.getElementById('algorithm').value,
    scoreOverrides: currentOverrides
  };

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Check if we're on fantasy.top
    if (!tab.url || !tab.url.includes('fantasy.top')) {
      status.className = 'status error';
      status.textContent = '✗ Please navigate to fantasy.top first';
      button.disabled = false;
      return;
    }
    
    // Allow building on portfolio page or deckbuilder page
    if (!tab.url.includes('/player/') && !tab.url.includes('/deckbuilder')) {
      status.className = 'status error';
      status.textContent = '✗ Please navigate to your portfolio page or deck builder page';
      button.disabled = false;
      return;
    }
    
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'buildDeck',
      config: config
    });

    if (response.success) {
      status.className = 'status success';
      const RARITY_LABEL = { 1: 'Leg', 2: 'Epic', 3: 'Rare', 4: '' };
      const deckLines = (response.cards || []).map(c => {
        const score = (c.expectedScore ?? 0).toFixed(0);
        const label = RARITY_LABEL[c.rarity ?? 4] || '';
        return `${c.name} (${score}${label ? ' ' + label : ''})`;
      }).join('\n');
      const totalExp = response.totalExpected != null ? response.totalExpected.toFixed(0) : '—';
      status.textContent = `✓ Deck built! ${response.cards.length} cards (${response.totalStars}⭐). Total expected: ${totalExp}\n\n${deckLines}`;
      
      // Save config for next time
      chrome.storage.local.set({ lastConfig: config });
      
      await updateCacheInfo();
    } else {
      status.className = 'status error';
      status.textContent = `✗ ${response.error}`;
    }
  } catch (error) {
    status.className = 'status error';
    if (error.message.includes('Receiving end does not exist')) {
      status.textContent = '✗ Please refresh the fantasy.top page';
    } else {
      status.textContent = `✗ Error: ${error.message}`;
    }
  } finally {
    button.disabled = false;
  }
});

// Update whitelist status and cache info on load
updateWhitelistStatus();
updateCacheInfo();