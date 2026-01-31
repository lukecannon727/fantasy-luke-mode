// Content script for fantasy.top deck builder
// DOM Element Handling: DOM elements are NEVER stored in long-term data structures
// or cache. They are always re-resolved from cardId (e.g., img[alt*="${cardId}_"])
// when needed. This prevents stale references and serialization issues.
class FantasyDeckBuilder {
  constructor() {
    this.cards = []; // [{ heroKey, handle, name, stars, ... }]
    this.historicalData = {}; // heroKey -> scores[]
    this.portfolioCards = []; // [{ cardId, heroKey }] - NO element property, NO stars (stars come from historical data)
    this.CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds
    this.buttonInjected = false; // Track if button was successfully injected
    this.injectionObserver = null; // MutationObserver for button injection
    
    // Performance caches for repeated deck building
    this.scoreCache = new Map(); // (heroKey + algorithm + configHash) -> score
    this.sortedCardsCache = null; // Cached sorted cards array
    this.lastConfigHash = null; // Hash of last config used for sorting
  }
  
  // Debug flag - set to true for verbose logging
  static DEBUG = false;

  // Initialize: inject custom magic wand button
  async init() {
    await this.loadHistoricalData();
    
    // Only inject button if whitelisted and on deck builder page
    if (await this.isWhitelisted()) {
      this.injectCustomWandButton();
    }
  }
  
  // Check if current address is whitelisted (or on deckbuilder with any whitelisted address)
  async isWhitelisted() {
    const result = await chrome.storage.local.get(['whitelistedAddresses']);
    const whitelist = result.whitelistedAddresses || [];
    if (whitelist.length === 0) return false;

    const url = window.location.href;
    const match = url.match(/\/player\/(0x[a-fA-F0-9]+)/);
    if (match) {
      const address = match[1].toLowerCase();
      return whitelist.includes(address);
    }
    // Deck builder is at /play/tournament/:id/deckbuilder (no wallet in URL) — treat as whitelisted if any address is whitelisted
    if (/\/play\/tournament\/[^/]+\/deckbuilder/.test(url) || url.includes('/deckbuilder')) return true;
    return false;
  }
  
  // Check for lukecannon727 card on portfolio page
  async checkForLukeCard() {
    console.log('🔍 Checking for lukecannon727 card...');
    
    const url = window.location.href;
    const match = url.match(/\/player\/(0x[a-fA-F0-9]+)/);
    if (!match) {
      console.log('⚠️ Could not extract address from URL');
      return false;
    }
    
    const address = match[1].toLowerCase();
    
    // Check if already whitelisted
    if (await this.isWhitelisted()) {
      console.log('✅ Address already whitelisted');
      return true;
    }
    
    // Scroll down the page to load all cards - keep scrolling until we find it or truly reach the bottom
    let lastHeight = 0;
    let scrollAttempts = 0;
    const maxScrollAttempts = 50;
    let noChangeCount = 0;
    
    while (scrollAttempts < maxScrollAttempts) {
      // Scroll to bottom
      window.scrollTo(0, document.body.scrollHeight);
      await this.sleep(800);
      
      // Check if we've reached the bottom
      const currentHeight = document.body.scrollHeight;
      if (currentHeight === lastHeight) {
        noChangeCount++;
        if (noChangeCount >= 3) {
          console.log('📜 Reached bottom of page (no height change for 3 attempts)');
          break;
        }
      } else {
        noChangeCount = 0;
      }
      lastHeight = currentHeight;
      scrollAttempts++;
    }
    
    // Now that we've scrolled, search for lukecannon727 card in DOM
    console.log('🔍 Searching for lukecannon727 card in DOM...');
    
    // Look for elements with aria-label containing "lukecannon727"
    // Cards are nested in div.contents, and aria-label is "Card for lukecannon727"
    const contentsDiv = document.querySelector('div.contents');
    
    // First try within contents div if it exists
    let foundElement = null;
    if (contentsDiv) {
      foundElement = contentsDiv.querySelector('[aria-label*="lukecannon727" i]');
      if (foundElement) {
        console.log('✅ Found lukecannon727 card within div.contents');
      }
    }
    
    // Fallback to full document search if not found in contents
    if (!foundElement) {
      foundElement = document.querySelector('[aria-label*="lukecannon727" i]');
      if (foundElement) {
        console.log('✅ Found lukecannon727 card in document');
      }
    }
    
    if (foundElement) {
      console.log('✅ Found lukecannon727 card! Whitelisting address...');
      
      // Add to whitelist
      const result = await chrome.storage.local.get(['whitelistedAddresses']);
      const whitelist = result.whitelistedAddresses || [];
      if (!whitelist.includes(address)) {
        whitelist.push(address);
        await chrome.storage.local.set({ whitelistedAddresses: whitelist });
        console.log(`✅ Whitelisted address: ${address}`);
        
        // Show notification
        this.showNotification('✅ Luke Mode activated! You can now use the deck builder.', 'success');
        
        // If on deck builder page, inject button now
        if (window.location.href.includes('/deckbuilder')) {
          this.injectCustomWandButton();
        }
      }
      return true;
    }
    
    console.log('⚠️ lukecannon727 card not found in DOM');
    return false;
  }
  

  // Inject custom magic wand button next to Fantasy.top's magic wand or in deck builder area
  async injectCustomWandButton() {
    const checkAndInject = async () => {
      // Check if we're on the deck builder page
      if (!window.location.href.includes('/deckbuilder')) {
        console.log('⏭️ Not on deck builder page, skipping button injection');
        return;
      }
      
      // Check if whitelisted
      if (!(await this.isWhitelisted())) {
        console.log('⏭️ Address not whitelisted, skipping button injection');
        return;
      }

      // Skip if button already exists
      if (document.getElementById('fantasy-custom-wand') || this.buttonInjected) {
        return;
      }

      // Deck builder bar: div with max-w-3xl, bg-gray-900, rounded-3xl, gap-x-5 → button[aria-label="Magic Wand"] inside
      const bar = Array.from(document.querySelectorAll('div')).find(el => {
        const c = el.className || '';
        return c.includes('max-w-3xl') && c.includes('bg-gray-900') && c.includes('rounded-3xl') && c.includes('gap-x-5');
      });
      const magicWandBtn = bar ? (bar.querySelector('button[aria-label="Magic Wand"]') || bar.querySelector('svg[aria-label="Magic Wand"]')?.closest('button')) : null;

      if (!magicWandBtn) return;

      const customWand = document.createElement('button');
      customWand.id = 'fantasy-custom-wand';
      customWand.className = 'fantasy-custom-wand';
      customWand.setAttribute('data-tooltip', 'Luke Mode');
      
      customWand.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.buildDeckFromButton();
      });
      
