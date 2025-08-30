require("dotenv").config();
const express = require("express");
const compression = require("compression");
const { neon } = require("@neondatabase/serverless");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

// Streaming utilities
const {
  setupSSEResponse,
  sendSSEEvent,
  sendSSEError,
  sendSSEComplete,
  setupHeartbeat,
  setupAbortHandling,
  setupTimeout
} = require("./helpers/streaming");

const {
  sendToDifyBlocking,
  sendToDifyStreaming,
  validateStreamingRequest,
  sendTestMessageBlocking,
  getDifyBlockingResponse
} = require("./helpers/dify-client");

// Import the route-scoped streaming router
const { streamRouter } = require('./streamRouter');

const sql = neon(process.env.DATABASE_URL);
const app = express();

// Configure body parser limits
const BODY_LIMIT = process.env.BODY_LIMIT || '5mb';

// Utility functions for payload size logging and error handling
function bytesFromSizeString(limitString) {
  const str = String(limitString).toLowerCase().trim();
  const match = str.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/);
  if (!match) return 0;
  
  const num = parseFloat(match[1]);
  const unit = match[2] || 'b';
  
  switch (unit) {
    case 'b': return Math.floor(num);
    case 'kb': return Math.floor(num * 1024);
    case 'mb': return Math.floor(num * 1024 * 1024);
    case 'gb': return Math.floor(num * 1024 * 1024 * 1024);
    default: return 0;
  }
}

function humanBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
  return `${size} ${sizes[i]}`;
}

function compactError(err, max = 600) {
  const name = err?.name || 'Error';
  const msg = (err?.message || String(err)).toString();
  const stack = (err?.stack || '').split('\n')[1]?.trim() || '';
  const base = `${name}: ${msg}`;
  const trimmed = base.length > max ? (base.slice(0, max) + '… [truncated]') : base;
  return stack ? `${trimmed} | ${stack}` : trimmed;
}

const BODY_LIMIT_BYTES = bytesFromSizeString(BODY_LIMIT);

// Mount streaming router FIRST before global middleware
app.use('/api/llm/stream', streamRouter);

// Mount route-scoped JSON parser for /api/draft BEFORE global parser
app.use('/api/draft', express.json({ limit: process.env.BODY_LIMIT || '5mb' }));

// Mount the draft router
app.use('/api/draft', require('./routes/draft'));

// Add route-scoped 413 JSON error handler for /api/draft
app.use('/api/draft', (err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ ok: false, message: 'Payload too large', limit: process.env.BODY_LIMIT || '5mb' });
  }
  return next(err);
});

// Apply compression middleware with conditional logic to skip streaming routes
app.use(compression({
  filter: (req, res) => {
    // Skip compression for streaming endpoints and if explicitly marked
    if (req.path.startsWith('/api/llm/stream') ||
        res.getHeader('X-No-Compression') ||
        (req.path === '/api/draft/initialize' && req.query.stream) ||
        (req.originalUrl.includes('/api/draft/initialize') && req.query.stream) ||
        (req.path === '/api/draft/initialize' && req.headers.accept?.includes('text/event-stream'))) {
      return false;
    }
    // Use compression's default filter for everything else
    return compression.filter(req, res);
  }
}));

