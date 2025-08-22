const fs = require('fs');
const path = require('path');

/**
 * Filters running backs from the draft roster and returns the first 25 players
 * @param {Array} players - Array of player objects from draftRosterAnalyzed.json
 * @returns {Array} Array of running back players (max 25)
 */
function filterRunningBacks(players) {
  const runningBacks = players
    .filter(player => player.position === "RB")
    .slice(0, 25);
    
  return runningBacks;
}

/**
 * Filters wide receivers from the draft roster and returns the first 25 players
 * @param {Array} players - Array of player objects from draftRosterAnalyzed.json
 * @returns {Array} Array of wide receiver players (max 25)
 */
function filterWideReceivers(players) {
  const wideReceivers = players
    .filter(player => player.position === "WR")
    .slice(0, 25);
    
  return wideReceivers;
}

/**
 * Filters quarterbacks from the draft roster and returns the first 20 players
 * @param {Array} players - Array of player objects from draftRosterAnalyzed.json
 * @returns {Array} Array of quarterback players (max 20)
 */
function filterQuarterbacks(players) {
  const quarterbacks = players
    .filter(player => player.position === "QB")
    .slice(0, 20);
    
  return quarterbacks;
}

/**
 * Generic function to extract players by position and save to a JSON file
 * @param {string} position - Position to filter for (RB, WR, QB, etc.)
 * @param {number} limit - Maximum number of players to include
 * @param {string} inputFilePath - Path to the draftRosterAnalyzed.json file
 * @param {string} outputFilePath - Path where the filtered players JSON will be saved
 */
function extractPlayersByPosition(
  position,
  limit,
  inputFilePath = 'data/draftRosterAnalyzed.json',
  outputFilePath
) {
  try {
    // Read the draft roster data
    const draftRosterData = fs.readFileSync(inputFilePath, 'utf8');
    const players = JSON.parse(draftRosterData);
    
    // Filter players by position and limit results
    const filteredPlayers = players
      .filter(player => player.position === position)
      .slice(0, limit);
    
    console.log(`Found ${filteredPlayers.length} ${position}s out of ${players.length} total players`);
    
    // Ensure the output directory exists
    const outputDir = path.dirname(outputFilePath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Write the filtered players to the output file
    fs.writeFileSync(outputFilePath, JSON.stringify(filteredPlayers, null, 2));
    
    console.log(`Successfully saved ${filteredPlayers.length} ${position}s to ${outputFilePath}`);
    
    // Log the names of the players for verification
    console.log(`${position}s extracted:`);
    filteredPlayers.forEach((player, index) => {
      console.log(`${index + 1}. ${player.name} (${player.teamAbbr}) - Overall Rank: ${player.overallRank}`);
    });
    
    return filteredPlayers;
    
  } catch (error) {
    console.error(`Error processing ${position}s:`, error);
    throw error;
  }
}

/**
 * Reads the draft roster data and extracts 25 running backs, saving to a JSON file
 * @param {string} inputFilePath - Path to the draftRosterAnalyzed.json file
 * @param {string} outputFilePath - Path where the running backs JSON will be saved
 */
function extractRunningBacksToFile(
  inputFilePath = 'data/draftRosterAnalyzed.json',
  outputFilePath = 'data/position/runningBacks.json'
) {
  return extractPlayersByPosition('RB', 25, inputFilePath, outputFilePath);
}

/**
 * Reads the draft roster data and extracts 25 wide receivers, saving to a JSON file
 * @param {string} inputFilePath - Path to the draftRosterAnalyzed.json file
 * @param {string} outputFilePath - Path where the wide receivers JSON will be saved
 */
function extractWideReceiversToFile(
  inputFilePath = 'data/draftRosterAnalyzed.json',
  outputFilePath = 'data/top25/wideReceivers.json'
) {
  return extractPlayersByPosition('WR', 25, inputFilePath, outputFilePath);
}

/**
 * Reads the draft roster data and extracts 20 quarterbacks, saving to a JSON file
 * @param {string} inputFilePath - Path to the draftRosterAnalyzed.json file
 * @param {string} outputFilePath - Path where the quarterbacks JSON will be saved
 */
function extractQuarterbacksToFile(
  inputFilePath = 'data/draftRosterAnalyzed.json',
  outputFilePath = 'data/top25/quarterbacks.json'
) {
  return extractPlayersByPosition('QB', 20, inputFilePath, outputFilePath);
}

/**
 * Extracts all position groups (RBs, WRs, QBs) and saves them to their respective files
 * @param {string} inputFilePath - Path to the draftRosterAnalyzed.json file
 */
function extractAllPositions(inputFilePath = 'data/draftRosterAnalyzed.json') {
  console.log('Extracting all position groups...\n');
  
  try {
    // Extract running backs to data/position/
    console.log('=== RUNNING BACKS ===');
    extractRunningBacksToFile(inputFilePath);
    
    console.log('\n=== WIDE RECEIVERS ===');
    extractWideReceiversToFile(inputFilePath);
    
    console.log('\n=== QUARTERBACKS ===');
    extractQuarterbacksToFile(inputFilePath);
    
    console.log('\n✅ All position groups extracted successfully!');
    
  } catch (error) {
    console.error('Error extracting position groups:', error);
    throw error;
  }
}

// Export functions using CommonJS
module.exports = {
  filterRunningBacks,
  filterWideReceivers,
  filterQuarterbacks,
  extractPlayersByPosition,
  extractRunningBacksToFile,
  extractWideReceiversToFile,
  extractQuarterbacksToFile,
  extractAllPositions
};