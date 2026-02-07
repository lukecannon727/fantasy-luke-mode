// Background service worker
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Fantasy.top Deck Builder extension installed');
  const existing = await chrome.storage.local.get(['lastConfig']);
  if (!existing.lastConfig) {
    chrome.storage.local.set({
      lastConfig: {
        algorithm: 'exponentialSmoothing',
        scoreOverrides: {}
      }
    });
  }
});

// Score calculation functions (moved from content.js)
function averageScore(scores) {
  if (scores.length === 0) return 0;
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

function averageExcludingOutliers(scores, excludeCount) {
  if (scores.length === 0) return 0;
  const sorted = [...scores].sort((a, b) => b - a); // Descending
  const trimmed = sorted.slice(excludeCount); // Remove top N outliers
  if (trimmed.length === 0) return 0;
  return trimmed.reduce((sum, s) => sum + s, 0) / trimmed.length;
}

function weightedScore(scores) {
  if (scores.length === 0) return 0;
  const weights = [0.3, 0.2, 0.175, 0.15, 0.125, 0.05];
  let weightedSum = 0;
  let totalWeight = 0;
  
  for (let i = 0; i < Math.min(scores.length, 5); i++) {
    weightedSum += scores[i] * weights[i];
    totalWeight += weights[i];
  }
  
  return weightedSum / totalWeight;
}

function consistencyFloor(scores) {
  if (scores.length === 0) return 0;
  return Math.min(...scores);
}

function consistencyMedian(scores) {
  if (scores.length === 0) return 0;
  const sorted = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function calculateScore(historicalScores, algorithm) {
  if (!historicalScores || historicalScores.length === 0) {
    return 0;
  }

  switch (algorithm) {
    case 'recent6weeks':
      return averageScore(historicalScores.slice(0, 6));
    
    case 'recent4weeks':
      return averageScore(historicalScores.slice(0, 4));
    
    case 'recent6exclude1':
      return averageExcludingOutliers(historicalScores.slice(0, 6), 1);
    
    case 'recent4exclude1':
      return averageExcludingOutliers(historicalScores.slice(0, 4), 1);
    
    case 'weighted':
      return weightedScore(historicalScores);
    
    case 'consistencyFloor':
      return consistencyFloor(historicalScores.slice(0, 6));
    
    case 'consistencyMedian':
      return consistencyMedian(historicalScores.slice(0, 6));
    
    case 'exponentialSmoothing':
      return exponentialSmoothing(historicalScores, 0.3);
    
    default:
      return exponentialSmoothing(historicalScores, 0.3);
  }
}

function exponentialSmoothing(scores, alpha) {
  if (scores.length === 0) return 0;
  
  // Exponential smoothing: S_t = alpha * X_t + (1 - alpha) * S_{t-1}
  // Start with the first value, then smooth forward through all historical data
  let smoothed = scores[0];
  
  for (let i = 1; i < scores.length; i++) {
    smoothed = alpha * scores[i] + (1 - alpha) * smoothed;
  }
  
  return smoothed;
}

// Calculate and save scores (works from anywhere)
async function calculateAllScores(algorithm) {
  console.log('📊 Calculating scores with algorithm:', algorithm);
  
  const result = await chrome.storage.local.get(['historicalDataCache']);
  if (!result.historicalDataCache) {
    throw new Error('No historical data available. Please refresh data first.');
  }
  
  const historicalData = result.historicalDataCache;
  const calculatedScores = {};
  
  for (const [heroKey, historicalScores] of Object.entries(historicalData)) {
    const score = calculateScore(historicalScores, algorithm);
    if (score !== null) {
      calculatedScores[heroKey] = {
        score,
        handle: heroKey,
        name: heroKey
      };
    }
  }
  
  await chrome.storage.local.set({ lastCalculatedScores: calculatedScores });
  console.log(`💾 Calculated scores for ${Object.keys(calculatedScores).length} heroes`);
  return Object.keys(calculatedScores).length;
}

// Helper function to parse CSV line (handles quoted fields)
function parseCSVLine(line) {
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

// Scrape historical data from Google Sheets (can work from anywhere)
async function scrapeAllHistoricalData() {
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
    
    // Headers are on line 2 (index 1)
    const headers = parseCSVLine(lines[1]);
    console.log(`📋 Found ${headers.length} header columns`);
    
    // Define columns
    const nameCol = 4;  // Column E (0-indexed, so column 5 = index 4)
    const handleCol = 5; // Column F
    const starsCol = 15; // Column P (0-indexed, so column 16 = index 15)
    
    // Find tournament columns (Main 85, Main 84, etc.)
    const tournamentCols = [75, 76, 77, 78, 79, 80];
    
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
      
      const row = parseCSVLine(line);
      
      if (row.length < 20) {
        skippedRows++;
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
        continue;
      }
      
      // Extract tournament scores (most recent first)
      const scores = [];
      for (const colIndex of tournamentCols) {
        const scoreRaw = row[colIndex]?.trim();
        const score = parseInt(scoreRaw);
        if (!isNaN(score) && score >= 0) { // Include 0 scores
          scores.push(score);
        }
      }
      
      if (scores.length > 0) {
        historicalData[heroKey] = scores.slice(0, 8); // Last 8 weeks
        cardData.push({ heroKey, handle, name, stars });
        processedRows++;
      } else {
        skippedRows++;
      }
    }
    
    console.log('');
    console.log('✅ === PARSING COMPLETE ===');
    console.log(`   ✓ ${processedRows} heroes successfully processed`);
    console.log(`   ⏭️ ${skippedRows} rows skipped`);
    console.log(`   📊 Success rate: ${((processedRows / (processedRows + skippedRows)) * 100).toFixed(1)}%`);
    console.log('');
    
    // Save to cache
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

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'refreshData') {
    (async () => {
      try {
        console.log('📨 Received refreshData message from popup');
        const cardCount = await scrapeAllHistoricalData();
        sendResponse({
          success: true,
          cardCount: cardCount
        });
      } catch (error) {
        console.error('❌ Error in refreshData handler:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
    })();
    
    return true; // Indicates we will send a response asynchronously
  }
  
  if (request.action === 'calculateScores') {
    (async () => {
      try {
        console.log('📨 Received calculateScores message from popup');
        const algorithm = request.config?.algorithm || 'exponentialSmoothing';
        const heroCount = await calculateAllScores(algorithm);
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
    
    return true; // Indicates we will send a response asynchronously
  }
});