const express = require('express');
const fs = require('fs');
const path = require('path');
const { UnifiedDifyClient, getDifyBlockingResponse, slimPlayers, TraceLogger } = require('../helpers/dify-client');

const router = express.Router();

// Initialize UnifiedDifyClient
const difyClient = new UnifiedDifyClient();

// Cache for schedule data
let scheduleCache = null;

// Team alias mapping for schedule matching
const TEAM_ALIASES = {
  'WAS': 'WSH', 'WSH': 'WAS',
  'JAX': 'JAC', 'JAC': 'JAX',
  'NO': 'NOR', 'NOR': 'NO',
  'SF': 'SFO', 'SFO': 'SF',
  'GB': 'GNB', 'GNB': 'GB',
  'KC': 'KAN', 'KAN': 'KC',
  'TB': 'TAM', 'TAM': 'TB',
  'NE': 'NWE', 'NWE': 'NE',
  'LV': 'LVR', 'LVR': 'LV',
  'LAR': 'LA', 'LA': 'LAR'
};

/**
 * Load and cache schedule data
 */
function loadScheduleData() {
  if (!scheduleCache) {
    try {
      const schedulePath = path.join(__dirname, '..', 'data', 'schedule', 'regularSeason.json');
      const scheduleData = fs.readFileSync(schedulePath, 'utf8');
      scheduleCache = JSON.parse(scheduleData);
    } catch (error) {
      console.error('[ROSTER] Error loading schedule data:', error.message);
      throw error;
    }
  }
  return scheduleCache;
}

/**
 * Find matchup for a team in a specific week
 */
function findMatchupForTeam(weekSchedule, teamAbbr) {
  if (!weekSchedule || !Array.isArray(weekSchedule)) {
    return null;
  }

  // Convert to uppercase for comparison
  const upperTeamAbbr = teamAbbr.toUpperCase();
  
  // Find matchup where team is either home or away (considering aliases)
  return weekSchedule.find(game => {
    const homeTeam = game.homeTeam.toUpperCase();
    const awayTeam = game.awayTeam.toUpperCase();
    
    // Direct match
    if (homeTeam === upperTeamAbbr || awayTeam === upperTeamAbbr) {
      return true;
    }
    
    // Check aliases
    const teamAlias = TEAM_ALIASES[upperTeamAbbr];
    if (teamAlias) {
      return homeTeam === teamAlias || awayTeam === teamAlias;
    }
    
    return false;
  });
}

// GET /allPlayers - Serves the JSON data from data/roster/allPlayers.json
router.get('/allPlayers', async (req, res) => {
  try {
    const filePath = path.join(__dirname, '..', 'data', 'roster', 'allPlayers.json');
    const jsonData = fs.readFileSync(filePath, 'utf8');
    const players = JSON.parse(jsonData);
    
    res.json({
      ok: true,
      data: players
    });
  } catch (error) {
    console.error('[ROSTER] Error reading allPlayers.json:', error.message);
    res.status(500).json({
      ok: false,
      error: `Failed to read roster data: ${error.message}`
    });
  }
});

// GET /:teamName - Returns players for a specific fantasy team
router.get('/:teamName', async (req, res) => {
  try {
    const { teamName } = req.params;
    
    // List of valid team endpoints
    const validTeamEndpoints = [
      "boykies",
      "nothin-but-net",
      "rorys-rowdy-team",
      "whos-your-baddie",
      "elenas-knotty-men",
      "my-njigbas"
    ];
    
    // Validate team name
    if (!validTeamEndpoints.includes(teamName)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid team name',
        message: `Team '${teamName}' not found. Valid teams: ${validTeamEndpoints.join(', ')}`
      });
    }
    
    // Read the allPlayers.json file
    const filePath = path.join(__dirname, '..', 'data', 'roster', 'allPlayers.json');
    const jsonData = fs.readFileSync(filePath, 'utf8');
    const allPlayers = JSON.parse(jsonData);
    
    // Filter players by fantasyTeam.endpoint
    const teamPlayers = allPlayers.filter(player =>
      player.fantasyTeam &&
      player.fantasyTeam.endpoint === teamName
    );
    
    // Return the filtered players
    res.json({
      ok: true,
      data: {
        teamName: teamName,
        players: teamPlayers,
        count: teamPlayers.length
      }
    });
    
  } catch (error) {
    console.error(`[ROSTER] Error getting team roster for ${req.params.teamName}:`, error.message);
    
    // Determine appropriate error status
    let statusCode = 500;
    let errorMessage = 'Failed to retrieve team roster';
    
    if (error.code === 'ENOENT') {
      errorMessage = 'Roster data file not found';
    } else if (error instanceof SyntaxError) {
      errorMessage = 'Invalid roster data format';
    }
    
    res.status(statusCode).json({
      ok: false,
      error: errorMessage,
      details: error.message
    });
  }
});