      magicWandBtn.parentNode.insertBefore(customWand, magicWandBtn.nextSibling);
      this.buttonInjected = true;
      
      if (this.injectionObserver) {
        this.injectionObserver.disconnect();
        this.injectionObserver = null;
      }
    };

    // Try immediately
    checkAndInject();
    
    // Retry after delays (for SPA navigation)
    setTimeout(() => checkAndInject(), 500);
    setTimeout(() => checkAndInject(), 1000);
    setTimeout(() => checkAndInject(), 2000);
    
    // Watch for page changes (debounced and limited scope)
    let debounceTimer = null;
    const debouncedCheck = async () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        if (!this.buttonInjected && await this.isWhitelisted()) {
          await checkAndInject();
        }
      }, 500);
    };
    
    // Only observe if button not yet injected
    if (!this.buttonInjected) {
      this.injectionObserver = new MutationObserver(debouncedCheck);
      // Only watch for new children, not attribute changes (less expensive)
      this.injectionObserver.observe(document.body, { 
        childList: true, 
        subtree: false // Only direct children, not deep subtree
      });
      
      // Disconnect after 10 seconds to avoid long-running observer
      setTimeout(() => {
        if (this.injectionObserver) {
          this.injectionObserver.disconnect();
          this.injectionObserver = null;
        }
      }, 10000);
    }
  }

  // Build deck (can be called from button or popup)
  async buildDeck(config = null) {
    console.log('🪄 Building deck...');

    try {
      // Load config and data
      let finalConfig = config;
      if (!finalConfig) {
        const configResult = await chrome.storage.local.get(['lastConfig']);
        finalConfig = configResult.lastConfig || {
          algorithm: 'exponentialSmoothing',
          scoreOverrides: {}
        };
        if (!finalConfig.scoreOverrides) finalConfig.scoreOverrides = {};
        if (finalConfig.scoreOverrides['0XMAKESY'] === undefined) finalConfig.scoreOverrides['0XMAKESY'] = 300;
      }
      
      const cacheResult = await chrome.storage.local.get(['cacheTimestamp', 'historicalDataCache', 'cardDataCache']);
      
      // Tournament: 5 cards, 19 stars max (hard cap — never accept > 19)
      finalConfig.targetStars = 19;
      finalConfig.cardCount = 5;
      
      if (FantasyDeckBuilder.DEBUG) {
        console.log('⚙️ Configuration loaded:', finalConfig);
        console.log('🎯 Target: 5 cards with 19 total stars');
      }

      // Load historical data (check cache first, then fetch if needed)
      await this.loadHistoricalData(cacheResult);
      
      // Scrape portfolio cards from the page
      await this.scrapePortfolioCards();
      
      // Filter cards to only those in portfolio
      this.filterCardsByPortfolio();
      
      // Clear score cache when cards change (portfolio filtering may have changed available cards)
      this.scoreCache.clear();
      this.sortedCardsCache = null;
      this.lastConfigHash = null;

      console.log(`✅ ${this.cards.length} cards available for selection (from portfolio)`);

      // Find best deck
      console.log('🧮 Calculating optimal deck combination...');
      const bestDeck = this.findBestDeck(finalConfig);
      
      if (!bestDeck || bestDeck.length === 0) {
        console.error('❌ Could not find valid combination');
        this.showNotification('Could not find valid combination', 'error');
        return { success: false, error: 'Could not find valid combination' };
      }

      console.log('✅ Optimal deck found:');
      bestDeck.forEach((card, i) => {
        console.log(`  ${i + 1}. ${card.name} (${card.stars}⭐) - Expected: ${card.expectedScore.toFixed(0)}`);
      });

      const totalStars = bestDeck.reduce((sum, card) => sum + card.stars, 0);
      const totalExpected = bestDeck.reduce((sum, card) => sum + card.expectedScore, 0);
      console.log(`📊 Total: ${totalStars}⭐ | Expected Score: ${totalExpected.toFixed(0)}`);

      // Only clear and select cards if on deckbuilder page
      if (window.location.href.includes('/deckbuilder')) {
        // Clear and select cards
        console.log('🗑️ Clearing current deck...');
        await this.clearDeck();
        
        console.log('👆 Selecting new cards...');
        await this.selectCards(bestDeck);
        
        this.showNotification(`✅ Deck built! ${bestDeck.length} cards (${totalStars}⭐)`, 'success');
      } else {
        // On portfolio page, just show the result
        this.showNotification(`✅ Optimal deck calculated! ${bestDeck.length} cards (${totalStars}⭐) - Check console for details`, 'success');
      }
      
      console.log('🎉 Deck building complete!');
      
      // Save calculated scores for UI reference
      await this.saveCalculatedScores(finalConfig);
      
      return {
        success: true,
        cards: bestDeck.map(c => ({ name: c.handle || c.name, stars: c.stars })),
        totalStars
      };
    } catch (error) {
      console.error('❌ Error building deck:', error);
      this.showNotification(`Error: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  // Build deck when custom wand button is clicked
  async buildDeckFromButton() {
    const button = document.getElementById('fantasy-custom-wand');
    if (!button) return;
    
    button.classList.add('loading');
    const result = await this.buildDeck();
    button.classList.remove('loading');
    return result;
  }

  // Show notification on page
  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 16px 20px;
      background: ${type === 'success' ? '#1a4d1a' : type === 'error' ? '#4d1a1a' : '#1a3a4d'};
      color: ${type === 'success' ? '#7cff00' : type === 'error' ? '#ff6b6b' : '#6bb6ff'};
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      font-weight: 500;
      animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  // Load historical data (consolidated method - loads cache and fetches if needed)
  async loadHistoricalData(cacheResult = null) {
    // If cacheResult provided, use it; otherwise fetch (allows batching with other storage calls)
    if (!cacheResult) {
      cacheResult = await chrome.storage.local.get(['cacheTimestamp', 'historicalDataCache', 'cardDataCache']);
    }
    
    // Load from cache if available
    if (cacheResult.historicalDataCache) {
      this.historicalData = cacheResult.historicalDataCache;
      if (FantasyDeckBuilder.DEBUG) {
        console.log(`📦 Loaded ${Object.keys(this.historicalData).length} heroes from cache`);
      }
    }
    if (cacheResult.cardDataCache) {
      this.cards = cacheResult.cardDataCache;
      if (FantasyDeckBuilder.DEBUG) {
        console.log(`📦 Loaded ${this.cards.length} cards from cache`);
      }
    }
    
    // Check if cache needs refresh
    if (!cacheResult.cacheTimestamp) {
      console.log('📭 No cache found, fetching historical data...');
      await this.scrapeAllHistoricalData();
      return;
    }

    const cacheAge = Date.now() - cacheResult.cacheTimestamp;
    const cacheAgeHours = (cacheAge / (1000 * 60 * 60)).toFixed(1);
    
    if (cacheAge > this.CACHE_DURATION) {
      console.log(`⏰ Cache expired (${cacheAgeHours}h old), refreshing...`);
      await this.scrapeAllHistoricalData();
    } else if (this.cards.length === 0) {
      // Cache exists but no cards loaded - fetch fresh data
      console.log('🌐 No cards in cache, fetching from Google Sheets...');
      await this.scrapeAllHistoricalData();
    } else if (FantasyDeckBuilder.DEBUG) {
      console.log(`✅ Using cached historical data (${cacheAgeHours}h old)`);
    }
  }


  // Load portfolio: only cardId→heroKey mapping + portfolio cardIds (for API skip + deck builder)
  async loadPortfolioCache() {
    const result = await chrome.storage.local.get(['cardIdToHeroKeyCache', 'portfolioCardIds', 'portfolioCardsCache']);
    if (result.cardIdToHeroKeyCache && result.portfolioCardIds?.length > 0) {
      this.portfolioCards = result.portfolioCardIds.map(cardId => ({ cardId, heroKey: result.cardIdToHeroKeyCache[cardId] })).filter(c => c.heroKey);
      if (FantasyDeckBuilder.DEBUG) {
        console.log(`📦 Loaded ${this.portfolioCards.length} portfolio cards from cache (${Object.keys(result.cardIdToHeroKeyCache).length} id→hero mappings)`);
      }
    } else if (result.portfolioCardsCache?.length > 0) {
      this.portfolioCards = result.portfolioCardsCache;
      if (FantasyDeckBuilder.DEBUG) {
        console.log(`📦 Loaded ${this.portfolioCards.length} portfolio cards from legacy cache`);
      }
    }
  }

  // Save only cardId→heroKey mapping + portfolio cardIds (no full card objects)
  async savePortfolioCache() {
    const map = {};
    const ids = [];
    this.portfolioCards.forEach(card => {
      if (card.cardId && card.heroKey) {
        map[card.cardId] = card.heroKey;
        ids.push(card.cardId);
      }
    });
    await chrome.storage.local.set({ cardIdToHeroKeyCache: map, portfolioCardIds: ids });
    console.log(`💾 Saved ${ids.length} portfolio cardIds, ${Object.keys(map).length} id→hero mappings`);
  }

  // Helper function to parse CSV line (handles quoted fields)
  parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  // Scrape all historical data from Google Sheets
  async scrapeAllHistoricalData() {
    console.log('🌐 Fetching historical data from Google Sheets...');
    
    try {
      // Fetch the public Google Sheet as CSV
      const sheetId = '10GdAFNpvbCQD5stPiyPDatiWhRW6MAizYwRazLyuSy0';
      const gid = '0';
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
      
      console.log('📡 Fetching:', csvUrl);
      const response = await fetch(csvUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const csvText = await response.text();
      console.log(`✅ Received ${(csvText.length / 1024).toFixed(1)}KB of data`);
      
      // Parse CSV
      const lines = csvText.split('\n');
      console.log(`📄 Parsing ${lines.length} lines...`);
      
      console.log('📋 First 3 lines (raw):');
      lines.slice(0, 3).forEach((line, i) => {
        const preview = line.length > 150 ? line.substring(0, 150) + '...' : line;
        console.log(`  Line ${i}: ${preview}`);
      });
      
      // Headers are on line 2 (index 1)
      const headers = this.parseCSVLine(lines[1]);
      console.log(`📋 Found ${headers.length} header columns`);
      console.log('📋 Headers (first 20):', headers.slice(0, 20).join(' | '));
      console.log('📋 Headers (70-85):', headers.slice(70, 85).join(' | '));
      
//define columns
      const nameCol = 4;  // Column E (0-indexed, so column 5 = index 4)
      const handleCol = 5; // Column F
      const starsCol = 15; // Column P (0-indexed, so column 16 = index 15)
      
      // Find tournament columns (53 columns starting from column 75)
      const tournamentCols = Array.from({ length: 53 }, (_, i) => 75 + i);
      
      const historicalData = {};
      const cardData = [];
      let processedRows = 0;
      let skippedRows = 0;
      
      console.log('📊 Starting to parse data rows from line 2 onwards...');
      
      // Parse each row (starting from row 3, which is line index 2)
      for (let i = 2; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.length === 0) {
          skippedRows++;
          continue;
        }
        
        const row = this.parseCSVLine(line);
        
        if (row.length < 20) {
          skippedRows++;
          if (skippedRows <= 3) {
            console.log(`  ⏭️ Line ${i}: Skipped (only ${row.length} columns)`);
          }
          continue;
        }
        
        // Combine name and handle
        const namePart = row[nameCol]?.trim() || '';
        const handlePart = row[handleCol]?.trim() || '';
        const name = `${namePart}`.trim();
        const handle = `${handlePart}`.trim();
        const heroKey = (handle || name).toUpperCase();
        const starsRaw = row[starsCol]?.trim();
        const stars = parseInt(starsRaw);
        
        if (!heroKey || heroKey.length < 2 || isNaN(stars)) {
          skippedRows++;
          if (skippedRows <= 3) {
            console.log(`  ⏭️ Line ${i}: Skipped (heroKey="${heroKey}", stars="${starsRaw}")`);
          }
          continue;
        }
        
        // Extract tournament scores (most recent first)
        const scores = [];
        for (const i of tournamentCols) {
          const scoreRaw = row[i]?.trim();
          const score = parseInt(scoreRaw);
          if (!isNaN(score) && score >= 0) { // Include 0 scores (heroes with tournament history but scored 0)
            scores.push(score);
          }
        }
        
        if (scores.length > 0) {
          historicalData[heroKey] = scores; // All available historical data (up to 53 weeks)
          cardData.push({ heroKey, handle, name, stars });
          processedRows++;
          
          if (processedRows <= 5 || processedRows % 50 === 0) {
            console.log(`  ✓ ${processedRows}. ${heroKey}: ${scores.length} tournaments (${stars}⭐) - Scores: [${scores.slice(0, 4).join(', ')}${scores.length > 4 ? '...' : ''}]`);
          }
        } else {
          skippedRows++;
          if (skippedRows <= 3) {
            console.log(`  ⏭️ Line ${i}: "${heroKey}" skipped (no tournament scores found)`);
          }
        }
      }
      
      console.log('');
      console.log('✅ === PARSING COMPLETE ===');
      console.log(`   ✓ ${processedRows} heroes successfully processed`);
      console.log(`   ⏭️ ${skippedRows} rows skipped`);
      console.log(`   📊 Success rate: ${((processedRows / (processedRows + skippedRows)) * 100).toFixed(1)}%`);
      console.log('');
      
      // Save to cache
      this.historicalData = historicalData;
      this.cards = cardData;
      
      await chrome.storage.local.set({
        historicalDataCache: historicalData,
        cardDataCache: cardData,
        cacheTimestamp: Date.now()
      });

      console.log(`💾 Historical data cached for ${Object.keys(historicalData).length} heroes`);
      return Object.keys(historicalData).length;
      
    } catch (error) {
      console.error('❌ Error fetching from Google Sheets:', error);
      throw new Error('Failed to fetch data from Google Sheets');
    }
  }


  // Scrape portfolio cards from the page
  async scrapePortfolioCards() {
    console.log('🔍 Scraping portfolio cards from page...');

    // Load portfolio cache to avoid redundant API calls (only for API optimization)
    await this.loadPortfolioCache();
    
    // Find all card images on the page
    const cardImages = Array.from(document.querySelectorAll('img[alt]')).filter(img => {
      const alt = img.getAttribute('alt') || '';
      // Look for pattern like "200590_0x806aB8Efb6b0Db382A76972AD97Fa830EEd1274E"
      return /^\d+_0x[a-fA-F0-9]+$/.test(alt);
    });
    
    console.log(`📸 Found ${cardImages.length} card images with valid alt attributes`);
    
    if (cardImages.length === 0) {
      console.warn('⚠️ No portfolio cards found on page');
      return [];
    }
    
    // Create map for quick lookup (from cache to avoid redundant API calls)
    const cachedCardMap = new Map(); // cardId -> card
    
    this.portfolioCards.forEach(card => {
      if (card.cardId) {
        cachedCardMap.set(card.cardId, card);
      }
    });
    
    // Extract card IDs (deduplicate)
    const cardIdsToFetch = new Set();
    const cardIdToImg = new Map();
    
    for (const img of cardImages) {
      const alt = img.getAttribute('alt');
      const match = alt.match(/^(\d+)_/);
      if (!match) continue;
      
      const cardId = match[1];
      if (!cachedCardMap.has(cardId) && !cardIdsToFetch.has(cardId)) {
        cardIdsToFetch.add(cardId);
        cardIdToImg.set(cardId, img);
      }
    }
    
    // Batch fetch uncached cards in parallel (limit concurrency to avoid rate limiting)
    const CONCURRENT_FETCHES = 5;
    const cardIdsArray = Array.from(cardIdsToFetch);
    let fetchedCount = 0;
    
    for (let i = 0; i < cardIdsArray.length; i += CONCURRENT_FETCHES) {
      const batch = cardIdsArray.slice(i, i + CONCURRENT_FETCHES);
      const fetchPromises = batch.map(async (cardId) => {
        try {
          // Use contract address for card metadata API
          const contractAddress = '0x806aB8Efb6b0Db382A76972AD97Fa830EEd1274E';
          const apiUrl = `https://r2.fantasy.top/${contractAddress}/${cardId}`;
          if (FantasyDeckBuilder.DEBUG) {
            console.log(`  📡 Fetching ${i + batch.indexOf(cardId) + 1}/${cardIdsArray.length}: ${apiUrl}`);
          }
          
          const response = await fetch(apiUrl);
          if (!response.ok) {
            if (FantasyDeckBuilder.DEBUG) {
              console.warn(`  ⚠️ Failed to fetch ${cardId}: ${response.status}`);
            }
            return null;
          }
          
          const metadata = await response.json();
          const heroName = metadata.name || null;
          const heroKey = (heroName || '').toUpperCase();
          
          if (!heroName) {
            if (FantasyDeckBuilder.DEBUG) {
              console.warn(`  ⚠️ Missing data for ${cardId}: name=${heroName}`);
            }
            return null;
          }
          
          fetchedCount++;
          return { cardId, heroKey, heroName };
        } catch (error) {
          if (FantasyDeckBuilder.DEBUG) {
            console.error(`  ❌ Error fetching card ${cardId}:`, error);
          }
          return null;
        }
      });
      
      const results = await Promise.all(fetchPromises);
      
      // Process results
      for (const result of results) {
        if (!result) continue;
        cachedCardMap.set(result.cardId, { heroKey: result.heroKey });
      }
      
      // Small delay between batches to avoid overwhelming the API
      if (i + CONCURRENT_FETCHES < cardIdsArray.length) {
        await this.sleep(100);
      }
    }
    
    // Build portfolio cards from all card images (cached + newly fetched)
    const portfolioCards = [];
    const processedCardIds = new Set();
    let cachedCount = 0;
    
    for (const img of cardImages) {
      const alt = img.getAttribute('alt');
      const match = alt.match(/^(\d+)_/);
      if (!match) continue;
      
      const cardId = match[1];
      if (processedCardIds.has(cardId)) continue;
      processedCardIds.add(cardId);
      
      const cachedCard = cachedCardMap.get(cardId);
      if (cachedCard && cachedCard.heroKey) {
        portfolioCards.push({
          cardId,
          heroKey: cachedCard.heroKey
        });
        cachedCount++;
      } else if (cachedCard && !cachedCard.heroKey) {
        // Card in cache but missing heroKey - skip for now (will be refetched on next run)
        if (FantasyDeckBuilder.DEBUG) {
          console.warn(`⚠️ Cached card ${cardId} missing heroKey, skipping (will refetch on next run)`);
        }
      }
    }
      
    console.log(`📊 Portfolio scraping: ${cachedCount} from cache, ${fetchedCount} fetched from API`);
    
    // Update portfolio cards (replace with fresh scrape, but keep cache for API optimization)
    this.portfolioCards = portfolioCards;
    
    // Save updated portfolio to cache (for future API call optimization)
    await this.savePortfolioCache();
    
    const uniqueHeroes = new Set(this.portfolioCards.map(c => c.heroKey));
    console.log(`✅ Portfolio now has ${this.portfolioCards.length} cards (${uniqueHeroes.size} unique heroes)`);
    
    return portfolioCards;
  }

  // Filter cards to only those in portfolio (and not already used)
  // Note: Used cards are removed from this.portfolioCards when marked as used,
  // but we double-check here in case cache was loaded with used cards
  filterCardsByPortfolio() {
    if (this.portfolioCards.length === 0) {
      console.log('⚠️ No portfolio cards available, using all cards');
      return;
    }
    
    const originalCount = this.cards.length;
    
    // Create a map of heroKey -> available portfolio cards (multiple cardIds per hero possible)
    const portfolioMap = new Map();
    this.portfolioCards.forEach(pCard => {
      if (!pCard.heroKey) {
        console.warn('⚠️ Portfolio card missing heroKey:', pCard);
        return; // Skip cards without heroKey
      }
      if (!portfolioMap.has(pCard.heroKey)) {
        portfolioMap.set(pCard.heroKey, []);
      }
      portfolioMap.get(pCard.heroKey).push(pCard);
    });
    
    // Filter and map cards to portfolio cards
    // Match by heroKey only - stars come from historical data (this.cards)
    // Create one card entry per available portfolio card (to allow multiple copies of same hero)
    const filteredCards = [];
    const usedCardIdsInFilter = new Set(); // Track cardIds we've already added to avoid duplicates
    
    this.cards.forEach(card => {
      // Use heroKey for matching (stars are already in card from historical data)
      const heroKey = (card.heroKey || card.handle || card.name).toUpperCase();
      const portfolioMatches = portfolioMap.get(heroKey) || [];
      
      // Add one card entry for each available portfolio card of this hero
      for (const match of portfolioMatches) {
        // Only add if we haven't already used this cardId
        if (!usedCardIdsInFilter.has(match.cardId)) {
          filteredCards.push({
            ...card,
            // Note: element is NOT copied here - re-resolve from cardId when needed
            cardId: match.cardId
          });
          usedCardIdsInFilter.add(match.cardId);
        }
      }
    });
    
    this.cards = filteredCards;
    console.log(`📊 Filtered: ${originalCount} heroes (with history) → ${this.cards.length} portfolio cards (one per owned copy)`);
    
    if (this.cards.length === 0) {
      console.warn('⚠️ No matching cards found in portfolio! Make sure you have cards with historical data.');
    }
  }

  // Scrape card data from current page
