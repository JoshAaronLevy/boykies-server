const fs = require('fs');

// Read the two files
const draftRosterV1 = JSON.parse(fs.readFileSync('./data/finalized/draftRoster_v1.json', 'utf8'));
const newOrder = JSON.parse(fs.readFileSync('./data/finalized/newOrder.json', 'utf8'));

console.log(`DraftRoster v1 has ${draftRosterV1.length} players`);
console.log(`NewOrder has ${newOrder.length} players`);

// Create a map of players from draftRoster_v1 by name for quick lookup
const playerMap = new Map();
draftRosterV1.forEach(player => {
    playerMap.set(player.name, player);
});

const draftRosterV2 = [];
const unmatchedPlayers = [];

// Process players in the order specified by newOrder.json
newOrder.forEach(orderItem => {
    const existingPlayer = playerMap.get(orderItem.name);
    
    if (existingPlayer) {
        // Create new player object with updated ranks and expectedRound field
        const updatedPlayer = {
            ...existingPlayer,
            newOverallRank: orderItem.newOverallRank,
            previousOverallRank: existingPlayer.previousOverallRank,
            newPositionRank: orderItem.newPositionRank,
            previousPositionRank: existingPlayer.previousPositionRank,
            expectedRound: orderItem['expected round'], // Note the space in the key name
            reason: existingPlayer.reason,
            // Include all other fields as they were
            yearsPro: existingPlayer.yearsPro,
            newTeam: existingPlayer.newTeam,
            competitionLevel: existingPlayer.competitionLevel,
            byeWeek: existingPlayer.byeWeek,
            role: existingPlayer.role,
            aiNotes: existingPlayer.aiNotes,
            attributes: existingPlayer.attributes,
            riskScore: existingPlayer.riskScore,
            stats: existingPlayer.stats
        };
        
        // Ensure field order is correct by reconstructing the object
        const orderedPlayer = {
            id: existingPlayer.id,
            name: existingPlayer.name,
            position: existingPlayer.position,
            teamAbbr: existingPlayer.teamAbbr,
            newOverallRank: orderItem.newOverallRank,
            previousOverallRank: existingPlayer.previousOverallRank,
            newPositionRank: orderItem.newPositionRank,
            previousPositionRank: existingPlayer.previousPositionRank,
            expectedRound: orderItem['expected round'],
            reason: existingPlayer.reason,
            yearsPro: existingPlayer.yearsPro,
            newTeam: existingPlayer.newTeam,
            competitionLevel: existingPlayer.competitionLevel,
            byeWeek: existingPlayer.byeWeek,
            role: existingPlayer.role,
            aiNotes: existingPlayer.aiNotes,
            attributes: existingPlayer.attributes,
            riskScore: existingPlayer.riskScore,
            stats: existingPlayer.stats
        };
        
        draftRosterV2.push(orderedPlayer);
        // Remove from map to track which players were matched
        playerMap.delete(orderItem.name);
    } else {
        unmatchedPlayers.push(orderItem.name);
        console.log(`No match found for: ${orderItem.name}`);
    }
});

// Check if there are any players in draftRoster_v1 that weren't in newOrder
const playersNotInNewOrder = Array.from(playerMap.keys());
if (playersNotInNewOrder.length > 0) {
    console.log('\nPlayers in draftRoster_v1 but not in newOrder:');
    playersNotInNewOrder.forEach(name => console.log(`- ${name}`));
}

// Write the new file
fs.writeFileSync('./data/finalized/draftRoster_v2.json', JSON.stringify(draftRosterV2, null, 2));

console.log(`\nCreated draftRoster_v2.json with ${draftRosterV2.length} players`);
console.log(`Expected 70 players, got ${draftRosterV2.length} players`);

if (unmatchedPlayers.length > 0) {
    console.log('\nUnmatched players from newOrder:');
    unmatchedPlayers.forEach(name => console.log(`- ${name}`));
}

if (playersNotInNewOrder.length > 0) {
    console.log('\nPlayers from draftRoster_v1 not found in newOrder:');
    playersNotInNewOrder.forEach(name => console.log(`- ${name}`));
}