/**
 * POST /api/roster/analyze - Analyze user and opponent rosters for season projections
 *
 * This endpoint uses the Dify LLM to analyze fantasy football rosters and provide
 * strategic insights. It performs a blocking call to get a comprehensive analysis
 * of both the user's roster and their opponent's roster (if provided).
 *
 * @route POST /api/roster/analyze
 *
 * @param {Object} req.body - The request body
 * @param {string} req.body.user - Unique user identifier (required, non-empty string)
 * @param {Array<Object>} req.body.userRoster - User's roster array (required, 1-16 players)
 * @param {string} req.body.userRoster[].id - Player ID (required)
 * @param {string} req.body.userRoster[].name - Player name (required)
 * @param {string} req.body.userRoster[].pos - Player position (required)
 * @param {string} req.body.userRoster[].team - Player team (required)
 * @param {boolean} [req.body.userRoster[].starter] - Whether player is a starter (optional)
 * @param {number} [req.body.userRoster[].byeWeek] - Player's bye week (optional)
 * @param {Array<Object>} [req.body.opponentRoster] - Opponent's roster array (optional, defaults to [])
 * @param {number} [req.body.week] - Week number for analysis (optional, 1-18)
 *
 * @returns {Object} Response object
 *
 * @example
 * // Success Response (200):
 * {
 *   "ok": true,
 *   "data": {
 *     "userRoster": [
 *       {
 *         "id": "123",
 *         "name": "Patrick Mahomes",
 *         "pos": "QB",
 *         "team": "KC",
 *         "analysis": "Elite QB1 with consistent production..."
 *       }
 *     ],
 *     "opponentRoster": []
 *   },
 *   "summary": "Your roster shows strong potential with Patrick Mahomes leading...",
 *   "meta": {
 *     "model": "sonnet-4",
 *     "response_mode": "blocking",
 *     "received_at": "2024-01-15T10:30:00.000Z",
 *     "request_id": "abc123-def456-ghi789"
 *   }
 * }
 *
 * @example
 * // Validation Error Response (400):
 * {
 *   "ok": false,
 *   "error": "bad_request",
 *   "message": "Validation failed",
 *   "details": [
 *     "user is required and must be a non-empty string",
 *     "userRoster must contain between 1 and 16 players"
 *   ]
 * }
 *
 * @example
 * // Timeout Error Response (504):
 * {
 *   "ok": false,
 *   "error": "timeout",
 *   "message": "Request timed out after 20000ms"
 * }
 *
 * @example
 * // Usage:
 * const response = await fetch('/api/roster/analyze', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     user: 'user123',
 *     userRoster: [
 *       { id: '1', name: 'Patrick Mahomes', pos: 'QB', team: 'KC' },
 *       { id: '2', name: 'Christian McCaffrey', pos: 'RB', team: 'SF' }
 *     ],
 *     week: 10
 *   })
 * });
 */
