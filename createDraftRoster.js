const fs = require('fs');
const path = require('path');

// Read the input files
const tempDraftRoster = JSON.parse(fs.readFileSync('./data/finalized/tempDraftRoster.json', 'utf8'));
const overallDraftBoard = JSON.parse(fs.readFileSync('./data/overall_draft_board.json', 'utf8'));

console.log(`Loaded ${tempDraftRoster.length} players from tempDraftRoster.json`);
console.log(`Loaded ${overallDraftBoard.length} players from overall_draft_board.json`);

// Create a map of players from tempDraftRoster for easy lookup
const tempRosterMap = new Map();
tempDraftRoster.forEach(player => {
    const key = `${player.name}|${player.position}`;
    tempRosterMap.set(key, player);
});

// Create the final draft roster array based on overall_draft_board order
const finalDraftRoster = [];
let matchCount = 0;
let unmatchedPlayers = [];

overallDraftBoard.forEach(boardPlayer => {
    const key = `${boardPlayer.name}|${boardPlayer.position}`;
    const tempPlayer = tempRosterMap.get(key);
    
    if (tempPlayer) {
        matchCount++;
        
        // Create a new player object with proper field ordering
        const newPlayer = {};
        
        // Copy all fields in order, inserting reason after previousPositionRank
        Object.keys(tempPlayer).forEach(fieldKey => {
            if (fieldKey === 'id') {
                // Update id to be stringified newOverallRank
                newPlayer.id = boardPlayer.newOverallRank.toString();
            } else if (fieldKey === 'newOverallRank') {
                // Update newOverallRank from board
                newPlayer.newOverallRank = boardPlayer.newOverallRank;
            } else {
                // Copy other fields as-is
                newPlayer[fieldKey] = tempPlayer[fieldKey];
            }
            
            // Insert reason field right after previousPositionRank
            if (fieldKey === 'previousPositionRank') {
                newPlayer.reason = boardPlayer.reason;
            }
        });
        
        finalDraftRoster.push(newPlayer);
    } else {
        unmatchedPlayers.push(`${boardPlayer.name} (${boardPlayer.position})`);
    }
});

console.log(`\nMatching Results:`);
console.log(`Successfully matched: ${matchCount} players`);
console.log(`Unmatched players from overall_draft_board.json: ${unmatchedPlayers.length}`);

if (unmatchedPlayers.length > 0) {
    console.log(`\nUnmatched players:`);
    unmatchedPlayers.forEach(player => console.log(`  - ${player}`));
}

// Ensure output directory exists
const outputDir = './data/finalized';
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Write the final result to draftRoster.json
fs.writeFileSync('./data/finalized/draftRoster.json', JSON.stringify(finalDraftRoster, null, 2));

console.log(`\n✅ Created draft roster with ${finalDraftRoster.length} players`);
console.log(`📁 Saved to: data/finalized/draftRoster.json`);

// Show a sample of the first few players for verification
console.log(`\n📋 Sample of first 3 players:`);
finalDraftRoster.slice(0, 3).forEach((player, index) => {
    console.log(`${index + 1}. ${player.name} (${player.position}) - Rank: ${player.newOverallRank}, ID: ${player.id}`);
    console.log(`   Reason: ${player.reason.substring(0, 60)}...`);
});