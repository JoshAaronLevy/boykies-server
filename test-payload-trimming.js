const { buildDifyMessage, trimAvailablePlayersIfNeeded } = require('./helpers/dify-client');

/**
 * Test the payload trimming functionality
 */
function testPayloadTrimming() {
  console.log('🧪 Testing Payload Trimming Functionality...\n');

  // Test 1: Test the trimming function directly
  console.log('1️⃣ Testing trimAvailablePlayersIfNeeded function...');
  
  // Create a large array of players (250 players, which exceeds the default 200 limit)
  const largePlayers = [];
  for (let i = 1; i <= 250; i++) {
    largePlayers.push({
      name: `Player ${i}`,
      position: i % 4 === 0 ? 'QB' : i % 4 === 1 ? 'RB' : i % 4 === 2 ? 'WR' : 'TE',
      team: `TEAM${i}`,
      overallRank: i
    });
  }

  const testPayload = {
    player: { name: "Test Player", position: "RB", team: "TEST" },
    round: 1,
    pick: 5,
    userRoster: [{ name: "My Player", position: "QB", team: "HOME" }],
    availablePlayers: largePlayers
  };

  console.log(`Original availablePlayers length: ${testPayload.availablePlayers.length}`);
  
  const trimmedPayload = trimAvailablePlayersIfNeeded(testPayload);
  
  console.log(`Trimmed availablePlayers length: ${trimmedPayload.availablePlayers.length}`);
  console.log(`✅ Trimming ${trimmedPayload.availablePlayers.length <= 200 ? 'worked correctly' : 'failed'}`);
  console.log('');

  // Test 2: Test with payload under the limit
  console.log('2️⃣ Testing with payload under limit...');
  
  const smallPayload = {
    player: { name: "Test Player", position: "RB", team: "TEST" },
    round: 1,
    pick: 5,
    userRoster: [{ name: "My Player", position: "QB", team: "HOME" }],
    availablePlayers: largePlayers.slice(0, 50) // Only 50 players
  };

  console.log(`Original small payload length: ${smallPayload.availablePlayers.length}`);
  
  const untrimmedPayload = trimAvailablePlayersIfNeeded(smallPayload);
  
  console.log(`Result length: ${untrimmedPayload.availablePlayers.length}`);
  console.log(`✅ Small payload ${untrimmedPayload.availablePlayers.length === 50 ? 'unchanged correctly' : 'was incorrectly modified'}`);
  console.log('');

  // Test 3: Test buildDifyMessage with user-turn action
  console.log('3️⃣ Testing buildDifyMessage with large payload...');
  
  console.log('Building Dify message with user-turn action...');
  const message = buildDifyMessage('user-turn', testPayload);
  
  console.log('✅ Message built successfully');
  console.log(`Message length: ${message.length} characters`);
  console.log('');

  // Test 4: Test with different MAX_AVAILABLE_PLAYERS value
  console.log('4️⃣ Testing with custom MAX_AVAILABLE_PLAYERS...');
  
  // Temporarily change the environment variable
  const originalMax = process.env.MAX_AVAILABLE_PLAYERS;
  process.env.MAX_AVAILABLE_PLAYERS = '100';
  
  const customTrimmedPayload = trimAvailablePlayersIfNeeded(testPayload);
  
  console.log(`With MAX_AVAILABLE_PLAYERS=100: ${customTrimmedPayload.availablePlayers.length} players`);
  console.log(`✅ Custom limit ${customTrimmedPayload.availablePlayers.length === 100 ? 'worked correctly' : 'failed'}`);
  
  // Restore original value
  process.env.MAX_AVAILABLE_PLAYERS = originalMax;
  console.log('');

  // Test 5: Test edge cases
  console.log('5️⃣ Testing edge cases...');
  
  // Test with null payload
  const nullResult = trimAvailablePlayersIfNeeded(null);
  console.log(`Null payload: ${nullResult === null ? 'handled correctly' : 'failed'}`);
  
  // Test with missing availablePlayers
  const missingPlayersResult = trimAvailablePlayersIfNeeded({ player: "test" });
  console.log(`Missing availablePlayers: ${missingPlayersResult.player === "test" ? 'handled correctly' : 'failed'}`);
  
  // Test with non-array availablePlayers
  const nonArrayResult = trimAvailablePlayersIfNeeded({ availablePlayers: "not an array" });
  console.log(`Non-array availablePlayers: ${nonArrayResult.availablePlayers === "not an array" ? 'handled correctly' : 'failed'}`);
  
  console.log('\n🎉 All payload trimming tests completed!');
}

// Run the test
testPayloadTrimming();