// Global parsers placed AFTER route-scoped parsers
app.use(express.json({ limit: process.env.GLOBAL_BODY_LIMIT || '100kb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.GLOBAL_BODY_LIMIT || '100kb' }));

// Boot log to record effective limits and clarify order
console.log('[BOOT]', {
  DIFY_DEBUG: process.env.DIFY_DEBUG,
  BODY_LIMIT: process.env.BODY_LIMIT || '5mb',
  BLOCKING_TIMEOUT_MS: process.env.BLOCKING_TIMEOUT_MS || 3000000
});

// Startup guard - DEV-only environment diagnostics
if (process.env.NODE_ENV !== 'production') {
  console.info('[env]', {
    hasDifyUrl: !!process.env.DIFY_API_URL,
    difyKeyLen: (process.env.DIFY_SECRET_KEY||'').length
  });
}

// Dify API configuration
const DIFY_API_URL = "https://api.dify.ai/v1/chat-messages";
const DIFY_SECRET_KEY = process.env.DIFY_SECRET_KEY;
const DIFY_APP_ID = process.env.DIFY_APP_ID;

// Function to send message to Dify (legacy wrapper for backward compatibility)
async function sendToDify(message, conversationId = null, isUserTurn = false) {
  try {
    // Use the new dify-client for blocking requests
    // Create a simple action wrapper for legacy calls
    const action = 'legacy'; // Special action type for direct message sending
    const payload = { query: message, isUserTurn };
    
    const result = await sendToDifyBlocking(action, payload, conversationId);
    return result;
  } catch (error) {
    // console.error('Dify API Error:', error.message);
    console.error('[error]', compactError(error));
    return {
      success: false,
      error: error.message
    };
  }
}

// Endpoint to check connection and version
app.get("/version", async (req, res) => {
  try {
    const result = await sql`SELECT version()`;
    res.json(result[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to insert a player
app.post("/api/players", async (req, res) => {
  // Destructure the request body to individual variables
  const {
    id,
    overallRank,
    position,
    positionRank,
    name,
    teamAbbr,
    byeWeek,
    yearsPro,
    newTeam,
    role,
    competitionLevel,
    attributes,
    riskScore,
    stats
  } = req.body;

  try {
    await sql`
      INSERT INTO draft_roster (
        id, overall_rank, position, position_rank, name, team_abbr, bye_week,
        years_pro, new_team, role, competition_level, attributes, risk_score, stats
      ) VALUES (
        ${id},
        ${overallRank},
        ${position},
        ${positionRank},
        ${name},
        ${teamAbbr},
        ${byeWeek},
        ${yearsPro},
        ${newTeam},
        ${role},
        ${competitionLevel},
        ${JSON.stringify(attributes)},
        ${riskScore},
        ${JSON.stringify(stats)}
      )
    `;
    res.json({ success: true, inserted: id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to serve players from finalized draft roster JSON file
app.get("/api/players", async (req, res) => {
  try {
    const filePath = path.join(__dirname, "data", "finalized", "draftRoster_v4.json");
    const jsonData = fs.readFileSync(filePath, "utf8");
    const players = JSON.parse(jsonData);
    res.json(players);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fantasy Football Draft Endpoints

// Endpoint to reset the draft
// ROO: duplicate route
app.post("/api/draft/reset", async (req, res) => {
  try {
    const { message = "Draft reset - starting over." } = req.body;

    // Log payload size before sending to Dify
    if (process.env.DIFY_DEBUG === '1') {
      const sizeBytes = Buffer.byteLength(JSON.stringify(req.body || ""), "utf8");
      const percent = Math.min(100, ((sizeBytes / BODY_LIMIT_BYTES) * 100)).toFixed(1);
      console.log(`[payload] ~${humanBytes(sizeBytes)} (${sizeBytes} bytes) ≈ ${percent}% of limit ${humanBytes(BODY_LIMIT_BYTES)} (${BODY_LIMIT})`);
    }

    // Send reset message without conversation ID to start fresh
    const result = await sendToDify(message);
    
    if (result.success) {
      res.json({
        success: true,
        message: "Draft reset successfully. Ready for new initialization.",
        resetConfirmation: result.data.answer
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Duplicate route removed - using the buffered version in routes/draft.js instead

// ROO: ACK endpoint — blocking, fast lightweight ACK
app.post("/api/draft/player-taken", async (req, res) => {
  const crypto = require('crypto');
  const { UnifiedDifyClient, TraceLogger } = require('./helpers/dify-client');
  
  const traceId = crypto.randomUUID();
  const logger = new TraceLogger(traceId);
  const t0 = Date.now();
  
  logger.breadcrumb('player_taken_start', {
    endpoint: '/api/draft/player-taken',
    requestBody: Object.keys(req.body || {})
  });
  
  try {
    const { conversationId, player } = req.body;
    
    // Enhanced validation with detailed error messages
    if (!conversationId || !player) {
      logger.breadcrumb('player_taken_validation_failed', {
        hasConversationId: !!conversationId,
        hasPlayer: !!player
      });
      return res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: "Missing required fields: conversationId, player",
        details: {
          conversationId: conversationId ? 'present' : 'missing',
          player: player ? 'present' : 'missing'
        },
        traceId,
        source: 'node_backend_validation',
        duration_ms: Date.now() - t0
      });
    }
    
    if (!player.id || !player.name) {
      logger.breadcrumb('player_taken_player_validation_failed', {
        hasId: !!player.id,
        hasName: !!player.name,
        playerKeys: Object.keys(player || {})
      });
      return res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: "Missing required player fields: id, name",
        details: {
          playerId: player.id ? 'present' : 'missing',
          playerName: player.name ? 'present' : 'missing',
          providedFields: Object.keys(player || {})
        },
        traceId,
        source: 'node_backend_validation',
        duration_ms: Date.now() - t0
      });
    }

    logger.breadcrumb('player_taken_validated', {
      playerId: player.id,
      playerName: player.name,
      conversationId: conversationId?.slice(0, 8) + '...'
    });

    // Fix timeout configuration: 45s response, 15s Dify
    res.setTimeout(45000);

    const unifiedClient = new UnifiedDifyClient();
    
    // Create request body for Dify
    const difyRequestBody = {
      query: `Taken: ${player.name} (id:${player.id})`,
      inputs: {
        action: 'player-taken',
        player: {
          id: player.id,
          name: player.name,
          position: player.position,
          team: player.team?.abbr || player.team
        }
      },
      user: req.body.user || 'local-dev',
      conversation_id: conversationId
    };

    logger.breadcrumb('player_taken_calling_dify', {
      difyUrl: unifiedClient.apiUrl,
      hasSecretKey: !!unifiedClient.secretKey,
      timeoutMs: 15000
    });

    // Use UnifiedDifyClient directly for better error control
    const result = await unifiedClient.postBlocking({
      body: difyRequestBody,
      timeoutMs: 15000,
      traceId
    });
    
    const duration_ms = Date.now() - t0;
    
    if (result.ok) {
      logger.breadcrumb('player_taken_success', {
        duration_ms,
        conversationId: result.conversationId
      });
      
      res.json({
        ok: true,
        ack: true,
        player: { id: player.id, name: player.name },
        conversationId: result.conversationId,
        traceId,
        duration_ms,
        source: 'dify_success'
      });
    } else {
      // Enhanced error handling with detailed source information
      logger.breadcrumb('player_taken_dify_error', {
        error: result.error,
        status: result.status,
        duration_ms,
        upstreamStatus: result.upstreamStatus
      });

      if (result.error === 'timeout') {
        res.status(504).json({
          ok: false,
          error: 'timeout',
          message: `Dify API timeout after 15 seconds`,
          details: {
            timeoutMs: 15000,
            actualDuration: duration_ms,
            phase: 'dify_api_call'
          },
          traceId,
          source: 'dify_timeout',
          duration_ms
        });
      } else if (result.error === 'invalid_conversation') {
        res.status(409).json({
          ok: false,
          error: 'invalid_conversation',
          message: 'Conversation not found or invalid in Dify',
          details: {
            conversationId,
            upstreamStatus: result.upstreamStatus,
            bodySnippet: result.bodySnippet
          },
          traceId,
          source: 'dify_conversation_error',
          duration_ms
        });
      } else if (result.error === 'upstream_error') {
        res.status(502).json({
          ok: false,
          error: 'upstream_error',
          message: `Dify API returned ${result.upstreamStatus || 'unknown'} error`,
          details: {
            upstreamStatus: result.upstreamStatus,
            upstreamMessage: result.message,
            bodySnippet: result.bodySnippet,
            difyUrl: unifiedClient.apiUrl
          },
          traceId,
          source: 'dify_upstream_error',
          duration_ms
        });
      } else {
        res.status(400).json({
          ok: false,
          error: 'bad_request',
          message: result.message || 'Invalid request to Dify API',
          details: {
            difyError: result.error,
            upstreamStatus: result.upstreamStatus,
            bodySnippet: result.bodySnippet
          },
          traceId,
          source: 'dify_bad_request',
          duration_ms
        });
      }
    }
  } catch (error) {
    const duration_ms = Date.now() - t0;
    logger.error(error, { context: 'player_taken_handler', duration_ms });
    
    // Determine if this is a network error, Dify error, or Node backend error
    let errorSource = 'node_backend_error';
    let errorDetails = {
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack?.split('\n')[0] || 'no stack'
    };

    if (error.message?.includes('fetch')) {
      errorSource = 'network_error';
      errorDetails.networkIssue = 'Failed to connect to Dify API';
    } else if (error.message?.includes('DIFY') || error.message?.includes('upstream')) {
      errorSource = 'dify_connection_error';
    }

    res.status(502).json({
      ok: false,
      error: 'server_error',
      message: `Internal error in player-taken endpoint: ${error.message}`,
      details: errorDetails,
      traceId,
      source: errorSource,
      duration_ms,
      helpText: 'Check server logs with traceId for more details'
    });
  }
});

// ROO: User drafted endpoint — blocking, 60s
app.post("/api/draft/user-drafted", async (req, res) => {
  try {
    const { player, round, pick, conversationId } = req.body;
    
    if (!player || !round || !pick) {
      return res.status(400).json({
        error: "Missing required fields: player, round, pick"
      });
    }

    // Set response timeout ≥ 20,000 ms
    res.setTimeout(20000);
    
    // Add route timeout header
    res.setHeader('X-Route-Timeout', '60000');

    // Create small, explicit payload structure
    const user = "fantasy-draft-user";
    const query = `Player taken: ${player.name} (${player.position}, ${player.team?.abbr || ''})`;
    const inputs = {
      action: 'user-drafted',
      player: {
        id: player.id,
        name: player.name,
        position: player.position,
        team: { abbr: player.team?.abbr },
        byeWeek: player.byeWeek
      }
    };

    console.log(`[user-drafted] ${player.name} (${player.position}) - round ${round}, pick ${pick}`);

    // Use blocking call with 15,000ms timeout
    const result = await getDifyBlockingResponse({
      action: 'user-drafted',
      query,
      inputs,
      user,
      conversationId,
      timeoutMs: 60000
    });
    
    if (result.ok) {
      // Pass-through upstream answer (trimmed & think-stripped)
      let answer = result.data?.answer || '';
      if (answer) {
        // Remove common think patterns
        answer = answer.replace(/\*\*Think:.*?\*\*/gs, '').trim();
        answer = answer.replace(/\[Think:.*?\]/gs, '').trim();
      }
      
      res.json({
        success: true,
        confirmation: answer || 'Player taken acknowledged',
        conversationId: result.conversationId
      });
    } else {
      // Error mapping per requirements
      if (result.status === 408 || result.status === 504) {
        // AbortError or upstream 504 → return 504 with timeout error
        res.status(504).json({ ok: false, error: 'timeout' });
      } else {
        // Others → 502 with upstream error
        res.status(502).json({ ok: false, error: 'upstream' });
      }
    }
  } catch (error) {
    console.error('[user-drafted] error:', error.message);
    res.status(502).json({ ok: false, error: 'upstream' });
  }
});

// Removed duplicate /api/draft/user-turn route - now handled in routes/draft.js

// Test endpoint for Dify integration (non-streaming)
app.post("/test-dify", async (req, res) => {
  try {
    const result = await sendTestMessageBlocking();
    
    if (result.success) {
      res.json(result.data);
    } else {
      res.status(500).json({
        error: result.error,
        ...(process.env.NODE_ENV !== 'production' && { stack: result.stack })
      });
    }
  } catch (error) {
    res.status(500).json({
      error: error.message,
      ...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
    });
  }
});

// Streaming API Endpoints

app.post('/debug/slow-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const id = setInterval(() => res.write(`data: {"tick":${Date.now()}}\n\n`), 1000);
  setTimeout(() => { clearInterval(id); res.write('event: done\ndata: {}\n\n'); res.end(); }, 8000);
});

// POST /api/llm/stream handler moved to streamRouter.js for better organization

// GET /api/llm/stream - Optional EventSource fallback for cookie/session auth
// Note: This is disabled by default and only for cookie/session contexts
app.get('/api/llm/stream', (req, res) => {
  res.status(405).json({
    error: 'GET method not supported. Use POST with Authorization header.',
    info: 'EventSource fallback is disabled. Use fetch with POST method instead.'
  });
});

// Start the server
const PORT = 3000;
const server = app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Streaming enabled: ${process.env.STREAMING_ENABLED === 'true'}`);
});

// Configure server timeouts for blocking and streaming requests
server.setTimeout(Number(process.env.BLOCKING_TIMEOUT_MS || 3000000));
server.headersTimeout = Number(process.env.BLOCKING_TIMEOUT_MS || 3000000) + 100000;
server.keepAliveTimeout = Number(process.env.SERVER_KEEPALIVE_TIMEOUT_MS || 3000000);

/*
 * REVERSE PROXY CONFIGURATION NOTES:
 *
 * If using a reverse proxy (nginx, Apache, etc.) in front of this server,
 * ensure the following configurations for streaming endpoints:
 *
 * For nginx:
 *   location /api/llm/stream {
 *     proxy_pass http://backend;
 *     proxy_buffering off;
 *     proxy_cache off;
 *     proxy_read_timeout 300s;
 *     proxy_send_timeout 300s;
 *   }
 *
 * For Apache:
 *   ProxyPass /api/llm/stream http://backend/api/llm/stream nocanon
 *   ProxyPassReverse /api/llm/stream http://backend/api/llm/stream
 *   # Add to virtual host:
 *   SetEnv proxy-nokeepalive 1
 *   SetEnv proxy-sendchunked 1
 */
