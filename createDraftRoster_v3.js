const fs = require('fs');

// Read the two files
const draftRosterV2 = JSON.parse(fs.readFileSync('./data/finalized/draftRoster_v2.json', 'utf8'));
const newOrder = JSON.parse(fs.readFileSync('./data/finalized/newOrder.json', 'utf8'));

console.log(`DraftRoster v2 has ${draftRosterV2.length} players`);
console.log(`NewOrder has ${newOrder.length} players`);

// Create a map of team info from newOrder by name for quick lookup
const teamMap = new Map();
newOrder.forEach(orderItem => {
    if (orderItem.team) {
        teamMap.set(orderItem.name, orderItem.team);
    }
});

const draftRosterV3 = [];
const unmatchedPlayers = [];

// Process each player in draftRoster_v2
draftRosterV2.forEach(player => {
    const teamInfo = teamMap.get(player.name);
    
    if (teamInfo) {
        // Create new player object with team object replacing teamAbbr
        const updatedPlayer = {
            id: player.id,
            name: player.name,
            position: player.position,
            team: teamInfo, // Replace teamAbbr with team object
            newOverallRank: player.newOverallRank,
            previousOverallRank: player.previousOverallRank,
            newPositionRank: player.newPositionRank,
            previousPositionRank: player.previousPositionRank,
            expectedRound: player.expectedRound,
            reason: player.reason,
            yearsPro: player.yearsPro,
            newTeam: player.newTeam,
            competitionLevel: player.competitionLevel,
            byeWeek: player.byeWeek,
            role: player.role,
            aiNotes: player.aiNotes,
            attributes: player.attributes,
            riskScore: player.riskScore,
            stats: player.stats
        };
        
        draftRosterV3.push(updatedPlayer);
    } else {
        unmatchedPlayers.push(player.name);
        console.log(`No team info found for: ${player.name}`);
        
        // Still add the player but keep the original teamAbbr as fallback
        const playerWithFallback = {
            id: player.id,
            name: player.name,
            position: player.position,
            teamAbbr: player.teamAbbr, // Keep original field as fallback
            newOverallRank: player.newOverallRank,
            previousOverallRank: player.previousOverallRank,
            newPositionRank: player.newPositionRank,
            previousPositionRank: player.previousPositionRank,
            expectedRound: player.expectedRound,
            reason: player.reason,
            yearsPro: player.yearsPro,
            newTeam: player.newTeam,
            competitionLevel: player.competitionLevel,
            byeWeek: player.byeWeek,
            role: player.role,
            aiNotes: player.aiNotes,
            attributes: player.attributes,
            riskScore: player.riskScore,
            stats: player.stats
        };
        
        draftRosterV3.push(playerWithFallback);
    }
});

// Write the new file
fs.writeFileSync('./data/finalized/draftRoster_v3.json', JSON.stringify(draftRosterV3, null, 2));

console.log(`\nCreated draftRoster_v3.json with ${draftRosterV3.length} players`);
console.log(`Expected 70 players, got ${draftRosterV3.length} players`);

if (unmatchedPlayers.length > 0) {
    console.log('\nPlayers without team info in newOrder:');
    unmatchedPlayers.forEach(name => console.log(`- ${name}`));
} else {
    console.log('\nAll players successfully matched with team info!');
}

console.log('\nSuccessfully replaced teamAbbr field with team objects containing abbr and logoUrl.');