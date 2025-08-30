const express = require('express');
const { slimPlayers } = require('../helpers/slimPlayers');
const { getDifyBufferedResponse, getDifyBlockingResponse } = require('../helpers/dify-client');

const router = express.Router();

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
    console.error('[DRAFT] Warning: Neither global fetch nor node-fetch available');
  }
}

// Environment configuration
const DIFY_API_URL = process.env.DIFY_API_URL || 'https://api.dify.ai/v1/chat-messages';
const DIFY_SECRET_KEY = process.env.DIFY_SECRET_KEY;
const MAX_INIT_PLAYERS = Number(process.env.MAX_INIT_PLAYERS || 50);
const LLM_BLOCKING_TIMEOUT_MS = Number(process.env.LLM_BLOCKING_TIMEOUT_MS || 3000000);

// GET /api/draft/debug/delay/:ms — sleeps for :ms then returns
router.get('/debug/delay/:ms', async (req, res) => {
  const ms = Math.max(0, Number(req.params.ms) || 0);
  res.setTimeout(ms + 10_000);
  await new Promise(r => setTimeout(r, ms));
  res.json({ slept_ms: ms });
});

// POST /api/draft/marco — Pings Dify; expects "Polo!" answer
router.post('/marco', async (req, res) => {
  const t0 = Date.now();

  // Give the *response* enough time on the server side
  res.setTimeout(120_000);

  // Build the Dify payload (force "Marco"; ignore any FE message)
  const user = (req.body && req.body.user) ? String(req.body.user) : 'local-dev';
  const difyPayload = {
    user,
    query: 'Marco',
    response_mode: 'blocking',
    inputs: { action: 'Marco' },
    // IMPORTANT: omit conversation_id for this simple ping
  };

  // Local per-route timeout — avoid any shared 60s default elsewhere
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000); // 90s

  try {
    const response = await fetch(DIFY_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DIFY_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(difyPayload),
      signal: controller.signal
    });

    // Be robust to non-JSON error bodies (e.g., 502/504 proxies)
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    const duration = Date.now() - t0;
    const answer = data?.answer ?? '';

    console.log(`[MARCO] status=${response.status} durationMs=${duration} answer=${JSON.stringify(answer)}`);

    return res.status(response.status).json({
      ok: response.ok,
      upstreamStatus: response.status,
      duration_ms: duration,
      answer,             // should be "Polo!" if your Dify rule matched
      upstream: data      // keep for now; remove later if too chatty
    });
  } catch (err) {
    const duration = Date.now() - t0;
    const isAbort = err?.name === 'AbortError';
    console.error('[MARCO][ERROR]', { isAbort, duration, message: String(err) });

    return res.status(isAbort ? 504 : 502).json({
      ok: false,
      error: isAbort ? 'timeout' : 'fetch_error',
      duration_ms: duration,
      message: String(err)
    });
  } finally {
    clearTimeout(timer);
  }
});

