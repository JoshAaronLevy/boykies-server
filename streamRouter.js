const express = require('express');
const crypto = require('crypto');
const streamRouter = express.Router();

// Import streaming utilities
const {
  setupSSEResponse,
  sendSSEEvent,
  sendSSEError,
  sendSSEComplete,
  setupHeartbeat,
  setupAbortHandling,
  setupTimeout
} = require('./helpers/streaming');

// Import Dify client
const {
  sendToDifyStreaming,
  validateStreamingRequest,
  sendTestMessageStreaming
} = require('./helpers/dify-client');

// Import stream debug helpers
const {
  generateReqId,
  makePhase,
  getTranscript,
  getLastTranscript
} = require('./helpers/stream-debug');

// Utility functions for payload size logging
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

const BODY_LIMIT = process.env.BODY_LIMIT || '5mb';
const BODY_LIMIT_BYTES = bytesFromSizeString(BODY_LIMIT);

// Route-scoped JSON parser FIRST with high limit for streaming
streamRouter.use(express.json({ limit: BODY_LIMIT }));

// Route-scoped body limit error handler that converts entity.too.large into an SSE error
function streamBodyLimitErrorHandler(err, req, res, next) {
  if (err?.type === 'entity.too.large') {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    // Write SSE error event
    res.write(`event: error\ndata: ${JSON.stringify({
      message: `Payload too large: ${err.message}`,
      limit: BODY_LIMIT
    })}\n\n`);
    
    // Loud log
    console.error('[STREAM][413]', {
      limit: BODY_LIMIT,
      message: err.message
    });
    
    return res.end();
  }
  
  // Pass-through for non-entity.too.large errors
  return next(err);
}

// Apply error handler to streaming router
streamRouter.use(streamBodyLimitErrorHandler);

// Optional header to discourage compression
streamRouter.use((req, res, next) => {
  res.setHeader('X-No-Compression', '1');
  next();
});

// POST /api/llm/stream - Main streaming endpoint with correlation IDs and phase breadcrumbs
streamRouter.post('/', async (req, res) => {
  // Check if streaming is enabled
  if (process.env.STREAMING_ENABLED !== 'true') {
    return res.status(503).json({ error: 'Streaming is disabled' });
  }

  // Generate correlation ID and create phase helper
  const reqId = generateReqId();
  const phase = makePhase(res, reqId);
  
  // Add route entry logging with correlation ID
  const { action, conversationId } = req.body || {};
  console.log('[STREAM] start', { action, conversationId, reqId, t: Date.now() });
  
  // Phase: route_enter
  phase('route_enter', { action, conversationId });

  // Setup SSE response headers
  setupSSEResponse(res);

  // Immediate flush + ack to prevent 504 timeouts
  res.write(': keep-alive\n\n'); // immediate flush
  
  // Phase: ack_sent
  phase('ack_sent');

  // Get configuration
  const heartbeatMs = Number(process.env.STREAM_HEARTBEAT_MS || 20000);
  const timeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_MS || 240000);
  
  // Setup abort controller and timeout
  const controller = new AbortController();
  const clearTimeout = setupTimeout(controller, timeoutMs);
  
  // Setup heartbeat - capture timer ID for proper cleanup
  const heartbeatTimer = setupHeartbeat(res, heartbeatMs);
  
  // Centralized cleanup function
  const cleanupAndEnd = () => {
    clearInterval(heartbeatTimer);
    clearTimeout();
    console.log('[stream] heartbeat cleared');
    if (!res.writableEnded) {
      res.end();
    }
  };
  
  // Setup abort handling for client disconnect
  setupAbortHandling(req, controller, cleanupAndEnd);

  try {
    // Validate request
    const { action, conversationId, payload } = validateStreamingRequest(req.body);
    
    // Phase: validated_ok
    phase('validated_ok');
    
    // Log payload size before sending to Dify
    if (process.env.DIFY_DEBUG === '1') {
      const sizeBytes = Buffer.byteLength(JSON.stringify(req.body || ""), "utf8");
      const percent = Math.min(100, ((sizeBytes / BODY_LIMIT_BYTES) * 100)).toFixed(1);
      console.log(`[payload] ~${humanBytes(sizeBytes)} (${sizeBytes} bytes) ≈ ${percent}% of limit ${humanBytes(BODY_LIMIT_BYTES)} (${BODY_LIMIT})`);
    }
    
    // Phase: calling_upstream
    phase('calling_upstream');
    
    // Stream response from Dify with instrumented streaming function
    await sendToDifyStreamingInstrumented(req, res, cleanupAndEnd, reqId, phase, action, payload, "fantasy-draft-user", conversationId);
    
  } catch (error) {
    console.error('[error]', compactError(error));
    phase('stream_ending', { error: error.message });
    if (!res.writableEnded) {
      sendSSEError(res, error, false);
      res.end();
    }
  }
});

