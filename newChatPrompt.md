You are helping me build a custom AI-powered real-time fantasy football draft assistant. My end goal is to generate, in batches, highly accurate and consistently structured stat objects for the top 300 ESPN fantasy football players (includes Defense/Special Teams). I will ultimately use your data in a tool to assist with real-time draft picks, comparison, and strategic fantasy decision-making.

### INPUT:
I provide you with a JSON array (or a list) of player records, each specifying at minimum:
- `player name`
- `team abbreviation` (NFL team, e.g. "SF")
- `overallRank` (ESPN draft rank, 1–300)
- `position` (e.g., "RB", "WR", "QB", "TE", "DEF")
- `positionRank` (e.g., WR1)

### OUTPUT:
For each player input, generate a full JSON object (as part of an array for the batch) with the following fields—using the data structure, approach, and methodologies from the following example. Your output must match this schema exactly, with no omissions or data field changes. Populate all fields.

#### For each player, include:

- `id` (copy of overallRank, as a string)
- `overallRank`
- `position`
- `positionRank`
- `name`
- `teamAbbr`
- `byeWeek` (current year, standard NFL schedule)
- `yearsPro` (as of 2025 season start—can estimate if needed)
- `newTeam` (true/false: is player on a different team in 2025 than 2024?)
- `role` (see calculation logic below)
- `competitionLevel` (see calculation logic below)
- `attributes` (array; any notable skill tags or none if not applicable)
- `riskScore` (if no reliable source, set null)
- `stats` (object—see below)

##### The `stats` object must contain:
- `2025`: `predicted` (totals for relevant position: games played/started, rushing, receiving, passing, etc. All best-estimate real stat categories for their role. For D/ST, supply categories like sacks, INTs, etc. Use realistic projections based on trends and context.)
- `2024`: `actual` (actual season totals in all same fields)
- `2023`: `actual` (actual season totals in all same fields)

Only use regular season totals. Use best available professional and league-level sources for actual data, and sound projection principles for 2025.

### SPECIAL FIELD CALCULATION DETAILS:

#### `role`:
Assign based on position, public usage, and actual in-game function. Use these archetypes (pick the closest fit for each player):
- QB: ["Dual-Threat QB", "Pocket Passer", "Game Manager", "Franchise QB", etc.]
- RB: ["Workhorse RB", "Dual-Threat RB", "Committee RB", "Short-Yardage RB", "Explosive RB"]
- WR: ["Alpha X", "Perimeter WR", "Slot WR", "Vertical Threat", "Possession WR"]
- TE: ["Move TE", "Y-TE", "Blocker", etc.]
- D/ST: ["Elite D/ST", "Aggressive D/ST", "Balanced D/ST", "Turnover D/ST", etc.]

Assess based on volume, role statements from major analysts (ESPN, NFL.com, The Athletic), and prior year usage data (snap %, route %, situational usage).

#### `competitionLevel`:
Assign using your best judgment of how crowded the player's depth chart and role competition is:
- "Low": Minimal direct positional competition; clear starter/lead.
- "Medium": Strong but not overwhelming competition; probable leader but not locked in.
- "High": Routinely rotates/shares with others; ambiguous or committee role.
Base this on publicly available team depth charts, recent transactions, and trends.

#### `riskScore`:
Set to `null` unless a reputable site has a published risk metric.

#### `attributes`: 
Notable skill tags (e.g., ["Elite Speed"], ["Great Hands", "Red Zone Threat"]), otherwise empty.

***

### JSON OUTPUT STRUCTURE AND SAMPLE PLAYER

Below is a sample player object for a player who is not a kicker or defense/special teams unit. Please check and ensure structure and consistency (use the values as a template, not as actual stats you calculate):

