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

// POST /api/draft/initialize - Server-side streaming buffer endpoint
router.post('/initialize', async (req, res) => {
  const startTime = Date.now();
  
  // Set timeout for the entire request (320s)
  res.setTimeout(320000);
  
  try {
    const { user, conversationId, payload } = req.body;

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

    // Use streaming buffer approach with 295s timeout
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

module.exports = router;