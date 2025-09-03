#!/bin/bash

# Test script for the updated /api/roster/analyze endpoint
# This tests all the new flexible validation and normalization features

echo "Testing updated /api/roster/analyze endpoint..."

# Create test payload with mixed formats to test relaxed validation
curl -X POST http://localhost:3000/api/roster/analyze \
  -H "Content-Type: application/json" \
  -H "x-trace-id: test-roster-analyze-$(date +%s)" \
  -d '{
    "user": "test-user-123",
    "userRoster": [
      {
        "name": "Patrick Mahomes",
        "pos": "QB",
        "team": "KC"
      },
      {
        "name": "Christian McCaffrey", 
        "position": "RB",
        "team": {
          "abbr": "SF"
        }
      },
      {
        "name": "Tyreek Hill",
        "pos": "WR", 
        "team": "MIA"
      },
      {
        "id": "existing-id-123",
        "name": "Travis Kelce",
        "position": "TE",
        "team": {
          "abbr": "KC", 
          "name": "Kansas City Chiefs"
        }
      }
    ],
    "opponentRoster": [
      {
        "name": "Josh Allen",
        "pos": "QB",
        "team": "BUF"
      },
      {
        "name": "Derrick Henry",
        "position": "RB", 
        "team": {
          "abbr": "BAL"
        }
      }
    ],
    "week": 10
  }' \
  --verbose