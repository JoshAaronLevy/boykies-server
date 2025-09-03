#!/bin/bash

# Test script for the updated /api/roster/analyze endpoint
# Tests the new schema selection logic and unified roster format

echo "=== Testing updated /api/roster/analyze endpoint ==="
echo

# Test 1: New single-roster format (inputs.roster) - should work
echo "Test 1: New single-roster format (inputs.roster)"
curl -X POST http://localhost:3000/api/roster/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "user": "test-user-123",
    "inputs": {
      "roster": [
        {
          "name": "Patrick Mahomes",
          "pos": "QB",
          "team": "KC"
        },
        {
          "name": "Christian McCaffrey", 
          "position": "RB",
          "team": "SF"
        }
      ]
    },
    "side": "user",
    "requestId": "test-new-format"
  }' | head -n 5
echo -e "\n---\n"

# Test 2: Legacy format - userRoster only - should work
echo "Test 2: Legacy format (inputs.userRoster only)"
curl -X POST http://localhost:3000/api/roster/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "user": "test-user-456",
    "inputs": {
      "userRoster": [
        {
          "name": "Josh Allen",
          "pos": "QB",
          "team": "BUF"
        },
        {
          "name": "Derrick Henry",
          "position": "RB", 
          "team": "BAL"
        }
      ]
    }
  }' | head -n 5
echo -e "\n---\n"

# Test 3: Legacy format - opponentRoster only - should work
echo "Test 3: Legacy format (inputs.opponentRoster only)"
curl -X POST http://localhost:3000/api/roster/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "user": "test-user-789",
    "inputs": {
      "opponentRoster": [
        {
          "name": "Lamar Jackson",
          "pos": "QB",
          "team": "BAL"
        }
      ]
    }
  }' | head -n 5
echo -e "\n---\n"

# Test 4: Invalid - both userRoster and opponentRoster - should return 400
echo "Test 4: Invalid - both userRoster and opponentRoster (should return 400)"
curl -X POST http://localhost:3000/api/roster/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "user": "test-user-error",
    "inputs": {
      "userRoster": [
        {
          "name": "Patrick Mahomes",
          "pos": "QB",
          "team": "KC"
        }
      ],
      "opponentRoster": [
        {
          "name": "Josh Allen",
          "pos": "QB",
          "team": "BUF"
        }
      ]
    }
  }'
echo -e "\n---\n"

# Test 5: Invalid - no rosters - should return 400
echo "Test 5: Invalid - no rosters (should return 400)"
curl -X POST http://localhost:3000/api/roster/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "user": "test-user-empty",
    "inputs": {}
  }'
echo -e "\n---\n"

# Test 6: Invalid - empty rosters - should return 400
echo "Test 6: Invalid - empty rosters (should return 400)"
curl -X POST http://localhost:3000/api/roster/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "user": "test-user-empty",
    "inputs": {
      "roster": [],
      "userRoster": [],
      "opponentRoster": []
    }
  }'
echo -e "\n---\n"

echo "=== Test completed ==="