// POST /api/draft/initialize - Server-side streaming buffer endpoint with optional streaming mode
router.post('/initialize', async (req, res) => {
  const startTime = Date.now();
  
  // Set timeout for the entire request (320s)
  res.setTimeout(320000);
  
  try {
    const { user, conversationId, payload } = req.body;
    const isStreaming = req.query.stream;

    // Validation
    if (!user) {
      return res.status(400).json({
        ok: false,
        message: 'Initialize requires: user'
      });
    }

    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({
        ok: false,
        message: 'Initialize requires: payload object'
      });
    }

    const { numTeams, userPickPosition, players } = payload;

    if (typeof numTeams !== 'number') {
      return res.status(400).json({
        ok: false,
        message: 'Initialize requires: payload.numTeams as number'
      });
    }

    if (typeof userPickPosition !== 'number') {
      return res.status(400).json({
        ok: false,
        message: 'Initialize requires: payload.userPickPosition as number'
      });
    }

    if (!Array.isArray(players)) {
      return res.status(400).json({
        ok: false,
        message: 'Initialize requires: payload.players as array'
      });
    }

    if (players.length < 1) {
      return res.status(400).json({
        ok: false,
        message: 'Initialize requires: payload.players with at least 1 player'
      });
    }

    if (players.length > MAX_INIT_PLAYERS) {
      return res.status(400).json({
        ok: false,
        message: `Initialize requires: payload.players with at most ${MAX_INIT_PLAYERS} players`
      });
    }

    // Handle streaming mode
    if (isStreaming) {
      const wantsStream = req.query.stream;
      const simulate = req.query.simulate;
      const timeoutMs = 235000; // ~235s (≈3:55)
      
      // Debug instrumentation
      if (process.env.DEBUG_STREAM_INIT) {
        console.log(`[DEBUG_STREAM_INIT] Route entry: wantsStream=${wantsStream}, simulate=${simulate}, timeout=${timeoutMs}ms`);
      }
      
      // Simulation mode for testing streaming pipeline
      if (simulate) {
        // Set NDJSON streaming headers
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
        
        if (process.env.DEBUG_STREAM_INIT) {
          console.log('[DEBUG_STREAM_INIT] Headers flushed for simulation');
        }

        const tokens = ['Creating', 'your', 'draft', 'strategy', 'based', 'on', 'team', 'analysis', 'and', 'player', 'data', 'Complete!'];
        for (let i = 0; i < tokens.length; i++) {
          await new Promise(resolve => setTimeout(resolve, 200));
          res.write(JSON.stringify({ type: 'text', data: `token ${i+1}: ${tokens[i]}` }) + '\n');
          res.flush?.();
        }
        res.write(JSON.stringify({ type: 'final', data: 'Simulation complete' }) + '\n');
        return res.end();
      }

      // Set NDJSON streaming headers
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
      
      if (process.env.DEBUG_STREAM_INIT) {
        console.log('[DEBUG_STREAM_INIT] Headers flushed for real streaming');
      }

      // Set up AbortController for client disconnects and timeout
      const controller = new AbortController();
      const controllerId = Math.random().toString(36).substr(2, 9);
      let clientAborted = false;
      
      if (process.env.DEBUG_STREAM_INIT) {
        console.log(`[DEBUG_STREAM_INIT] AbortController created: id=${controllerId}, timeout=${timeoutMs}ms`);
      }
      
      // Safety timeout that persists throughout entire stream lifecycle
      const timeoutId = setTimeout(() => {
        if (process.env.DEBUG_STREAM_INIT) {
          console.log(`[DEBUG_STREAM_INIT] Safety timeout fired for controller=${controllerId}`);
        }
        console.log('[STREAMING][initialize] Safety timeout triggered after 235s');
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
        // Build Dify request payload for initialize
        const difyPayload = {
          user: user,
          response_mode: 'streaming',
          query: 'initialize',
          inputs: {
            action: 'initialize',
            numTeams: payload.numTeams,
            userPickPosition: payload.userPickPosition,
            availablePlayers: payload.players || payload.availablePlayers || []
          }
        };

        if (conversationId) {
          difyPayload.conversation_id = conversationId;
        }

        // Debug instrumentation - emit NDJSON debug line when debug=1
        if (req.query.debug == '1') {
          const debugEvent = {
            event: "debug",
            data: {
              path: "routes/draft",
              difyBodyKeys: Object.keys(difyPayload || {}),
              inputsKeys: Object.keys((difyPayload && difyPayload.inputs) || {})
            }
          };
          res.write(JSON.stringify(debugEvent) + '\n');
        }

        // Add debug logging for body structure
        console.info('[dify:body:init]', Object.keys(difyPayload), Object.keys(difyPayload.inputs||{}));

        // Initialize keepalive ping functionality
        let firstChunkSeen = false;
        const pingInterval = setInterval(() => {
          if (!firstChunkSeen && !res.writableEnded) {
            res.write(JSON.stringify({ event: "ping", data: { ts: Date.now() } }) + "\n");
          }
        }, 10000);

        if (process.env.DEBUG_STREAM_INIT) {
          console.log(`[DEBUG_STREAM_INIT] Upstream fetch start: URL=${DIFY_API_URL}, Accept=text/event-stream`);
        }
        
        // Make streaming call to Dify API directly
        const response = await fetch(DIFY_API_URL, {
          method: 'POST',
          headers: {
            'Accept': 'text/event-stream',
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + DIFY_SECRET_KEY
          },
          body: JSON.stringify(difyPayload),
          signal: controller.signal,
          duplex: 'half'
        });
// CRITICAL FIX: Do NOT clear timeout after fetch succeeds
// Keep timeout active during entire stream processing lifecycle

// Preflight check for upstream response
const status = response.status;
const contentType = response.headers.get('content-type') || '';

if (!response.ok || !contentType.includes('text/event-stream')) {
  // Read up to first 512 bytes from response body if present
  let bodyPreview = '';
  try {
    if (response.body) {
      const reader = response.body.getReader();
      const { value } = await reader.read();
      if (value) {
        const decoder = new TextDecoder();
        const fullText = decoder.decode(value);
        bodyPreview = fullText.slice(0, 200); // First 200 chars, sanitized
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
let finalConversationId = conversationId;
let chunkCount = 0;
let firstChunkReceived = false;
let streamCompleted = false;

try {
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    chunkCount++;
    if (!firstChunkReceived) {
      firstChunkReceived = true;
      firstChunkSeen = true;
      clearInterval(pingInterval);
      if (process.env.DEBUG_STREAM_INIT) {
        console.log('[DEBUG_STREAM_INIT] First upstream chunk received');
      }
    }
    
    // Occasionally log chunk count for debugging
    if (process.env.DEBUG_STREAM_INIT && chunkCount % 10 === 0) {
      console.log(`[DEBUG_STREAM_INIT] Processed ${chunkCount} chunks`);
    }
    
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
          
          // Track conversation ID
          if (data.conversation_id) {
            finalConversationId = data.conversation_id;
          }

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

  if (process.env.DEBUG_STREAM_INIT) {
    console.log('[DEBUG_STREAM_INIT] Upstream stream done normally');
  }

  // Send final completion event only if stream completed normally
  if (streamCompleted) {
    const completionEvent = {
      event: 'complete',
      data: {
        conversationId: finalConversationId,
        duration_ms: Date.now() - startTime
      }
    };
    res.write(JSON.stringify(completionEvent) + '\n');
    res.flush?.();
  }

} catch (streamError) {
  if (process.env.DEBUG_STREAM_INIT) {
    console.log(`[DEBUG_STREAM_INIT] Stream error: ${streamError.name} - ${streamError.message}`);
  }
  
  // Add debug line for client aborts when debug=1
  if (req.query.debug == '1' && clientAborted) {
    res.write(JSON.stringify({ event: "debug", data: { path: "routes/draft", note: "client_aborted" } }) + "\n");
  }
  
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
  if (process.env.DEBUG_STREAM_INIT) {
    console.log(`[DEBUG_STREAM_INIT] Ending stream, writableEnded=${res.writableEnded}, clientAborted=${clientAborted}`);
  }
  
  // CRITICAL FIX: Clear timeout and ping interval in finally block
  clearTimeout(timeoutId);
  clearInterval(pingInterval);
  
  // For client closes, just end the response without error
  res.end();
}

} catch (error) {
// CRITICAL FIX: Clear timeout and ping interval here too
clearTimeout(timeoutId);
clearInterval(pingInterval);

if (!res.headersSent) {
  // Headers not sent yet, send NDJSON error
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
}

// FIXED: Only send NDJSON error for real errors, NOT client disconnects
if (error.name === 'AbortError' && controller.signal.reason === 'client-aborted') {
  // Don't emit error for client disconnects - just log and end
  if (process.env.DEBUG_STREAM_INIT) {
    console.log('[DEBUG_STREAM_INIT] Skipping error emission for client disconnect');
  }
} else {
  // Enhanced error diagnostics matching exact format specified
  const name = error?.name || (typeof error === 'string' ? 'AbortError' : typeof error);
  const code = error?.code || error?.cause?.code || (clientAborted ? 'client_aborted' : 'unknown');
  const message = String(error?.message || error);
  
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
  
  // Console.error the same object
  console.error(errorEvent.data);
  
  res.write(JSON.stringify(errorEvent) + '\n');
  res.flush?.();
}
res.end();
      } finally {
        if (process.env.DEBUG_STREAM_INIT) {
          console.log('[DEBUG_STREAM_INIT] Final cleanup');
        }
      }

      return; // End streaming path here
    }

    // Non-streaming path: Use existing streaming buffer approach with 295s timeout
    const result = await getDifyBufferedResponse('initialize', payload, conversationId, 295000);
    
    const duration = Date.now() - startTime;
    console.log(`[BUFFERED][initialize] ms=${duration}`);

    // Add headers
    res.set('X-Backend-Timing', duration.toString());
    res.set('X-Streamed', 'true');
    if (result.conversationId) {
      res.set('X-Conversation-Id', result.conversationId);
    }

    if (result.success) {
      return res.json({
        ok: true,
        conversationId: result.conversationId || null,
        answer: result.data.answer || null,
        raw: {
          id: result.data.id || null,
          event: result.data.event || null
        }
      });
    } else {
      // Handle different error types
      if (result.errorType === 'timeout') {
        return res.status(504).json({
          ok: false,
          message: result.error
        });
      } else {
        return res.status(502).json({
          ok: false,
          message: result.error
        });
      }
    }

  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`[BUFFERED][initialize] error ms=${duration}`);
    
    return res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

// POST /api/draft/reset - Blocking endpoint to reset draft conversation
router.post('/reset', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { user } = req.body;

    // Validation
    if (!user) {
      return res.status(400).json({
        ok: false,
        message: 'Reset requires: user'
      });
    }

    // Build Dify request payload for reset
    const difyPayload = {
      user: user,
      response_mode: 'blocking',
      inputs: {},
      query: 'RESET_DRAFT: user is starting over. Please acknowledge reset.'
    };

    // Set up AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLM_BLOCKING_TIMEOUT_MS);

    try {
      // Make blocking call to Dify
      const response = await fetch(DIFY_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DIFY_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(difyPayload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const duration = Date.now() - startTime;
        console.log(`[BLOCKING][reset] ms=${duration}`);

        // Ignore conversation_id in response; client will clear its stored conversationId
        return res.json({
          ok: true,
          resetAcknowledged: true
        });
      } else {
        // Non-200 response
        const errorText = await response.text();
        const bodySnippet = errorText.slice(0, 2000);
        
        return res.status(502).json({
          ok: false,
          message: 'Upstream error',
          status: response.status,
          bodySnippet: bodySnippet
        });
      }

    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        return res.status(504).json({
          ok: false,
          message: `Upstream timeout after ${LLM_BLOCKING_TIMEOUT_MS} ms`
        });
      } else {
        return res.status(504).json({
          ok: false,
          message: fetchError.message
        });
      }
    }

  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`[BLOCKING][reset] ms=${duration}`);
    
    return res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

// Byte-size helper function
function bytesOf(obj) {
  try {
    return Buffer.byteLength(JSON.stringify(obj), 'utf8');
  } catch {
    return -1;
  }
}

// POST /api/draft/user-turn - User turn analysis endpoint
router.post('/user-turn', async (req, res) => {
  const t0 = Date.now();
  res.setTimeout(120_000);
  
  try {
    const user           = req.body?.user || 'local-dev';
    const conversationId = req.body?.conversationId;
    const p              = req.body?.payload || {};

    // Map pickNumber -> pick
    const round          = Number(p.round);
    const pick           = p.pick != null ? Number(p.pick) : Number(p.pickNumber);
    const userRoster     = Array.isArray(p.userRoster) ? p.userRoster : [];
    const availablePlayers = Array.isArray(p.availablePlayers) ? p.availablePlayers : [];
    const leagueSize     = Number(p.leagueSize);
    const pickSlot       = Number(p.pickSlot);

    // Validation
    const missing = [];
    if (!conversationId) missing.push('conversationId');
    if (!Number.isFinite(round)) missing.push('round');
    if (!Number.isFinite(pick)) missing.push('pick');
    if (!Array.isArray(p.userRoster)) missing.push('userRoster');
    if (!Array.isArray(p.availablePlayers)) missing.push('availablePlayers');
    if (!Number.isFinite(leagueSize)) missing.push('leagueSize');
    if (!Number.isFinite(pickSlot)) missing.push('pickSlot');
    if (missing.length) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    // Build Dify body (forced trigger)
    const query = "User's turn";
    const inputs = { action: 'users-turn', round, pick, userRoster, availablePlayers, leagueSize, pickSlot };

    // Byte-size log (warn/error only)
    const difyBodyForLog = { user, query, response_mode: 'streaming', inputs, conversation_id: conversationId };
    const bytes = bytesOf(difyBodyForLog);
    if (bytes >= 300_000) {
      console.error('[PAYLOAD][ALERT] /draft/user-turn bytes', { bytes, count: availablePlayers.length });
    } else if (bytes >= 150_000) {
      console.warn('[PAYLOAD][WARN] /draft/user-turn bytes',  { bytes, count: availablePlayers.length });
    }

    const result = await getDifyBufferedResponse('legacy', { query }, conversationId, 90_000);

    res.set('X-Backend-Timing', String(Date.now() - t0));
    res.set('X-Streamed', 'true');
    if (result?.conversationId) res.set('X-Conversation-Id', String(result.conversationId));

    if (!result?.success) {
      const isTimeout = result?.errorType === 'timeout' || result?.error?.includes('cloudflare');
      const status = isTimeout ? 504 : 502;
      const error = isTimeout ? (result?.error?.includes('cloudflare') ? 'cloudflare_timeout' : 'timeout') : 'upstream';
      return res.status(status).json({
        ok: false,
        error,
        message: result?.error || 'Unknown error',
        duration_ms: Date.now() - t0
      });
    }

    // Strip <think>...</think> tags from final answer
    let answer = result.data?.answer || null;
    if (answer) {
      answer = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    }

    return res.status(200).json({
      ok: true,
      conversationId: result.conversationId || null,
      answer,
      usage: result.data?.usage,
      duration_ms: Date.now() - t0
    });
  } catch (err) {
    const isAbort = err?.name === 'AbortError';
    return res.status(isAbort ? 504 : 502).json({
      ok: false,
      error: isAbort ? 'timeout' : 'handler_error',
      message: String(err),
      duration_ms: Date.now() - t0,
    });
  }
});

// POST /api/draft/analyze - Pick analysis endpoint
router.post('/analyze', async (req, res) => {
  const t0 = Date.now();
  res.setTimeout(120_000);
  
  try {
    const user           = req.body?.user || 'local-dev';
    const conversationId = req.body?.conversationId;
    const p              = req.body?.payload || {};

    // Map pickNumber -> pick
    const round          = Number(p.round);
    const pick           = p.pick != null ? Number(p.pick) : Number(p.pickNumber);
    const userRoster     = Array.isArray(p.userRoster) ? p.userRoster : [];
    const availablePlayers = Array.isArray(p.availablePlayers) ? p.availablePlayers : [];
    const leagueSize     = Number(p.leagueSize);
    const pickSlot       = Number(p.pickSlot);

    // Validation
    const missing = [];
    if (!conversationId) missing.push('conversationId');
    if (!Number.isFinite(round)) missing.push('round');
    if (!Number.isFinite(pick)) missing.push('pick');
    if (!Array.isArray(p.userRoster)) missing.push('userRoster');
    if (!Array.isArray(p.availablePlayers)) missing.push('availablePlayers');
    if (!Number.isFinite(leagueSize)) missing.push('leagueSize');
    if (!Number.isFinite(pickSlot)) missing.push('pickSlot');
    if (missing.length) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    // Build Dify body (forced trigger with analyze action)
    const query = "analyze";
    const inputs = { action: 'analyze', round, pick, userRoster, availablePlayers, leagueSize, pickSlot };

    // Byte-size log (warn/error only)
    const difyBodyForLog = { user, query, response_mode: 'streaming', inputs, conversation_id: conversationId };
    const bytes = bytesOf(difyBodyForLog);
    if (bytes >= 300_000) {
      console.error('[PAYLOAD][ALERT] /draft/analyze bytes', { bytes, count: availablePlayers.length });
    } else if (bytes >= 150_000) {
      console.warn('[PAYLOAD][WARN] /draft/analyze bytes',  { bytes, count: availablePlayers.length });
    }

    const result = await getDifyBufferedResponse('analyze', { query, round, pick, userRoster, availablePlayers, leagueSize, pickSlot }, conversationId, 90_000);

    res.set('X-Backend-Timing', String(Date.now() - t0));
    res.set('X-Streamed', 'true');
    if (result?.conversationId) res.set('X-Conversation-Id', String(result.conversationId));

    if (!result?.success) {
      const isTimeout = result?.errorType === 'timeout' || result?.error?.includes('cloudflare');
      const status = isTimeout ? 504 : 502;
      const error = isTimeout ? (result?.error?.includes('cloudflare') ? 'cloudflare_timeout' : 'timeout') : 'upstream';
      return res.status(status).json({
        ok: false,
        error,
        message: result?.error || 'Unknown error',
        duration_ms: Date.now() - t0
      });
    }

    // Strip <think>...</think> tags from final answer
    let answer = result.data?.answer || null;
    if (answer) {
      answer = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    }

    return res.status(200).json({
      ok: true,
      conversationId: result.conversationId || null,
      answer,
      usage: result.data?.usage,
      duration_ms: Date.now() - t0
    });
  } catch (err) {
    const isAbort = err?.name === 'AbortError';
    return res.status(isAbort ? 504 : 502).json({
      ok: false,
      error: isAbort ? 'timeout' : 'handler_error',
      message: String(err),
      duration_ms: Date.now() - t0,
    });
  }
});

// POST /api/draft/query - Query endpoint that preserves user input
router.post('/query', async (req, res) => {
  const t0 = Date.now();
  res.setTimeout(120_000);
  
  try {
    const user           = req.body?.user || 'local-dev';
    const conversationId = req.body?.conversationId;
    const p              = req.body?.payload || {};

    // Extract user query/message from supported locations
    let userQuery = req.body?.query ||
                   req.body?.payload?.query ||
                   req.body?.message ||
                   req.body?.payload?.message;

    // Map pickNumber -> pick
    const round          = Number(p.round);
    const pick           = p.pick != null ? Number(p.pick) : Number(p.pickNumber);
    const userRoster     = Array.isArray(p.userRoster) ? p.userRoster : [];
    const availablePlayers = Array.isArray(p.availablePlayers) ? p.availablePlayers : [];
    const leagueSize     = Number(p.leagueSize);
    const pickSlot       = Number(p.pickSlot);

    // Validation
    const missing = [];
    if (!conversationId) missing.push('conversationId');
    if (!userQuery) missing.push('query/message');
    if (!Number.isFinite(round)) missing.push('round');
    if (!Number.isFinite(pick)) missing.push('pick');
    if (!Array.isArray(p.userRoster)) missing.push('userRoster');
    if (!Array.isArray(p.availablePlayers)) missing.push('availablePlayers');
    if (!Number.isFinite(leagueSize)) missing.push('leagueSize');
    if (!Number.isFinite(pickSlot)) missing.push('pickSlot');
    if (missing.length) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    // Byte-size log (warn/error only)
    const difyBodyForLog = { user, query: userQuery, response_mode: 'streaming', inputs: { action: 'query', round, pick, userRoster, availablePlayers, leagueSize, pickSlot }, conversation_id: conversationId };
    const bytes = bytesOf(difyBodyForLog);
    if (bytes >= 300_000) {
      console.error('[PAYLOAD][ALERT] /draft/query bytes', { bytes, count: availablePlayers.length });
    } else if (bytes >= 150_000) {
      console.warn('[PAYLOAD][WARN] /draft/query bytes',  { bytes, count: availablePlayers.length });
    }

    const result = await getDifyBufferedResponse('query', { query: userQuery, round, pick, userRoster, availablePlayers, leagueSize, pickSlot }, conversationId, 90_000);

    res.set('X-Backend-Timing', String(Date.now() - t0));
    res.set('X-Streamed', 'true');
    if (result?.conversationId) res.set('X-Conversation-Id', String(result.conversationId));

    if (!result?.success) {
      const isTimeout = result?.errorType === 'timeout' || result?.error?.includes('cloudflare');
      const status = isTimeout ? 504 : 502;
      const error = isTimeout ? (result?.error?.includes('cloudflare') ? 'cloudflare_timeout' : 'timeout') : 'upstream';
      return res.status(status).json({
        ok: false,
        error,
        message: result?.error || 'Unknown error',
        duration_ms: Date.now() - t0
      });
    }

    // Strip <think>...</think> tags from final answer
    let answer = result.data?.answer || null;
    if (answer) {
      answer = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    }

    return res.status(200).json({
      ok: true,
      conversationId: result.conversationId || null,
      answer,
      usage: result.data?.usage,
      duration_ms: Date.now() - t0
    });
  } catch (err) {
    const isAbort = err?.name === 'AbortError';
    return res.status(isAbort ? 504 : 502).json({
      ok: false,
      error: isAbort ? 'timeout' : 'handler_error',
      message: String(err),
      duration_ms: Date.now() - t0,
    });
  }
});

// POST /api/_debug/init-raw - DEV-only Debug Route for Initialize Streaming
router.post('/_debug/init-raw', async (req, res) => {
  // Guard with NODE_ENV check
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    // Read same body as /api/draft/initialize
    const { user, payload } = req.body;
    
    if (!user || !payload) {
      return res.status(400).json({
        event: 'error',
        data: { error: 'Missing user or payload' }
      });
    }

    const { numTeams, userPickPosition, players, availablePlayers } = payload;
    
    // Construct exact Dify body
    const body = {
      user: user,
      response_mode: "streaming",
      query: "initialize",
      inputs: {
        action: "initialize",
        numTeams: numTeams,
        userPickPosition: userPickPosition,
        availablePlayers: availablePlayers || players || []
      }
    };

    // Set up AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort('timeout'), 235000);

    // Set NDJSON headers FIRST
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache,no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      // Upstream fetch
      const response = await fetch(DIFY_API_URL, {
        method: 'POST',
        headers: {
          'Accept': 'text/event-stream',
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + DIFY_SECRET_KEY
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        duplex: 'half'
      });

      clearTimeout(timeoutId);

      // Preflight check
      const status = response.status;
      const contentType = response.headers.get('content-type') || '';
      
      if (!response.ok || !contentType.includes('text/event-stream')) {
        // Read up to first 512 bytes of response body
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
        
        // Write one NDJSON error line
        const errorEvent = {
          event: "error",
          data: {
            error: "bad_upstream_status",
            status: status,
            contentType: contentType,
            bodyPreview: bodyPreview,
            hasUrl: !!DIFY_API_URL,
            hasKey: !!DIFY_SECRET_KEY
          }
        };
        
        res.write(JSON.stringify(errorEvent) + '\n');
        return res.end();
      }

      // Stream SSE → NDJSON
      const reader = response.body?.getReader();
      if (!reader) {
        const text = await response.text();
        res.write(JSON.stringify({ event: 'error', data: { error: 'no_reader', text } }) + '\n');
        return res.end();
      }

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // Process complete SSE events (split on \n\n)
          let sep;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const sseChunk = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            
            // Extract "data:" lines
            const lines = sseChunk.split('\n');
            const dataLines = lines
              .filter(l => l.startsWith('data:'))
              .map(l => l.slice(5).trim())
              .filter(Boolean);
              
            for (const payload of dataLines) {
              if (payload === '[DONE]') continue;
              
              try {
                const p = JSON.parse(payload);
                // For each JSON payload p, write {"event": p.event, "data": p}
                const ndjsonEvent = { event: p.event, data: p };
                res.write(JSON.stringify(ndjsonEvent) + '\n');
              } catch (parseError) {
                // Fallback for non-JSON data
                const ndjsonEvent = { event: 'text', data: payload };
                res.write(JSON.stringify(ndjsonEvent) + '\n');
              }
            }
          }
        }
      } catch (streamError) {
        if (streamError.name === 'AbortError') {
          const errorEvent = {
            event: 'error',
            data: { error: 'timeout', message: 'Stream timeout after 235s' }
          };
          res.write(JSON.stringify(errorEvent) + '\n');
        } else {
          const errorEvent = {
            event: 'error',
            data: { error: 'stream_error', message: streamError.message }
          };
          res.write(JSON.stringify(errorEvent) + '\n');
        }
      }

      res.end();

    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      // Extract error properties correctly
      const errorName = fetchError?.name || fetchError?.constructor?.name || 'Error';
      const errorCode = fetchError?.code || fetchError?.cause?.code || 'unknown';
      
      const errorEvent = {
        event: 'error',
        data: {
          error: 'fetch_error',
          name: errorName,
          code: errorCode,
          message: fetchError.message,
          hasUrl: !!DIFY_API_URL,
          hasKey: !!DIFY_SECRET_KEY
        }
      };
      
      res.write(JSON.stringify(errorEvent) + '\n');
      res.end();
    }

  } catch (error) {
    // Handle route-level errors
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/x-ndjson');
    }
    
    const errorName = error?.name || error?.constructor?.name || 'Error';
    const errorCode = error?.code || error?.cause?.code || 'unknown';
    
    const errorEvent = {
      event: 'error',
      data: {
        error: 'handler_error',
        name: errorName,
        code: errorCode,
        message: error.message
      }
    };
    
    res.write(JSON.stringify(errorEvent) + '\n');
    res.end();
  }
});

module.exports = router;