// Instrumented version of sendToDifyStreaming with phase breadcrumbs
async function sendToDifyStreamingInstrumented(req, res, cleanupAndEnd, reqId, phase, action, payload, user, conversationId = null) {
  // Setup connect watchdog
  const connectMs = Number(process.env.LLM_CONNECT_WATCHDOG_MS || 15000);
  const connectController = new AbortController();
  const connectWatchdog = setTimeout(() => {
    try { connectController.abort(); } catch {}
    res.write(`event: error\ndata: ${JSON.stringify({ message: `Upstream connect timeout after ${connectMs}ms` })}\n\n`);
    cleanupAndEnd();
  }, connectMs);

  const timeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_MS || 240000);
  const timeout = setTimeout(() => connectController.abort(), timeoutMs);

  req.on('close', () => connectController.abort());

  let upstream;
  try {
    // Build request payload
    const difyPayload = {
      user: process.env.DIFY_USER || user || "fantasy-draft-user",
      conversation_id: conversationId || undefined,
      response_mode: "streaming",
      inputs: {},
      query: buildSimpleMessage(action, payload)
    };

    upstream = await fetch(process.env.DIFY_API_URL || 'https://api.dify.ai/v1/chat-messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.DIFY_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(difyPayload),
      signal: connectController.signal
    });

  } finally {
    clearTimeout(connectWatchdog);
  }

  try {
    console.log('[STREAM] upstream-start', { status: upstream.status, reqId });
    
    // Phase: upstream_response
    phase('upstream_response', { status: upstream.status, ct: upstream.headers.get('content-type') });

    // Handle upstream errors
    if (!upstream.body) {
      phase('upstream_no_body');
      res.write(`event: error\ndata: ${JSON.stringify({ message: 'Upstream had no body', status: upstream.status })}\n\n`);
      cleanupAndEnd();
      return;
    }
    
    if (!upstream.ok) {
      let bodySnippet = '';
      try {
        const errText = await upstream.text();
        bodySnippet = errText.slice(0, 300);
      } catch {}
      
      phase('upstream_non_200', { status: upstream.status });
      res.write(`event: error\ndata: ${JSON.stringify({
        message: `Upstream ${upstream.status} ${upstream.statusText}`,
        status: upstream.status,
        bodySnippet
      })}\n\n`);
      cleanupAndEnd();
      return;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let isFirstChunk = true;
    
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      // On first chunk, decode a sample for phase logging
      if (isFirstChunk && value) {
        let sample = '';
        try {
          const decoded = decoder.decode(value.slice(0, Math.min(400, value.length)), { stream: true });
          sample = decoded.slice(0, 300);
        } catch (err) {
          sample = `<decode error: ${err.message}>`;
        }
        phase('upstream_first_chunk_sample', { sample });
        isFirstChunk = false;
      }
      
      // Write original chunk unchanged (binary-safe passthrough)
      res.write(value);
    }

    // Phase: upstream_end
    phase('upstream_end');
    res.write('event: done\ndata: {}\n\n');
    console.log('[STREAM] upstream-end', { reqId });

  } catch (err) {
    console.log('[STREAM] upstream-error', { error: String(err), reqId });
    if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: String(err), retryable: false })}\n\n`);
    }
  } finally {
    clearTimeout(timeout);
    phase('stream_ending');
    cleanupAndEnd();
  }
}

// Simple message builder for basic actions
function buildSimpleMessage(action, payload) {
  switch (action) {
    case 'initialize':
      const { numTeams, userPickPosition, players } = payload;
      return `Fantasy football draft is beginning. League details:
- Number of teams: ${numTeams}
- My draft position: ${userPickPosition}
- Available players: ${JSON.stringify(players?.slice(0, 50) || [])}

Please create an in-depth draft strategy for this league setup.`;
    
    case 'user-turn':
      const { player, round, pick, userRoster, availablePlayers } = payload;
      return `Player taken: ${JSON.stringify(player)} in round ${round}, pick ${pick}.

IT'S MY TURN NOW!

My current roster: ${JSON.stringify(userRoster)}
Available players (top options): ${JSON.stringify(availablePlayers?.slice(0, 20) || [])}

Please provide your analysis and recommendations for my next pick.`;
      
    default:
      return JSON.stringify(payload);
  }
}

// GET /debug/last-stream - Dev-only endpoint to access transcripts
streamRouter.get('/debug/last-stream', (req, res) => {
  if (process.env.DIFY_DEBUG !== '1') {
    return res.status(404).json({ error: 'Not found' });
  }
  
  const { reqId } = req.query;
  let result;
  
  if (reqId) {
    const entries = getTranscript(reqId);
    result = { ok: true, reqId, entries };
  } else {
    const { reqId: lastReqId, entries } = getLastTranscript();
    result = { ok: true, reqId: lastReqId || '(last)', entries };
  }
  
  res.json(result);
});

// GET /debug/stream-selftest - Dev-only SSE selftest that calls Dify
streamRouter.get('/debug/stream-selftest', async (req, res) => {
  if (process.env.DIFY_DEBUG !== '1') {
    return res.status(404).json({ error: 'Not found' });
  }
  
  // Generate correlation ID and create phase helper
  const reqId = generateReqId();
  const phase = makePhase(res, reqId);
  
  // Setup SSE response headers
  setupSSEResponse(res);
  
  phase('selftest_start');
  
  try {
    // Call Dify with a tiny streaming request
    const difyPayload = {
      user: "selftest-user",
      response_mode: "streaming",
      inputs: {},
      query: "ping"
    };
    
    const upstream = await fetch(process.env.DIFY_API_URL || 'https://api.dify.ai/v1/chat-messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.DIFY_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(difyPayload)
    });
    
    phase('selftest_upstream', { status: upstream.status });
    
    if (!upstream.ok || !upstream.body) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: 'Selftest upstream failed', status: upstream.status })}\n\n`);
      res.end();
      return;
    }
    
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let isFirstChunk = true;
    
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      // On first chunk, decode a sample
      if (isFirstChunk && value) {
        let sample = '';
        try {
          const decoded = decoder.decode(value.slice(0, Math.min(400, value.length)), { stream: true });
          sample = decoded.slice(0, 300);
        } catch (err) {
          sample = `<decode error: ${err.message}>`;
        }
        phase('selftest_first_chunk_sample', { sample });
        isFirstChunk = false;
      }
      
      // Passthrough chunks
      res.write(value);
    }
    
    res.write('event: done\ndata: {}\n\n');
    res.end();
    
  } catch (error) {
    res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
    res.end();
  }
});

