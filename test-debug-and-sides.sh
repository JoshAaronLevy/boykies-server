#!/bin/bash

# Test script for debug logging and side/requestId handling
echo "=== Testing debug logging and side/requestId handling ==="
echo

# Check if server is in development mode for debug logging
echo "Checking NODE_ENV..."
echo "NODE_ENV: ${NODE_ENV:-'not set'}"
echo

# Test 1: New format with explicit side and requestId
echo "Test 1: New format with side=user and requestId=custom-123"
curl -X POST http://localhost:3000/api/roster/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "user": "test-debug-user",
    "inputs": {
      "roster": [
        {
          "name": "Patrick Mahomes",
          "pos": "QB", 
          "team": "KC"
        }
      ]
    },
    "side": "user",
    "requestId": "custom-123"
  }' --max-time 5 | head -n 2
echo -e "\n---\n"

# Test 2: Legacy userRoster with default side
echo "Test 2: Legacy userRoster (should default to side=user)"
curl -X POST http://localhost:3000/api/roster/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "user": "test-user-default-side",
    "inputs": {
      "userRoster": [
        {
          "name": "Josh Allen",
          "pos": "QB",
          "team": "BUF"
        }
      ]
    },
    "requestId": "user-default-456"
  }' --max-time 5 | head -n 2
echo -e "\n---\n"

# Test 3: Legacy opponentRoster with default side
echo "Test 3: Legacy opponentRoster (should default to side=opponent)"
curl -X POST http://localhost:3000/api/roster/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "user": "test-opponent-default-side",
    "inputs": {
      "opponentRoster": [
        {
          "name": "Lamar Jackson",
          "pos": "QB",
          "team": "BAL"
        }
      ]
    },
    "requestId": "opponent-default-789"
  }' --max-time 5 | head -n 2
echo -e "\n---\n"

# Test 4: No requestId provided (should generate one)
echo "Test 4: No requestId provided (should auto-generate)"
curl -X POST http://localhost:3000/api/roster/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "user": "test-auto-requestid",
    "inputs": {
      "roster": [
        {
          "name": "Christian McCaffrey",
          "pos": "RB",
          "team": "SF"
        }
      ]
    },
    "side": "user"
  }' --max-time 5 | head -n 2
echo -e "\n---\n"

echo "=== Debug logging test completed ==="
echo "Check server logs for debug output like:"
echo '[DEV] roster/analyze: side=user, requestId=custom-123, firstPlayer=Patrick Mahomes, matchupSubset=[{"name":"Patrick Mahomes","team":"KC"}]'