/*   async scrapeCards() {
    console.log('🔍 Scraping cards from page...');
    
    // Try multiple possible selectors for card elements
    const cardSelectors = [
      '[class*="card"]',
      '[data-card]',
      '[class*="hero"]',
      '[class*="player"]',
      'img[alt*="card"]',
      'div[role="button"]'
    ];
    
    let cardElements = [];
    for (const selector of cardSelectors) {
      cardElements = Array.from(document.querySelectorAll(selector));
      if (cardElements.length > 10) {
        console.log(`✅ Found ${cardElements.length} potential cards using selector: ${selector}`);
        break;
      }
    }
    
    if (cardElements.length === 0) {
      console.warn('⚠️ No card elements found on page');
      return;
    }
    
    let matchedCards = 0;
    
    // Try to match cards from cache with DOM elements
    for (const card of this.cards) {
      for (const element of cardElements) {
        const text = element.textContent?.toUpperCase() || '';
        const alt = element.getAttribute('alt')?.toUpperCase() || '';
        const title = element.getAttribute('title')?.toUpperCase() || '';
        
        if (text.includes(card.name) || alt.includes(card.name) || title.includes(card.name)) {
          card.element = element;
          matchedCards++;
          break;
        }
      }
    }
    
    console.log(`✅ Matched ${matchedCards}/${this.cards.length} cards with DOM elements`);
  }
 */

  // Calculate expected score for a card based on historical data
  calculateScore(name, algorithm, excludeNoHistory = false) {
    const historicalScores = this.historicalData[name.toUpperCase()];
    
    if (!historicalScores || historicalScores.length === 0) {
      return 0; // Always return 0 for no history (excludeNoHistory removed)
    }

    switch (algorithm) {
      case 'recent6weeks':
        return this.averageScore(historicalScores.slice(0, 6));
      
      case 'recent4weeks':
        return this.averageScore(historicalScores.slice(0, 4));
      
    case 'recent6exclude1':
      return this.averageExcludingOutliers(historicalScores.slice(0, 6), 1);
    
    case 'recent4exclude1':
      return this.averageExcludingOutliers(historicalScores.slice(0, 4), 1);
      
      case 'weighted':
        return this.weightedScore(historicalScores);
      
      case 'consistencyFloor':
        return this.consistencyFloor(historicalScores.slice(0, 6));
      
      case 'consistencyMedian':
        return this.consistencyMedian(historicalScores.slice(0, 6));
      
      case 'exponentialSmoothing':
        return this.exponentialSmoothing(historicalScores, 0.3);
      
      default:
        return this.exponentialSmoothing(historicalScores, 0.3);
    }
  }

  averageScore(scores) {
    if (scores.length === 0) return 0;
    return scores.reduce((sum, s) => sum + s, 0) / scores.length;
  }

  averageExcludingOutliers(scores, numToExclude) {
    if (scores.length <= numToExclude) {
      return this.averageScore(scores);
    }
    
    // Sort and remove extremes (both high and low)
    const sorted = [...scores].sort((a, b) => a - b);
    
    // Remove outliers from both ends
    const toRemoveEachEnd = Math.floor(numToExclude / 2);
    const remaining = sorted.slice(toRemoveEachEnd, sorted.length - (numToExclude - toRemoveEachEnd));
    
    return this.averageScore(remaining);
  }

  weightedScore(scores) {
    if (scores.length === 0) return 0;
    
    // Weights:
    const weights = [0.3, 0.2, 0.175, 0.15, 0.125, 0.05];
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (let i = 0; i < Math.min(scores.length, 5); i++) {
      weightedSum += scores[i] * weights[i];
      totalWeight += weights[i];
    }
    
    return weightedSum / totalWeight;
  }

  consistencyFloor(scores) {
    if (scores.length === 0) return 0;
    // Return the worst performance (floor)
    return Math.min(...scores);
  }

  consistencyMedian(scores) {
    if (scores.length === 0) return 0;
    const sorted = [...scores].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  exponentialSmoothing(scores, alpha) {
    if (scores.length === 0) return 0;
    
    // Exponential smoothing: S_t = alpha * X_t + (1 - alpha) * S_{t-1}
    // Start with the first value, then smooth forward through all historical data
    let smoothed = scores[0];
    
    for (let i = 1; i < scores.length; i++) {
      smoothed = alpha * scores[i] + (1 - alpha) * smoothed;
    }
    
    return smoothed;
  }

  // Generate config hash for cache invalidation
  _getConfigHash(config) {
    const overridesStr = JSON.stringify(config.scoreOverrides || {});
    return `${config.algorithm}_${overridesStr}`;
  }

  // Find best deck combination (optimized for repeated calls)
  findBestDeck(config) {
    console.log('🧮 Starting deck optimization...');
    console.log('  Algorithm:', config.algorithm);
    console.log('  Score overrides:', Object.keys(config.scoreOverrides || {}).length);
    
    const targetStars = config.targetStars || 19;
    const targetCount = config.cardCount || 5;
    const configHash = this._getConfigHash(config);
    
    // Check if we can reuse cached sorted cards
    let scoredCards;
    if (this.sortedCardsCache && this.lastConfigHash === configHash && this.cards.length === this.sortedCardsCache.length) {
      console.log('⚡ Using cached sorted cards (config unchanged)');
      scoredCards = this.sortedCardsCache;
    } else {
      // Calculate expected scores for all cards (with caching)
      console.log('📊 Calculating expected scores for all cards...');
      const startTime = performance.now();
      
      scoredCards = this.cards.map(card => {
        // Use heroKey for lookup (primary), fallback to handle/name
        const lookupKey = (card.heroKey || card.handle || card.name).toUpperCase();
        
        // User override (0XMAKESY: 1⭐ → override, 2+⭐ → 0; others: flat override)
        if (config.scoreOverrides && config.scoreOverrides[lookupKey] !== undefined) {
          const overrideScore = config.scoreOverrides[lookupKey];
          const effectiveScore = (lookupKey === '0XMAKESY' && card.stars !== 1) ? 0 : overrideScore;
          if (FantasyDeckBuilder.DEBUG) {
            console.log(`  🎯 ${card.handle || card.name}: Override = ${overrideScore}, effective = ${effectiveScore} (${card.stars}⭐)`);
          }
          return {
            ...card,
            expectedScore: effectiveScore,
            expectedScorePerStar: card.stars > 0 ? effectiveScore / card.stars : 0
          };
        }
        
        // No override (or user removed Makesy): score from history like any other hero
        let score;
        {
          // Check score cache
          const cacheKey = `${lookupKey}_${config.algorithm}`;
          score = this.scoreCache.get(cacheKey);
          
          if (score === undefined) {
            // Calculate and cache
            score = this.calculateScore(lookupKey, config.algorithm, false);
            this.scoreCache.set(cacheKey, score);
          }
        }
        
        if (score === null || !card.stars || card.stars === 0) {
          return null;
        }
        
        const scoreperstar = score / card.stars;
        
        return {
          ...card,
          expectedScore: score,
          expectedScorePerStar: scoreperstar
        };
      }).filter(card => card !== null && card.expectedScore >= 0 && card.stars > 0); // Include cards with score 0 (they have history), but must have stars
      
      // Sort by expected score per star (highest first)
      scoredCards.sort((a, b) => b.expectedScorePerStar - a.expectedScorePerStar);
      
      // Debug: log card stars distribution
      if (FantasyDeckBuilder.DEBUG) {
        const starCounts = {};
        scoredCards.forEach(card => {
          starCounts[card.stars] = (starCounts[card.stars] || 0) + 1;
        });
        console.log('📊 Card stars distribution:', starCounts);
      }
      
      // Cache sorted cards
      this.sortedCardsCache = scoredCards;
      this.lastConfigHash = configHash;
      
      const calcTime = performance.now() - startTime;
      if (FantasyDeckBuilder.DEBUG) {
        console.log(`⚡ Score calculation took ${calcTime.toFixed(1)}ms`);
      }
    }
    
    console.log(`✅ ${scoredCards.length} cards with valid scores`);
    
    if (scoredCards.length === 0) {
      console.error('❌ No cards with valid scores available');
      return null;
    }
    
    // Prune: Keep top N cards by score per star in each star bucket (wider = better optimality)
    const cardsByStarBucket = new Map();
    scoredCards.forEach(card => {
      const star = card.stars;
      if (!cardsByStarBucket.has(star)) {
        cardsByStarBucket.set(star, []);
      }
      cardsByStarBucket.get(star).push(card);
    });
    
    const TOP_PER_BUCKET = 5;
    const prunedCards = [];
    cardsByStarBucket.forEach((cards, star) => {
      const topCards = cards.slice(0, TOP_PER_BUCKET);
      prunedCards.push(...topCards);
      if (FantasyDeckBuilder.DEBUG) {
        console.log(`  ${star}⭐ bucket: ${cards.length} cards → keeping top ${topCards.length}`);
      }
    });
    
    // Re-sort pruned cards by expected score per star
    prunedCards.sort((a, b) => b.expectedScorePerStar - a.expectedScorePerStar);
    
    console.log(`✂️ Pruned to ${prunedCards.length} cards (top ${TOP_PER_BUCKET} per star bucket from ${scoredCards.length} total)`);
    
    if (FantasyDeckBuilder.DEBUG) {
      console.log('📈 Top 10 pruned cards by expected score per star:');
      prunedCards.slice(0, 10).forEach((card, i) => {
        console.log(`  ${i + 1}. ${card.name} (${card.stars}⭐) = ${card.expectedScorePerStar.toFixed(1)} per star`);
      });
    }

    // Use dynamic programming to find best combination
    console.log(`🔍 Finding best ${targetCount}-card combination totaling ${targetStars}⭐...`);
    const result = this.findOptimalCombination(prunedCards, targetStars, targetCount);
    
    return result;
  }

  // Save calculated scores for popup UI
  async saveCalculatedScores(config) {
    const calculatedScores = {};
    
    for (const [name, historicalScores] of Object.entries(this.historicalData)) {
      const score = this.calculateScore(name, config.algorithm, false);
      if (score !== null) {
        calculatedScores[name] = {
          score,
          handle: name,
          name: name
        };
      }
    }
    
    await chrome.storage.local.set({ lastCalculatedScores: calculatedScores });
    return Object.keys(calculatedScores).length;
  }

  // DP: maximize total expected score over 5-card combinations that sum to exactly targetStars
  // Input cards is already pruned (top 5 per star bucket); we consider all of them.
  findOptimalCombination(cards, targetStars, targetCount) {
    const startTime = performance.now();
    console.log(`🎯 DP Search: ${targetCount} cards, ${targetStars}⭐ target from ${cards.length} options (maximizing expected score)`);

    const sortedStarsFromIndex = [];
    for (let i = 0; i < cards.length; i++) {
      const stars = cards.slice(i).map(c => c.stars).sort((a, b) => a - b);
      sortedStarsFromIndex.push(stars);
    }

    const memo = new Map();
    let memoHits = 0;
    let memoMisses = 0;

    // Returns { selection: card[], totalScore: number } or null; we maximize totalScore
    const solve = (index, remainingStars, remainingCards) => {
      if (remainingCards === 0 && remainingStars === 0) {
        return { selection: [], totalScore: 0 };
      }
      if (remainingCards === 0 || index >= cards.length || remainingStars < 0) {
        return null;
      }

      const sorted = sortedStarsFromIndex[index];
      const k = remainingCards;
      if (k > sorted.length) return null;
      const minPossible = sorted.slice(0, k).reduce((a, b) => a + b, 0);
      const maxPossible = sorted.slice(-k).reduce((a, b) => a + b, 0);
      if (remainingStars < minPossible || remainingStars > maxPossible) return null;

      const key = `${index},${remainingStars},${remainingCards}`;
      if (memo.has(key)) {
        memoHits++;
        return memo.get(key);
      }
      memoMisses++;

      const card = cards[index];
      let best = null;

      if (card.stars <= remainingStars && card.cardId) {
        const sub = solve(index + 1, remainingStars - card.stars, remainingCards - 1);
        if (sub) {
          const totalScore = (card.expectedScore ?? 0) + sub.totalScore;
          best = { selection: [card, ...sub.selection], totalScore };
        }
      }

      const skip = solve(index + 1, remainingStars, remainingCards);
      if (skip && (!best || skip.totalScore > best.totalScore)) {
        best = skip;
      }

      memo.set(key, best);
      return best;
    };

    let bestResult = solve(0, targetStars, targetCount);
    let result = bestResult ? bestResult.selection : null;

    if (!result) {
      console.log('⚠️ No exact combination found, trying under target...');
      for (let adjustment = 1; adjustment <= 2; adjustment++) {
        const adjustedTarget = targetStars - adjustment;
        if (adjustedTarget < 0) break;
        const under = solve(0, adjustedTarget, targetCount);
        if (under) {
          result = under.selection;
          const actualStars = result.reduce((sum, c) => sum + c.stars, 0);
          console.log(`✓ Best under target: ${actualStars}⭐ (expected score: ${under.totalScore.toFixed(0)})`);
          break;
        }
      }
    }

    if (result) {
      const actualStars = result.reduce((sum, c) => sum + c.stars, 0);
      const totalExpected = result.reduce((sum, c) => sum + (c.expectedScore ?? 0), 0);
      if (actualStars > targetStars) {
        console.error(`❌ Result exceeds hard cap! ${actualStars}⭐ > ${targetStars}⭐ - rejecting`);
        result = null;
      } else if (FantasyDeckBuilder.DEBUG) {
        console.log(`✓ Best deck: ${actualStars}⭐ total expected score ${totalExpected.toFixed(0)}`);
      }
    }

    const dpTime = performance.now() - startTime;
    if (FantasyDeckBuilder.DEBUG) {
      console.log(`⚡ DP took ${dpTime.toFixed(1)}ms (memo: ${memoHits} hits, ${memoMisses} misses)`);
    }

    if (!result) {
      console.log('⚠️ Still no match, using greedy by expected score...');
      result = this.findClosestCombination(cards, targetStars, targetCount);
    }

    return result;
  }

  findClosestCombination(cards, targetStars, targetCount) {
    console.log(`🎲 Greedy fallback: pick ${targetCount} cards ≤${targetStars}⭐ maximizing expected score`);
    const selected = [];
    let totalStars = 0;
    const usedCardIds = new Set();
    const consider = Math.min(cards.length, 120);

    for (let slot = 0; slot < targetCount; slot++) {
      const cardsRemaining = targetCount - slot - 1;
      let bestCard = null;
      let bestIndex = -1;
      let bestScore = -1;
      let bestStarDiff = Infinity;

      for (let j = 0; j < consider; j++) {
        const card = cards[j];
        if (card.cardId && usedCardIds.has(card.cardId)) continue;
        const newTotal = totalStars + card.stars;
        if (newTotal > targetStars) continue;

        const starDiff = cardsRemaining === 0 ? Math.abs(targetStars - newTotal) : 0;
        const expectedScore = card.expectedScore ?? 0;
        const isBetter = expectedScore > bestScore || (expectedScore === bestScore && starDiff < bestStarDiff);
        if (isBetter) {
          bestScore = expectedScore;
          bestStarDiff = starDiff;
          bestCard = card;
          bestIndex = j;
        }
      }

      if (bestCard) {
        selected.push(bestCard);
        totalStars += bestCard.stars;
        if (bestCard.cardId) usedCardIds.add(bestCard.cardId);
        console.log(`  ${selected.length}. ${bestCard.name} (${bestCard.stars}⭐) exp=${(bestCard.expectedScore ?? 0).toFixed(0)} [cardId: ${bestCard.cardId}] → ${totalStars}⭐`);
      } else {
        console.warn(`⚠️ No card fits for slot ${slot + 1}`);
        break;
      }
    }

    if (selected.length < targetCount) {
      console.error(`❌ Only found ${selected.length}/${targetCount} cards`);
      return null;
    }
    const totalExpected = selected.reduce((sum, c) => sum + (c.expectedScore ?? 0), 0);
    console.log(`✅ Greedy result: ${totalStars}⭐ (target: ${targetStars}⭐), total expected: ${totalExpected.toFixed(0)}`);
    return selected;
  }

  // Select cards on the page
  async selectCards(cards) {
    console.log('👆 Selecting cards on page...');
    const clickedCardIds = new Set();

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      try {
        if (card.cardId) {
          if (clickedCardIds.has(card.cardId)) {
            console.warn(`  ⚠️ Skipping duplicate cardId: ${card.cardId} (${card.name})`);
            continue;
          }

          let cardElements = Array.from(document.querySelectorAll(`img[alt*="${card.cardId}_"]`));
          let clickableParent = cardElements.length > 0
            ? (cardElements[0].closest('button') || cardElements[0].closest('[role="button"]') || cardElements[0].parentElement)
            : null;

          if (!clickableParent) {
            window.scrollTo(0, document.body.scrollHeight);
            await this.sleep(400);
            cardElements = Array.from(document.querySelectorAll(`img[alt*="${card.cardId}_"]`));
            clickableParent = cardElements.length > 0
              ? (cardElements[0].closest('button') || cardElements[0].closest('[role="button"]') || cardElements[0].parentElement)
              : null;
          }

          if (clickableParent) {
            console.log(`  ${i + 1}. Clicking ${card.name} (${card.stars}⭐) [cardId: ${card.cardId}]...`);
            const rect = clickableParent.getBoundingClientRect();
            const isVisible = rect.top >= 0 && rect.left >= 0 &&
              rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
              rect.right <= (window.innerWidth || document.documentElement.clientWidth);
            if (!isVisible) {
              clickableParent.scrollIntoView({ behavior: 'smooth', block: 'center' });
              await this.sleep(300);
            }
            clickableParent.click();
            clickedCardIds.add(card.cardId);
            await this.sleep(300);
          } else {
            console.error(`  ❌ Could not find card element for ${card.name} (cardId: ${card.cardId})`);
          }
        } else {
          console.warn(`  ⚠️ No cardId found for ${card.name}`);
        }
      } catch (error) {
        console.error(`  ❌ Error selecting ${card.name}:`, error);
      }
    }

    console.log(`✅ Card selection complete (${clickedCardIds.size} unique cards clicked)`);
  }

  async clearDeck() {
    const deckArea = document.querySelector('[class*="deck"]');
    if (!deckArea) {
      console.log('[clearDeck] No deck area found');
      return;
    }
    const cardSelector = '[class*="card"], button, [role="button"]';
    const selectedCards = deckArea.querySelectorAll(cardSelector);
    for (const card of selectedCards) {
      card.click();
      await this.sleep(100);
    }
    console.log(`[clearDeck] Cleared ${selectedCards.length} cards`);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Initialize builder
const builder = new FantasyDeckBuilder();
builder.init();

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'buildDeck') {
    (async () => {
      try {
        console.log('📨 Received buildDeck message from popup');
        const result = await builder.buildDeck(request.config);
        sendResponse(result);
      } catch (error) {
        console.error('❌ Error in buildDeck handler:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
    })();
    
    return true;
  }
  
  if (request.action === 'refreshData') {
    (async () => {
      try {
        console.log('📨 Received refreshData message from popup');
        await builder.scrapeAllHistoricalData();
        sendResponse({
          success: true,
          cardCount: Object.keys(builder.historicalData).length
        });
      } catch (error) {
        console.error('❌ Error in refreshData handler:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
    })();
    
    return true;
  }
  
  if (request.action === 'calculateScores') {
    (async () => {
      try {
        console.log('📨 Received calculateScores message from popup');
        await builder.loadHistoricalData();
        
        // Calculate scores for all heroes
        const heroCount = await builder.saveCalculatedScores(request.config);
        
        sendResponse({
          success: true,
          heroCount: heroCount
        });
      } catch (error) {
        console.error('❌ Error in calculateScores handler:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
    })();
    
    return true;
  }
  
  if (request.action === 'verifyOwnership') {
    (async () => {
      try {
        console.log('📨 Received verifyOwnership message from popup');
        const found = await builder.checkForLukeCard();
        
        if (found) {
          sendResponse({ success: true });
        } else {
          sendResponse({ 
            success: false, 
            error: 'Could not find lukecannon727 card. Make sure you own the card and it\'s visible on the page.' 
          });
        }
      } catch (error) {
        console.error('❌ Error in verifyOwnership handler:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
    })();
    
    return true;
  }
});