// Test endpoint for Dify integration (streaming) - robust instrumented implementation
streamRouter.post('/test-dify-stream', async (req, res) => {
  // 1) Proper SSE response setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  
  // Immediately flush a keep-alive/ack to the client
  res.write(': keep-alive\n\n');
  
  // Helper function to emit phase frames
  const emitPhase = (step, extra = {}) => {
    const frame = { type: 'phase', step, t: Date.now(), ...extra };
    if (process.env.DIFY_DEBUG === '1') {
      console.log('[PHASE][test-dify-stream]', frame);
    }
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(frame)}\n\n`);
    }
  };
  
  // Helper function to emit SSE error
  const emitError = (message, extra = {}) => {
    if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ message, ...extra })}\n\n`);
    }
  };
  
  // Track if response has ended to prevent late writes
  let responseEnded = false;
  
  // 3) Connect watchdog setup
  const watchdogMs = Number(process.env.LLM_CONNECT_WATCHDOG_MS || 15000);
  const abortController = new AbortController();
  let watchdogTimeout;
  
  try {
    // 8) try/catch around the whole flow
    
    // Set up watchdog that fires if fetch hasn't returned
    watchdogTimeout = setTimeout(() => {
      if (!responseEnded) {
        try {
          abortController.abort();
        } catch {}
        emitError(`Upstream connect timeout after ${watchdogMs}ms`);
        if (!res.writableEnded) {
          res.end();
        }
        responseEnded = true;
      }
    }, watchdogMs);
    
    // 2) Use Node fetch to call Dify
    const upstream = await fetch('https://api.dify.ai/v1/chat-messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.DIFY_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        user: 'stream-selftest',
        response_mode: 'streaming',
        inputs: {},
        query: 'Hello'
      }),
      signal: abortController.signal
    });
    
    // Ensure the watchdog is always cleared once fetch settles
    if (watchdogTimeout) {
      clearTimeout(watchdogTimeout);
      watchdogTimeout = null;
    }
    
    // 4) After fetch returns - emit phase frame
    emitPhase('upstream_response', {
      status: upstream.status,
      ct: upstream.headers.get('content-type')
    });
    
    // 5) If upstream is non-OK or missing a body
    if (!upstream.body) {
      emitPhase('upstream_no_body');
      emitError('Upstream had no body', { status: upstream.status });
      if (!res.writableEnded) {
        res.end();
      }
      responseEnded = true;
      return;
    }
    
    if (!upstream.ok) {
      let bodySnippet = '';
      try {
        const bodyText = await upstream.text();
        bodySnippet = bodyText.slice(0, 500);
      } catch (err) {
        // Ignore errors reading body
      }
      
      emitPhase('upstream_non_200', { status: upstream.status });
      emitError('Upstream error', {
        status: upstream.status,
        bodySnippet
      });
      if (!res.writableEnded) {
        res.end();
      }
      responseEnded = true;
      return;
    }
    
    // 6) Streaming pass-through loop
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let isFirstChunk = true;
    
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      // On the first chunk only, decode sample and emit phase
      if (isFirstChunk && value) {
        let sample = '';
        try {
          const sampleBytes = Math.min(400, value.length);
          const decoded = decoder.decode(value.slice(0, sampleBytes), { stream: true });
          sample = decoded.slice(0, 400);
        } catch (err) {
          sample = `<decode error: ${err.message}>`;
        }
        emitPhase('upstream_first_chunk_sample', { sample });
        isFirstChunk = false;
      }
      
      // Write each chunk value directly to the client without transformation
      if (!res.writableEnded) {
        res.write(value);
      }
    }
    
    // 7) Normal completion
    emitPhase('upstream_end');
    if (!res.writableEnded) {
      res.write('event: done\ndata: {}\n\n');
      res.end();
    }
    responseEnded = true;
    
  } catch (error) {
    // 8) Exception handling
    if (watchdogTimeout) {
      clearTimeout(watchdogTimeout);
    }
    
    emitPhase('upstream_fetch_error', { message: String(error) });
    emitError(String(error));
    if (!res.writableEnded) {
      res.end();
    }
    responseEnded = true;
  }
});

module.exports = { streamRouter };