router.post('/analyze', async (req, res) => {
  const traceId = req.headers['x-trace-id'] || null;
  const logger = new TraceLogger(traceId);
  
  logger.breadcrumb('roster_analyze_start', {
    hasBody: !!req.body,
    bodyKeys: Object.keys(req.body || {})
  });

  try {
    // Validate request body
    const validationErrors = [];
    
    // Check required fields
    if (!req.body) {
      return res.status(400).json({
        ok: false,
        error: 'bad_request',
        message: 'Request body is required'
      });
    }
    
    // Validate user string
    if (!req.body.user || typeof req.body.user !== 'string' || req.body.user.trim() === '') {
      validationErrors.push('user is required and must be a non-empty string');
    }
    
    // Validate userRoster
    if (!Array.isArray(req.body.userRoster)) {
      validationErrors.push('userRoster must be an array');
    } else if (req.body.userRoster.length < 1 || req.body.userRoster.length > 16) {
      validationErrors.push('userRoster must contain between 1 and 16 players');
    } else {
      // Validate each player in userRoster
      req.body.userRoster.forEach((player, index) => {
        if (!player || typeof player !== 'object') {
          validationErrors.push(`userRoster[${index}] must be an object`);
          return;
        }
        
        const requiredFields = ['id', 'name', 'pos', 'team'];
        requiredFields.forEach(field => {
          if (!player[field] || typeof player[field] !== 'string') {
            validationErrors.push(`userRoster[${index}].${field} is required and must be a string`);
          }
        });
      });
    }
    
    // Validate opponentRoster if provided
    if (req.body.opponentRoster !== undefined && req.body.opponentRoster !== null) {
      if (!Array.isArray(req.body.opponentRoster)) {
        validationErrors.push('opponentRoster must be an array if provided');
      } else {
        req.body.opponentRoster.forEach((player, index) => {
          if (!player || typeof player !== 'object') {
            validationErrors.push(`opponentRoster[${index}] must be an object`);
            return;
          }
          
          const requiredFields = ['id', 'name', 'pos', 'team'];
          requiredFields.forEach(field => {
            if (!player[field] || typeof player[field] !== 'string') {
              validationErrors.push(`opponentRoster[${index}].${field} is required and must be a string`);
            }
          });
        });
      }
    }
    
    // Validate week if provided
    if (req.body.week !== undefined && req.body.week !== null) {
      const week = Number(req.body.week);
      if (!Number.isInteger(week) || week < 1 || week > 18) {
        validationErrors.push('week must be an integer between 1 and 18 if provided');
      }
    }
    
    // Return validation errors if any
    if (validationErrors.length > 0) {
      logger.breadcrumb('roster_analyze_validation_failed', {
        errors: validationErrors
      });
      
      return res.status(400).json({
        ok: false,
        error: 'bad_request',
        message: 'Validation failed',
        details: validationErrors
      });
    }
    
    logger.breadcrumb('roster_analyze_validation_passed', {
      userId: req.body.user,
      userRosterCount: req.body.userRoster.length,
      opponentRosterCount: (req.body.opponentRoster || []).length,
      hasWeek: !!req.body.week
    });
    
    // Apply payload optimization
    const slimmedUserRoster = slimPlayers(req.body.userRoster);
    const slimmedOpponentRoster = slimPlayers(req.body.opponentRoster || []);
    
    // Build Dify payload
    const difyPayload = {
      user: req.body.user,
      inputs: {
        action: 'analyze',
        mode: 'season_projection',
        userRoster: slimmedUserRoster,
        opponentRoster: slimmedOpponentRoster
      },
      response_mode: 'blocking'
    };
    
    // Add week if provided
    if (req.body.week) {
      difyPayload.inputs.week = req.body.week;
    }
    
    logger.breadcrumb('roster_analyze_dify_request', {
      payloadSize: JSON.stringify(difyPayload).length,
      inputsKeys: Object.keys(difyPayload.inputs)
    });
    
    // Call Dify API with 20-second timeout
    const difyResponse = await getDifyBlockingResponse({
      action: 'analyze',
      query: `Analyze rosters for season projection`,
      inputs: difyPayload.inputs,
      user: req.body.user,
      conversationId: null,
      timeoutMs: 20000
    });
    
    logger.breadcrumb('roster_analyze_dify_response', {
      ok: difyResponse.ok,
      hasData: !!difyResponse.data,
      status: difyResponse.status
    });
    
    // Handle Dify errors
    if (!difyResponse.ok) {
      const statusCode = difyResponse.status || 502;
      const errorType = statusCode === 504 ? 'timeout' :
                       statusCode === 502 ? 'bad_gateway' :
                       'handler_error';
      
      logger.breadcrumb('roster_analyze_error', {
        statusCode,
        errorType,
        message: difyResponse.message
      });
      
      return res.status(statusCode).json({
        ok: false,
        error: errorType,
        message: difyResponse.message || 'Failed to get response from LLM'
      });
    }
    
    // Parse LLM response
    try {
      const llmResponse = difyResponse.data.answer || '';
      
      // Extract JSON and summary from response
      // Expected format: JSON object followed by summary text
      const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
      let parsedData = { userRoster: [], opponentRoster: [] };
      let summary = '';
      
      if (jsonMatch) {
        try {
          parsedData = JSON.parse(jsonMatch[0]);
          // Extract summary after JSON
          const jsonEndIndex = llmResponse.indexOf(jsonMatch[0]) + jsonMatch[0].length;
          summary = llmResponse.substring(jsonEndIndex).trim();
        } catch (parseError) {
          logger.breadcrumb('roster_analyze_parse_warning', {
            error: parseError.message
          });
          // Fall back to full response as summary
          summary = llmResponse;
        }
      } else {
        // No JSON found, treat entire response as summary
        summary = llmResponse;
      }
      
      // Ensure summary is within expected length (3-6 sentences)
      if (!summary || summary.length < 10) {
        summary = 'Analysis completed successfully. Please review the roster details above.';
      }
      
      logger.breadcrumb('roster_analyze_success', {
        hasUserRoster: Array.isArray(parsedData.userRoster),
        hasOpponentRoster: Array.isArray(parsedData.opponentRoster),
        summaryLength: summary.length
      });
      
      // Return successful response
      return res.status(200).json({
        ok: true,
        data: {
          userRoster: parsedData.userRoster || [],
          opponentRoster: parsedData.opponentRoster || []
        },
        summary: summary,
        meta: {
          model: 'sonnet-4',
          response_mode: 'blocking',
          received_at: new Date().toISOString(),
          request_id: logger.traceId
        }
      });
      
    } catch (parseError) {
      logger.breadcrumb('roster_analyze_parse_error', {
        error: parseError.message
      });
      
      return res.status(500).json({
        ok: false,
        error: 'handler_error',
        message: 'Failed to parse LLM response'
      });
    }
    
  } catch (error) {
    logger.breadcrumb('roster_analyze_exception', {
      error: error.message,
      stack: error.stack
    });
    
    console.error('[ROSTER] Analyze endpoint error:', error);
    
    return res.status(500).json({
      ok: false,
      error: 'handler_error',
      message: error.message || 'Internal server error'
    });
  }
});