```json
{
  "id": "2",
  "overallRank": 2,
  "position": "RB",
  "positionRank": 1,
  "name": "Bijan Robinson",
  "teamAbbr": "ATL",
  "byeWeek": 5,
  "yearsPro": 1,
  "newTeam": false,
  "role": "Dual-Threat RB",
  "competitionLevel": "Low",
  "attributes": [],
  "riskScore": null,
  "stats": {
    "2025": {
      "predicted": {
        "gamesPlayed": 17,
        "gamesStarted": 17,
        "rushing": {
          "yards": 1295,
          "touchdowns": 10,
          "attempts": 262,
          "firstDowns": 74,
          "40PlusTDs": 2,
          "50PlusTDs": 1,
          "200PlusGames": 1
        },
        "receiving": {
          "receptions": 67,
          "yards": 526,
          "touchdowns": 3,
          "targets": 80,
          "firstDowns": 31,
          "40PlusTDs": 1,
          "50PlusTDs": 0,
          "200PlusGames": 0
        },
        "passing": {
          "yards": 0,
          "touchdowns": 0,
          "interceptions": 0,
          "completions": 0,
          "attempts": 0,
          "firstDowns": 0,
          "40PlusTDs": 0,
          "50PlusTDs": 0,
          "400PlusGames": 0
        },
        "boomBust": {
          "boomGames": null,
          "bustGames": null
        }
      }
    },
    "2024": {
      "actual": {
        "gamesPlayed": 17,
        "gamesStarted": 17,
        "rushing": {
          "yards": 1161,
          "touchdowns": 8,
          "attempts": 214,
          "firstDowns": 61,
          "40PlusTDs": 1,
          "50PlusTDs": 0,
          "200PlusGames": 0
        },
        "receiving": {
          "receptions": 58,
          "yards": 487,
          "touchdowns": 2,
          "targets": 74,
          "firstDowns": 24,
          "40PlusTDs": 1,
          "50PlusTDs": 0,
          "200PlusGames": 0
        },
        "passing": {
          "yards": 0,
          "touchdowns": 0,
          "interceptions": 0,
          "completions": 0,
          "attempts": 0,
          "firstDowns": 0,
          "40PlusTDs": 0,
          "50PlusTDs": 0,
          "400PlusGames": 0
        },
        "boomBust": {
          "boomGames": 5,
          "bustGames": 3
        }
      }
    },
    "2023": {
      "actual": {
        "gamesPlayed": 17,
        "gamesStarted": 17,
        "rushing": {
          "yards": 975,
          "touchdowns": 4,
          "attempts": 214,
          "firstDowns": 54,
          "40PlusTDs": 1,
          "50PlusTDs": 0,
          "200PlusGames": 0
        },
        "receiving": {
          "receptions": 37,
          "yards": 294,
          "touchdowns": 2,
          "targets": 49,
          "firstDowns": 15,
          "40PlusTDs": 0,
          "50PlusTDs": 0,
          "200PlusGames": 0
        },
        "passing": {
          "yards": 0,
          "touchdowns": 0,
          "interceptions": 0,
          "completions": 0,
          "attempts": 0,
          "firstDowns": 0,
          "40PlusTDs": 0,
          "50PlusTDs": 0,
          "400PlusGames": 0
        },
        "boomBust": {
          "boomGames": 3,
          "bustGames": 4
        }
      }
    }
  }
}
```

*If the player is a defense/special teams unit (D/ST), calculate the stats based on the following example expected output, and create the object structured like the following example:*

