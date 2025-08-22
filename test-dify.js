const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

// Test data
const testData = {
  numTeams: 12,
  userPickPosition: 4,
  players: [
    { name: "Christian McCaffrey", position: "RB", team: "SF" },
    { name: "Tyreek Hill", position: "WR", team: "MIA" },
    { name: "Josh Allen", position: "QB", team: "BUF" }
  ]
};

const testPlayer = {
  name: "Christian McCaffrey",
  position: "RB", 
  team: "SF",
  overallRank: 1
};

async function testDifyIntegration() {
  try {
    console.log('🧪 Testing Dify Integration...\n');

    // Test 1: Initialize draft strategy
    console.log('1️⃣ Testing draft initialization...');
    const initResponse = await axios.post(`${BASE_URL}/draft/initialize`, testData);
    console.log('✅ Initialize endpoint working');
    console.log('📝 Strategy received:', initResponse.data.strategy.substring(0, 100) + '...');
    
    const conversationId = initResponse.data.conversationId;
    console.log('🔗 Conversation ID:', conversationId);
    console.log('');

    // Test 2: Mark player as taken
    console.log('2️⃣ Testing player taken...');
    const takenResponse = await axios.post(`${BASE_URL}/draft/player-taken`, {
      player: testPlayer,
      round: 1,
      pick: 1,
      conversationId: conversationId
    });
    console.log('✅ Player taken endpoint working');
    console.log('📝 Confirmation:', takenResponse.data.confirmation);
    console.log('');

    // Test 3: User turn
    console.log('3️⃣ Testing user turn (this may take up to 90 seconds)...');
    const userTurnResponse = await axios.post(`${BASE_URL}/draft/user-turn`, {
      player: { name: "Tyreek Hill", position: "WR", team: "MIA", overallRank: 2 },
      round: 1,
      pick: 3,
      userRoster: [],
      availablePlayers: [
        { name: "Josh Allen", position: "QB", team: "BUF" },
        { name: "Cooper Kupp", position: "WR", team: "LAR" },
        { name: "Derrick Henry", position: "RB", team: "BAL" }
      ],
      conversationId: conversationId
    });
    console.log('✅ User turn endpoint working');
    console.log('📝 Analysis received:', userTurnResponse.data.analysis.substring(0, 150) + '...');
    
    console.log('\n🎉 All tests passed! Dify integration is working correctly.');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// Run the test
testDifyIntegration();