// GET /:teamName/matchups/:weekNumber - Returns players with matchup info for a specific week
router.get('/:teamName/matchups/:weekNumber', async (req, res) => {
  try {
    const { teamName, weekNumber } = req.params;
    const week = parseInt(weekNumber, 10);
    
    // Validate weekNumber
    if (!weekNumber || isNaN(week) || week < 1 || week > 18) {
      return res.status(400).json({
        ok: false,
        error: 'bad_request',
        message: 'weekNumber must be 1-18'
      });
    }
    
    // Validate teamName
    if (!teamName || teamName.trim() === '') {
      return res.status(400).json({
        ok: false,
        error: 'bad_request',
        message: 'teamName is required'
      });
    }
    
    // Read allPlayers.json
    const playersPath = path.join(__dirname, '..', 'data', 'roster', 'allPlayers.json');
    const playersData = fs.readFileSync(playersPath, 'utf8');
    const allPlayers = JSON.parse(playersData);
    
    // Filter players by team
    const teamPlayers = allPlayers.filter(player =>
      player.fantasyTeam &&
      player.fantasyTeam.endpoint === teamName
    );
    
    // Check if any players found
    if (teamPlayers.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'not_found',
        message: 'roster not found'
      });
    }
    
    // Load schedule data
    let schedule;
    try {
      schedule = loadScheduleData();
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'handler_error',
        message: 'Failed to load schedule data'
      });
    }
    
    // Get week schedule
    const weekKey = `week${week}`;
    const weekSchedule = schedule[weekKey];
    
    if (!weekSchedule) {
      return res.status(404).json({
        ok: false,
        error: 'not_found',
        message: 'schedule for week not found'
      });
    }
    
    // Clone players and add matchup info
    const playersWithMatchups = teamPlayers.map(player => {
      // Clone player to avoid mutating original data
      const playerWithMatchup = { ...player };
      
      // Get player's team abbreviation
      const playerTeamAbbr = player.team && player.team.abbr ? player.team.abbr : '';
      
      if (!playerTeamAbbr) {
        // No team info, assume bye week
        playerWithMatchup.matchup = {
          week: week,
          bye: true
        };
      } else {
        // Find matchup for player's team
        const matchup = findMatchupForTeam(weekSchedule, playerTeamAbbr);
        
        if (matchup) {
          // Found matchup
          playerWithMatchup.matchup = {
            week: matchup.week,
            homeTeam: matchup.homeTeam,
            awayTeam: matchup.awayTeam,
            kickoff: matchup.kickoff,
            projectedScore: matchup.projectedScore,
            finalScore: matchup.finalScore
          };
        } else {
          // No matchup found, it's a bye week
          playerWithMatchup.matchup = {
            week: week,
            bye: true
          };
        }
      }
      
      return playerWithMatchup;
    });
    
    // Return players with matchups
    res.json(playersWithMatchups);
    
  } catch (error) {
    console.error(`[ROSTER] Error in matchups endpoint:`, error.message);
    
    // Handle specific errors
    if (error.code === 'ENOENT') {
      return res.status(500).json({
        ok: false,
        error: 'handler_error',
        message: 'Required data files not found'
      });
    } else if (error instanceof SyntaxError) {
      return res.status(500).json({
        ok: false,
        error: 'handler_error',
        message: 'Invalid data format in files'
      });
    }
    
    // Generic error
    res.status(500).json({
      ok: false,
      error: 'handler_error',
      message: 'Internal server error'
    });
  }
});

module.exports = router;