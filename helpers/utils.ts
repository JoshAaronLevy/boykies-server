const fs = require('fs');
const path = require('path');

/**
 * Interface for player data structure
 */
interface Player {
  id: string;
  overallRank: number;
  position: string;
  positionRank: number;
  name: string;
  teamAbbr: string;
  byeWeek: number;
  yearsPro: number;
  newTeam: boolean;
  role: string;
  competitionLevel: string;
  attributes: string[];
  riskScore: number | null;
  stats: any;
}

/**
 * Filters running backs from the draft roster and returns the first 25 players
 * @param players - Array of player objects from draftRosterAnalyzed.json
 * @returns Array of running back players (max 25)
 */
function filterRunningBacks(players: Player[]): Player[] {
  const runningBacks = players
    .filter(player => player.position === "RB")
    .slice(0, 25);
    
  return runningBacks;
}

/**
 * Reads the draft roster data and extracts 25 running backs, saving to a JSON file
 * @param inputFilePath - Path to the draftRosterAnalyzed.json file
 * @param outputFilePath - Path where the running backs JSON will be saved
 */
function extractRunningBacksToFile(
  inputFilePath: string = 'data/draftRosterAnalyzed.json',
  outputFilePath: string = 'data/position/runningBacks.json'
): void {
  try {
    // Read the draft roster data
    const draftRosterData = fs.readFileSync(inputFilePath, 'utf8');
    const players: Player[] = JSON.parse(draftRosterData);
    
    // Filter to get 25 running backs
    const runningBacks = filterRunningBacks(players);
    
    console.log(`Found ${runningBacks.length} running backs out of ${players.length} total players`);
    
    // Ensure the output directory exists
    const outputDir = path.dirname(outputFilePath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Write the running backs to the output file
    fs.writeFileSync(outputFilePath, JSON.stringify(runningBacks, null, 2));
    
    console.log(`Successfully saved ${runningBacks.length} running backs to ${outputFilePath}`);
    
    // Log the names of the running backs for verification
    console.log('Running backs extracted:');
    runningBacks.forEach((rb, index) => {
      console.log(`${index + 1}. ${rb.name} (${rb.teamAbbr}) - Overall Rank: ${rb.overallRank}`);
    });
    
  } catch (error) {
    console.error('Error processing running backs:', error);
    throw error;
  }
}

// Export functions using CommonJS
module.exports = {
  filterRunningBacks,
  extractRunningBacksToFile
};
