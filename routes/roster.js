const express = require('express');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { UnifiedDifyClient, getDifyBlockingResponse, slimPlayers, TraceLogger } = require('../helpers/dify-client');

// Check if global fetch is available (Node 18+), otherwise use node-fetch
let fetch, AbortController;
try {
  fetch = globalThis.fetch;
  AbortController = globalThis.AbortController;
} catch (e) {
  // Fallback for older Node versions (though we prefer Node 18+)
  try {
    fetch = require('node-fetch');
    AbortController = require('abort-controller');
  } catch (importError) {
    console.error('[ROSTER] Warning: Neither global fetch nor node-fetch available');
  }
}

// Environment configuration for Dify
const DIFY_API_URL = process.env.DIFY_API_URL || 'https://api.dify.ai/v1/chat-messages';
const DIFY_SECRET_KEY = process.env.DIFY_SECRET_KEY;
const DIFY_TIMEOUT_MS = parseInt(process.env.DIFY_TIMEOUT_MS) || 120000;

/**
 * Simple slug function to create URL-safe strings
 */
function createSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Extract JSON from text that may contain code fences or other formatting
 * Strips ``` fences, tries direct JSON.parse, falls back to first { ... } brace slice
 */
function extractJson(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }
  
  // Strip code fences (```json and ```)
  let cleanText = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
  
  // Try direct JSON.parse first
  try {
    return JSON.parse(cleanText);
  } catch (directParseError) {
    // Fall back to finding first { ... } block
    const braceStart = cleanText.indexOf('{');
    if (braceStart === -1) {
      return null;
    }
    
    let braceCount = 0;
    let braceEnd = -1;
    
    for (let i = braceStart; i < cleanText.length; i++) {
      if (cleanText[i] === '{') {
        braceCount++;
      } else if (cleanText[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          braceEnd = i;
          break;
        }
      }
    }
    
    if (braceEnd === -1) {
      return null;
    }
    
    const jsonSlice = cleanText.slice(braceStart, braceEnd + 1);
    try {
      return JSON.parse(jsonSlice);
    } catch (sliceParseError) {
      return null;
    }
  }
}

/**
 * Normalize upstream response to structured format
 * Returns { userRoster, opponentRoster, summary }
 */
function normalizeSeasonResponse(upstream) {
  let userRoster = [];
  let opponentRoster = [];
  let summary = '';
  
  if (!upstream || !upstream.answer) {
    return { userRoster, opponentRoster, summary };
  }
  
  const llmResponse = upstream.answer;
  
  // Try to extract JSON from the response
  const extractedData = extractJson(llmResponse);
  
  if (extractedData) {
    // Use extracted JSON data
    userRoster = Array.isArray(extractedData.userRoster) ? extractedData.userRoster : [];
    opponentRoster = Array.isArray(extractedData.opponentRoster) ? extractedData.opponentRoster : [];
    
    // Extract summary after JSON or use provided summary
    if (extractedData.summary && typeof extractedData.summary === 'string') {
      summary = extractedData.summary;
    } else {
      // Try to find text after the JSON block
      const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const jsonEndIndex = llmResponse.indexOf(jsonMatch[0]) + jsonMatch[0].length;
        summary = llmResponse.substring(jsonEndIndex).trim();
      }
    }
  }
  
  // If no summary extracted, use the full response as summary
  if (!summary || summary.length < 10) {
    summary = extractedData ? 'Analysis completed successfully. Please review the roster details above.' : llmResponse;
  }
  
  return { userRoster, opponentRoster, summary };
}

/**
 * Normalize player data for Dify API
 * - Ensures id exists (synthesizes if missing)
 * - Normalizes pos/position to pos (uppercase)
 * - Normalizes team to teamAbbr (uppercase string)
 * - Preserves all original fields
 */
function normalizePlayerForDify(player) {
  const normalized = { ...player };
  
  // Extract team abbreviation
  let teamAbbr = '';
  if (typeof player.team === 'string') {
    teamAbbr = player.team.toUpperCase();
  } else if (player.team && typeof player.team === 'object' && player.team.abbr) {
    teamAbbr = player.team.abbr.toUpperCase();
  }
  
  // Normalize position (pos takes precedence, fallback to position, then uppercase)
  const position = (player.pos || player.position || '').toString().toUpperCase();
  normalized.pos = position;
  
  // Synthesize id if missing
  if (!normalized.id && normalized.name) {
    normalized.id = `${createSlug(normalized.name)}:${teamAbbr}`;
  }
  
  // Set normalized team abbreviation
  normalized.teamAbbr = teamAbbr;
  
  return normalized;
}

const router = express.Router();

// Initialize UnifiedDifyClient
const difyClient = new UnifiedDifyClient();

// Cache for schedule data
let scheduleCache = null;

// Cache for NFL teams data
let nflTeamsCache = null;

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
  // Note: LAC has no alias as specified
};

/**
 * Load and cache NFL teams data
 */
function loadNflTeams() {
  if (!nflTeamsCache) {
    try {
      const teamsPath = path.join(__dirname, '..', 'data', 'nflTeams.json');
      const teamsData = fs.readFileSync(teamsPath, 'utf8');
      nflTeamsCache = JSON.parse(teamsData);
    } catch (error) {
      console.error('[ROSTER] Error loading NFL teams data:', error.message);
      throw error;
    }
  }
  return nflTeamsCache;
}

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
 * Get week schedule from either object or array format
 */
function getWeekSchedule(schedule, weekNumber) {
  // Handle object format { "week1": [...], "week2": [...] }
  if (schedule && typeof schedule === 'object' && !Array.isArray(schedule)) {
    const weekKey = `week${weekNumber}`;
    return schedule[weekKey] || null;
  }
  
  // Handle array format [week1Games, week2Games, ...]
  if (Array.isArray(schedule)) {
    // Array index 0 = Week 1, index 17 = Week 18
    return schedule[weekNumber - 1] || null;
  }
  
  return null;
}

/**
 * Find team in nflTeams array by abbreviation
 */
function findTeamByAbbr(teams, abbr) {
  if (!teams || !Array.isArray(teams) || !abbr) {
    return null;
  }
  
  const upperAbbr = abbr.toUpperCase();
  
  // Direct match
  let team = teams.find(t => t.abbr && t.abbr.toUpperCase() === upperAbbr);
  if (team) return team;
  
  // Check aliases
  const alias = TEAM_ALIASES[upperAbbr];
  if (alias) {
    team = teams.find(t => t.abbr && t.abbr.toUpperCase() === alias);
    if (team) return team;
  }
  
  return null;
}

/**
 * Find matchup for a team in a specific week with enhanced info
 */
function findMatchupForTeam(weekSchedule, teamAbbr, nflTeams) {
  if (!weekSchedule || !Array.isArray(weekSchedule) || !teamAbbr) {
    return null;
  }

  // Convert to uppercase for comparison
  const upperTeamAbbr = teamAbbr.toUpperCase();
  
  // Find matchup where team is either home or away (considering aliases)
  const game = weekSchedule.find(game => {
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
  
  if (!game) {
    return null;
  }
  
  // Determine if player's team is home or away
  const homeTeam = game.homeTeam.toUpperCase();
  const isHome = homeTeam === upperTeamAbbr || homeTeam === TEAM_ALIASES[upperTeamAbbr];
  const type = isHome ? 'home' : 'away';
  
  // Get opponent abbreviation
  const opponentAbbr = isHome ? game.awayTeam : game.homeTeam;
  
  // Find opponent team object
  let opponent = findTeamByAbbr(nflTeams, opponentAbbr);
  
  // Fallback if opponent not found in nflTeams
  if (!opponent) {
    opponent = { abbr: opponentAbbr };
  }
  
  return {
    week: game.week,
    type: type,
    opponent: opponent,
    kickoff: game.kickoff || '',
    projectedScore: game.projectedScore || '',
    finalScore: game.finalScore || ''
  };
}

/**
 * Schema selection logic for roster analyze endpoint
 * Returns { side, roster, requestId } or { side: null, roster: [] } for invalid input
 */
function selectRosterAndSide(body) {
  const inputs = body?.inputs ?? {};
  const r = Array.isArray(inputs?.roster) ? inputs.roster : null;
  const ur = Array.isArray(inputs?.userRoster) ? inputs.userRoster : null;
  const or = Array.isArray(inputs?.opponentRoster) ? inputs.opponentRoster : null;

  const nonEmpty = [r, ur, or].filter(a => Array.isArray(a) && a.length > 0);
  if (nonEmpty.length !== 1) return { side: null, roster: [] };

  if (r && r.length > 0) {
    return { side: body?.side ?? "user", roster: r, requestId: body?.requestId };
  }
  if (ur && ur.length > 0) {
    return { side: body?.side ?? "user", roster: ur, requestId: body?.requestId };
  }
  if (or && or.length > 0) {
    return { side: body?.side ?? "opponent", roster: or, requestId: body?.requestId };
  }
  return { side: null, roster: [] };
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
 * @param {string|Object} req.body.user - User identifier (string) or user object with id property (required)
 * @param {Array<Object>} req.body.userRoster - User's roster array (required, 1-16 players)
 * @param {string} [req.body.userRoster[].id] - Player ID (optional, will be synthesized if missing)
 * @param {string} req.body.userRoster[].name - Player name (required)
 * @param {string} [req.body.userRoster[].pos] - Player position (required if position not provided)
 * @param {string} [req.body.userRoster[].position] - Player position (required if pos not provided)
 * @param {string|Object} req.body.userRoster[].team - Player team (string or object with abbr property)
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
/**
 * POST /api/roster/analyze - Analyze rosters with unified schema support
 *
 * Accepts both new single-roster format (inputs.roster) and legacy dual-roster format
 * (inputs.userRoster/opponentRoster). Implements exact streaming pattern as draft route.
 */
router.post('/analyze', async (req, res) => {
  const startTime = Date.now();
  
  // Set timeout for the entire request (235s + buffer)
  res.setTimeout(245000);
  
  try {
    // Validate request body structure
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({
        ok: false,
        error: 'bad_request',
        message: 'Request body must be a JSON object'
      });
    }

    // Use helper function to select roster and determine side
    const { side, roster, requestId } = selectRosterAndSide(req.body);
    
    // Validate exactly one non-empty roster was provided
    if (!side || !Array.isArray(roster) || roster.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'bad_request',
        message: 'Provide exactly one non-empty roster in inputs.roster or inputs.userRoster/opponentRoster.'
      });
    }

    // Generate requestId if missing
    const finalRequestId = requestId || randomUUID();

    // Dev-only debug logging
    if (process.env.NODE_ENV === 'development') {
      const firstPlayerName = roster[0]?.name || 'unknown';
      const matchupSubset = roster.slice(0, 3).map(p => ({ name: p.name, team: p.team }));
      console.log(`[DEV] roster/analyze: side=${side}, requestId=${finalRequestId}, firstPlayer=${firstPlayerName}, matchupSubset=${JSON.stringify(matchupSubset)}`);
    }

    const timeoutMs = 235000; // 235s timeout to match draft
    
    // Set NDJSON streaming headers - exact same as draft route
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Set up AbortController for client disconnects and timeout
    const controller = new AbortController();
    let clientAborted = false;
    
    // Safety timeout that persists throughout entire stream lifecycle
    const timeoutId = setTimeout(() => {
      console.log('[STREAMING][roster/analyze] Safety timeout triggered after 235s');
      controller.abort('timeout');
    }, timeoutMs);

    // Handle client abort - Track abort and abort controller
    req.on('aborted', () => {
      clientAborted = true;
      if (!res.writableEnded && !streamCompleted) {
        controller.abort(new Error('client-aborted'));
      }
    });

    try {
      // Build a safe base query (keep any caller-provided text)
      const originalQuery =
        typeof req.body.query === "string" && req.body.query.trim().length
          ? req.body.query
          : "Analyze roster for weekly projections.";

      // Inline a second copy of the inputs so the model cannot miss them even if template vars fail
      const inlineBlock = [
        "### INPUT ECHO (do not ignore) ###",
        `SIDE: ${side ?? ""}`,
        `REQUEST_ID: ${finalRequestId ?? ""}`,
        `WEEK: ${req.body.inputs?.week ?? ""}`,
        "ROSTER_JSON_START",
        JSON.stringify(roster ?? [], null, 0),
        "ROSTER_JSON_END",
      ].join("\n");

      // Build payload for Dify - forward exactly one roster as inputs.roster
      const difyPayload = {
        user: req.body.user || 'anonymous',
        response_mode: 'streaming',
        query: `${originalQuery}\n\n${inlineBlock}`, // <<< only change
        side: side,
        requestId: finalRequestId,
        inputs: {
          ...req.body.inputs,
          roster: roster, // Forward the selected roster
          side: side,
          requestId: finalRequestId
        }
      };

      // Include conversation_id if provided
      if (req.body.conversation_id) {
        difyPayload.conversation_id = req.body.conversation_id;
      }

      // Make streaming call to Dify API directly using fetch like draft
      const response = await fetch(DIFY_API_URL, {
        method: 'POST',
        headers: {
          'Accept': 'text/event-stream',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DIFY_SECRET_KEY}`
        },
        body: JSON.stringify(difyPayload),
        signal: controller.signal,
        duplex: 'half'
      });

      // Preflight check for upstream response
      const status = response.status;
      const contentType = response.headers.get('content-type') || '';

      if (!response.ok || !contentType.includes('text/event-stream')) {
        // Read up to first 200 bytes from response body if present
        let bodyPreview = '';
        try {
          if (response.body) {
            const reader = response.body.getReader();
            const { value } = await reader.read();
            if (value) {
              const decoder = new TextDecoder();
              const fullText = decoder.decode(value);
              bodyPreview = fullText.slice(0, 200); // First 200 chars
            }
          }
        } catch (bodyReadError) {
          bodyPreview = 'Error reading response body';
        }
        
        // Write ONE NDJSON error line
        const errorEvent = {
          event: 'error',
          data: {
            error: 'bad_upstream_status',
            status: status,
            contentType: contentType,
            bodyPreview: bodyPreview,
            hasUrl: !!process.env.DIFY_API_URL,
            hasKey: !!process.env.DIFY_SECRET_KEY
          }
        };
        
        res.write(JSON.stringify(errorEvent) + '\n');
        res.end();
        return;
      }

      // Process SSE stream and transform to NDJSON
      const reader = response.body?.getReader();
      if (!reader) {
        const text = await response.text();
        res.write(JSON.stringify({ type: 'final', data: text }) + '\n');
        return res.end();
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let chunkCount = 0;
      let streamCompleted = false;

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          chunkCount++;
          
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // Process complete SSE events (separated by \n\n)
          let sep;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const chunk = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            
            // Process this complete SSE frame
            const lines = chunk.split('\n');
            const datas = lines
              .filter(l => l.startsWith('data:'))
              .map(l => l.slice(5).trim())
              .filter(Boolean);
              
            for (const payload of datas) {
              if (payload === '[DONE]') continue;  // Handle [DONE]
              
              try {
                const data = JSON.parse(payload);

                // Transform SSE event to NDJSON and write to response
                const ndjsonEvent = {
                  event: data.event,
                  data: data
                };

                // Write NDJSON line
                res.write(JSON.stringify(ndjsonEvent) + '\n');
                res.flush?.();

                // Handle stream completion
                if (data.event === 'message_end') {
                  streamCompleted = true;
                  break;
                } else if (data.event === 'error') {
                  throw new Error(`Dify stream error: ${data.message || 'Unknown error'}`);
                }
              } catch (error) {
                // Fallback for non-JSON data
                const ndjsonEvent = { type: 'text', data: payload };
                res.write(JSON.stringify(ndjsonEvent) + '\n');
                res.flush?.();
              }
            }
          }
        }

        // Send final completion event only if stream completed normally
        if (streamCompleted) {
          const completionEvent = {
            event: 'complete',
            data: {
              duration_ms: Date.now() - startTime
            }
          };
          res.write(JSON.stringify(completionEvent) + '\n');
          res.flush?.();
        }

      } catch (streamError) {
        // FIXED: Only emit error on real timeout and upstream failures, NOT client disconnects
        if (streamError.name === 'AbortError') {
          // Check abort reason to determine if it's timeout or client disconnect
          const isTimeout = controller.signal.reason === 'timeout';
          
          if (isTimeout) {
            const errorEvent = {
              event: 'error',
              data: {
                error: 'timeout',
                message: 'Stream timeout after 235s'
              }
            };
            res.write(JSON.stringify(errorEvent) + '\n');
            res.flush?.();
          }
          // Do NOT emit error NDJSON for client disconnects - just let stream end
        } else {
          const name = streamError?.name || (typeof streamError === 'string' ? 'AbortError' : typeof streamError);
          const code = streamError?.code || streamError?.cause?.code || (clientAborted ? 'client_aborted' : 'unknown');
          const message = String(streamError?.message || streamError);
          
          const errorEvent = {
            event: 'error',
            data: {
              error: 'fetch_error',
              name: name,
              code: code,
              message: message,
              hasUrl: !!process.env.DIFY_API_URL,
              hasKey: !!process.env.DIFY_SECRET_KEY
            }
          };
          res.write(JSON.stringify(errorEvent) + '\n');
          res.flush?.();
        }
      } finally {
        // Clear timeout in finally block
        clearTimeout(timeoutId);
        
        // For client closes, just end the response without error
        res.end();
      }

    } catch (error) {
      // Clear timeout here too
      clearTimeout(timeoutId);
      
      // Check abort reason to determine if it's timeout or client disconnect
      const isAbort = error?.name === 'AbortError';
      const isTimeout = controller.signal.reason === 'timeout';
      
      if (isAbort && isTimeout) {
        const errorEvent = {
          event: 'error',
          data: {
            error: 'timeout',
            message: 'Request timed out after 235s'
          }
        };
        res.write(JSON.stringify(errorEvent) + '\n');
        res.flush?.();
      } else if (!isAbort || !clientAborted) {
        // Only emit error for non-abort errors or non-client-aborted cases
        const errorEvent = {
          event: 'error',
          data: {
            error: 'fetch_error',
            message: error.message || 'Network error occurred'
          }
        };
        res.write(JSON.stringify(errorEvent) + '\n');
        res.flush?.();
      }

      res.end();
    }

  } catch (error) {
    // Handle validation errors and other setup errors
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
    
    // Load NFL teams data
    let nflTeams;
    try {
      nflTeams = loadNflTeams();
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'handler_error',
        message: 'Failed to load NFL teams data'
      });
    }
    
    // Get week schedule using the helper function
    const weekSchedule = getWeekSchedule(schedule, week);
    
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
      
      // Get player's team abbreviation - handle both object and string formats
      let playerTeamAbbr = '';
      if (player.team) {
        if (typeof player.team === 'object' && player.team.abbr) {
          playerTeamAbbr = player.team.abbr;
        } else if (typeof player.team === 'string') {
          playerTeamAbbr = player.team;
        }
      }
      
      if (!playerTeamAbbr) {
        // No team info, assume bye week
        playerWithMatchup.matchup = {
          week: week,
          bye: true
        };
      } else {
        // Find matchup for player's team with enhanced info
        const matchupInfo = findMatchupForTeam(weekSchedule, playerTeamAbbr, nflTeams);
        
        if (matchupInfo) {
          // Found matchup - use enhanced format
          playerWithMatchup.matchup = matchupInfo;
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