```json
{
  "id": "178",
  "overallRank": 178,
  "position": "DST",
  "positionRank": 10,
  "name": "Bills D/ST",
  "teamAbbr": "BUF",
  "byeWeek": 7,
  "yearsPro": null,
  "newTeam": false,
  "role": "Aggressive D/ST",
  "competitionLevel": "Medium",
  "attributes": ["Strong Pass Rush", "Turnover Creation"],
  "riskScore": null,
  "stats": {
    "2025": {
      "predicted": {
        "gamesPlayed": 17,
        "sacks": 43,
        "interceptions": 14,
        "fumbleRecoveries": 9,
        "defensiveTouchdowns": 2,
        "specialTeamsTouchdowns": 1,
        "safeties": 1,
        "blockedKicksPunts": 2,
        "pointsAllowed": 351,
        "yardsAllowed": 5615,
        "kickReturnTDs": 1,
        "puntReturnTDs": 0,
        "fourthDownStops": null
      }
    },
    "2024": {
      "actual": {
        "gamesPlayed": 17,
        "sacks": 54,
        "interceptions": 15,
        "fumbleRecoveries": 9,
        "defensiveTouchdowns": 3,
        "specialTeamsTouchdowns": 0,
        "safeties": 0,
        "blockedKicksPunts": 2,
        "pointsAllowed": 311,
        "yardsAllowed": 5267,
        "kickReturnTDs": 0,
        "puntReturnTDs": 0,
        "fourthDownStops": null
      }
    },
    "2023": {
      "actual": {
        "gamesPlayed": 17,
        "sacks": 54,
        "interceptions": 18,
        "fumbleRecoveries": 8,
        "defensiveTouchdowns": 2,
        "specialTeamsTouchdowns": 1,
        "safeties": 0,
        "blockedKicksPunts": 1,
        "pointsAllowed": 311,
        "yardsAllowed": 5247,
        "kickReturnTDs": 1,
        "puntReturnTDs": 0,
        "fourthDownStops": null
      }
    }
  }
}
```

*If the player is a kicker, please get stats based on the following example, and structure the data for each kicker the same way:*

```json
{
  "id": "183",
  "overallRank": 183,
  "position": "K",
  "positionRank": 3,
  "name": "Cameron Dicker",
  "teamAbbr": "LAC",
  "byeWeek": 12,
  "yearsPro": 3,
  "newTeam": false,
  "role": "Accurate Kicker",
  "competitionLevel": "Low",
  "attributes": ["Accurate", "Reliable"],
  "riskScore": null,
  "stats": {
    "2025": {
      "predicted": {
        "gamesPlayed": 17,
        "gamesStarted": 17,
        "fieldGoalsMade": 27,
        "fieldGoalsAttempted": 30,
        "fieldGoalPct": 90.0,
        "fgMade_0_19": 1,
        "fgMade_20_29": 7,
        "fgMade_30_39": 9,
        "fgMade_40_49": 7,
        "fgMade_50plus": 3,
        "extraPointsMade": 37,
        "extraPointsAttempted": 38,
        "extraPointPct": 97.4,
        "longestFieldGoal": 53,
        "points": 118
      }
    },
    "2024": {
      "actual": {
        "gamesPlayed": 17,
        "gamesStarted": 17,
        "fieldGoalsMade": 30,
        "fieldGoalsAttempted": 32,
        "fieldGoalPct": 93.8,
        "fgMade_0_19": 1,
        "fgMade_20_29": 8,
        "fgMade_30_39": 10,
        "fgMade_40_49": 8,
        "fgMade_50plus": 3,
        "extraPointsMade": 33,
        "extraPointsAttempted": 34,
        "extraPointPct": 97.1,
        "longestFieldGoal": 53,
        "points": 123
      }
    },
    "2023": {
      "actual": {
        "gamesPlayed": 17,
        "gamesStarted": 17,
        "fieldGoalsMade": 31,
        "fieldGoalsAttempted": 33,
        "fieldGoalPct": 93.9,
        "fgMade_0_19": 1,
        "fgMade_20_29": 9,
        "fgMade_30_39": 9,
        "fgMade_40_49": 9,
        "fgMade_50plus": 3,
        "extraPointsMade": 35,
        "extraPointsAttempted": 36,
        "extraPointPct": 97.2,
        "longestFieldGoal": 55,
        "points": 128
      }
    }
  }
}
```

***

#### Please confirm you understand the instructions and let me know if you need any clarification on anything before we proceed with the first player object with the full, structured object with all derived/calculated fields and consistently applied logic for `role`, `competitionLevel`, and `stats`. After you have confirmed you don't need any further clarification, I will provide you with a single player object to process to test the outcome. If the outcome is not as expected, we will iterate until it is correct, before moving on to where I provide you a batch of players to process.