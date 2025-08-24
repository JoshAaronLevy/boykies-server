/**
 * Dify API client with support for both blocking and streaming modes
 * Uses native fetch API instead of axios for streaming support
 */

const { TextDecoder } = require('util');

// Local compactError function to avoid cross-file import
function compactError(err, max = 600) {
  const name = err?.name || 'Error';
  const msg = (err?.message || String(err)).toString();
  const stack = (err?.stack || '').split('\n')[1]?.trim() || '';
  const base = `${name}: ${msg}`;
  const trimmed = base.length > max ? (base.slice(0, max) + '… [truncated]') : base;
  return stack ? `${trimmed} | ${stack}` : trimmed;
}

/**
 * Trim availablePlayers array if it exceeds the configured maximum
 * @param {Object} payload - Payload object that may contain availablePlayers
 * @returns {Object} - Payload with trimmed availablePlayers if needed
 */
function trimAvailablePlayersIfNeeded(payload) {
  if (!payload || !payload.availablePlayers || !Array.isArray(payload.availablePlayers)) {
    return payload;
  }
  
  const maxPlayers = Number(process.env.MAX_AVAILABLE_PLAYERS || 200);
  
  if (payload.availablePlayers.length > maxPlayers) {
    const originalLength = payload.availablePlayers.length;
    const trimmedPayload = { ...payload };
    trimmedPayload.availablePlayers = payload.availablePlayers.slice(0, maxPlayers);
    console.log('[STREAM] trimmed-available-players', {
      from: originalLength,
      to: trimmedPayload.availablePlayers.length
    });
    return trimmedPayload;
  }
  
  return payload;
}

/**
 * Slim players array for initialize action to reduce payload size
 * @param {Array} players - Array of player objects
 * @param {Object} options - Configuration options
 * @returns {Array} - Array of slimmed player objects
 */
function slimPlayers(players, {
  allowed = (process.env.PLAYER_ALLOWED_FIELDS || 'id,name,position,team,byeWeek,adp').split(','),
  max = Number(process.env.MAX_INIT_PLAYERS || 200),
  maxStr = Number(process.env.MAX_STRING_LEN || 200)
} = {}) {
  if (!Array.isArray(players)) return [];
  const take = players.slice(0, max);
  return take.map(p => {
    const slim = {};
    for (const k of allowed) {
      if (p != null && Object.prototype.hasOwnProperty.call(p, k)) {
        let v = p[k];
        if (typeof v === 'string' && v.length > maxStr) v = v.slice(0, maxStr);
        slim[k] = v;
      }
    }
    return slim;
  });
}

/**
 * Log JSON size for debugging purposes
 * @param {any} obj - Object to measure
 * @param {string} label - Label for the log
 */
function logJsonSizeBE(obj, label) {
  if (process.env.DIFY_DEBUG === '1') {
    try {
      const sizeKB = (JSON.stringify(obj).length / 1024).toFixed(2);
      console.log(`[SIZE] ${label}: ${sizeKB} KB`);
    } catch (err) {
      console.log(`[SIZE] ${label}: <unable to stringify>`);
    }
  }
}

/**
 * Map action types to appropriate Dify message content
 * @param {string} action - Action type (initialize, reset, player-taken, user-turn)
 * @param {Object} payload - Action payload
 * @returns {string} - Formatted message for Dify
 */
function buildDifyMessage(action, payload) {
  switch (action) {
    case 'legacy':
      // For backward compatibility with existing sendToDify calls
      return payload.query;
      
    case 'reset':
      return payload.message || "Draft reset - starting over.";
      
    case 'initialize':
      const { numTeams, userPickPosition, players } = payload;
      // Apply players slimming for initialize action only
      const slimmedPlayers = slimPlayers(players);
      logJsonSizeBE(players, 'BE received initialize players (raw)');
      logJsonSizeBE(slimmedPlayers, 'BE slimmed initialize players');
      
      return `Fantasy football draft is beginning. League details:
- Number of teams: ${numTeams}
- My draft position: ${userPickPosition}
- Available players: ${JSON.stringify(slimmedPlayers)}

Please create an in-depth draft strategy for this league setup.`;

    case 'player-taken':
      const { player, round, pick } = payload;
      return `Player taken: ${JSON.stringify(player)} in round ${round}, pick ${pick}.`;
      
    case 'user-turn':
      // Apply payload trimming for performance optimization
      const trimmedPayload = trimAvailablePlayersIfNeeded(payload);
      const { player: takenPlayer, round: currentRound, pick: currentPick, userRoster, availablePlayers } = trimmedPayload;
      return `Player taken: ${JSON.stringify(takenPlayer)} in round ${currentRound}, pick ${currentPick}.

IT'S MY TURN NOW!

My current roster: ${JSON.stringify(userRoster)}
Available players (top options): ${JSON.stringify(availablePlayers)}

Please provide your analysis and recommendations for my next pick.`;
      
    default:
      throw new Error(`Unknown action type: ${action}`);
  }
}

/**
 * Get timeout for action type
 * @param {string} action - Action type
 * @param {boolean} streaming - Whether this is a streaming request
 * @returns {number} - Timeout in milliseconds
 */
function getActionTimeout(action, streaming = false) {
  let isUserTurn = false;
  
  if (action === 'legacy') {
    // For legacy calls, check the payload
    isUserTurn = false; // Will be overridden by sendToDifyBlocking if payload.isUserTurn is true
  } else {
    const userTurnActions = ['user-turn'];
    isUserTurn = userTurnActions.includes(action);
  }
  
  if (streaming) {
    const streamingUserTimeout = Number(process.env.LLM_REQUEST_TIMEOUT_MS) || 240000;
    const streamingOtherTimeout = streamingUserTimeout * 2; // 8 minutes for other operations
    return isUserTurn ? streamingUserTimeout : streamingOtherTimeout;
  } else {
    // Existing blocking timeouts
    return isUserTurn ? 120000 : 360000;
  }
}

/**
 * Send blocking request to Dify API (legacy mode)
 * @param {string} action - Action type
 * @param {Object} payload - Request payload
 * @param {string|null} conversationId - Conversation ID for context
 * @returns {Promise<Object>} - Response object
 */
async function sendToDifyBlocking(action, payload, conversationId = null) {
  try {
    const message = buildDifyMessage(action, payload);
    
    // Handle legacy timeout detection
    let timeout = getActionTimeout(action, false);
    if (action === 'legacy' && payload.isUserTurn) {
      timeout = 120000; // 2 minutes for user turn
    } else if (action === 'legacy') {
      timeout = 360000; // 6 minutes for others
    }
    
    const requestPayload = {
      inputs: {},
      query: message,
      response_mode: "blocking",
      conversation_id: conversationId,
      user: "fantasy-draft-user"
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(process.env.DIFY_API_URL || 'https://api.dify.ai/v1/chat-messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.DIFY_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Dify API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return {
      success: true,
      data: data,
      conversationId: data.conversation_id
    };

  } catch (error) {
    // console.error('Dify API Error:', error.message);
    console.error('[error]', compactError(error));
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Send streaming request to Dify API with native fetch
 * @param {Object} req - Express request object for abort handling
 * @param {Object} res - Express response object for direct streaming
 * @param {Function} cleanupAndEnd - Cleanup function that handles heartbeat, timeouts, and response ending
 * @param {string} action - Action type
 * @param {Object} payload - Request payload
 * @param {string} user - User identifier
 * @param {string|null} conversationId - Conversation ID for context
 * @returns {Promise<void>} - Streams directly to response
 */
async function sendToDifyStreaming(req, res, cleanupAndEnd, action, payload, user, conversationId = null) {
  // Helper to send phase breadcrumbs
  const sendPhase = (step, extra) => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'phase', step, ...(extra || {}) })}\n\n`);
    } catch {}
  };

  // Enhanced validation for initialize action
  if (action === 'initialize') {
    const missing = [];
    if (payload?.numTeams == null) missing.push('numTeams');
    if (payload?.userPickPosition == null) missing.push('userPickPosition');
    if (!Array.isArray(payload?.players)) missing.push('players');

    if (missing.length) {
      res.write(`event: error\ndata: ${JSON.stringify({
        message: `Initialize requires: ${missing.join(', ')}`,
        hint: { action: 'initialize', payload: { numTeams: 12, userPickPosition: 4, players: [{ name: 'Test', position: 'RB' }] } }
      })}\n\n`);
      cleanupAndEnd();
      return;
    }
    sendPhase('validated_ok');
  }

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
    // Build request payload with structured inputs for initialize
    const isInitialize = action === 'initialize';
    const maxInitPlayers = Number(process.env.MAX_INIT_PLAYERS || 200);
    
    let difyPayload;
    if (isInitialize) {
      // Log original payload size for debugging
      logJsonSizeBE(payload, 'BE received initialize body');
      
      // Apply players slimming for better performance
      const slimmedPlayers = slimPlayers(payload?.players);
      
      const initInputs = {
        numTeams: payload?.numTeams,
        userPickPosition: payload?.userPickPosition,
        players: slimmedPlayers
      };
      
      // Log slimmed payload size for debugging
      logJsonSizeBE(initInputs, 'BE upstream Dify body (initialize)');
      
      difyPayload = {
        user: process.env.DIFY_USER || user || "fantasy-draft-user",
        conversation_id: conversationId || undefined,
        response_mode: "streaming",
        inputs: initInputs,
        query: 'Initialize draft strategy given these inputs.'
      };
    } else {
      const message = buildDifyMessage(action, payload);
      difyPayload = {
        user: process.env.DIFY_USER || user || "fantasy-draft-user",
        conversation_id: conversationId || undefined,
        response_mode: "streaming",
        inputs: {},
        query: message
      };
    }

    sendPhase('calling_upstream');

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
    console.log('[STREAM] upstream-start', { status: upstream.status });
    sendPhase('upstream_response', { status: upstream.status, ok: upstream.ok });

    // Surface upstream errors as SSE instead of throwing
    if (!upstream.body) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: 'Upstream had no body', status: upstream.status })}\n\n`);
      cleanupAndEnd();
      return;
    }
    
    if (!upstream.ok) {
      let errText = '';
      try { errText = await upstream.text(); } catch {}
      res.write(`event: error\ndata: ${JSON.stringify({
        message: `Upstream ${upstream.status} ${upstream.statusText}`,
        status: upstream.status,
        body: (errText || '').slice(0, 500)
      })}\n\n`);
      cleanupAndEnd();
      return;
    }

    const reader = upstream.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      sendPhase('upstream_chunk', { size: value?.length || 0 });
      res.write(value);
    }

    sendPhase('upstream_end');
    res.write('event: done\ndata: {}\n\n');
    console.log('[STREAM] upstream-end');

  } catch (err) {
    console.log('[STREAM] upstream-error', { error: String(err) });
    if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: String(err), retryable: false })}\n\n`);
    }
  } finally {
    clearTimeout(timeout);
    cleanupAndEnd();
  }
}

/**
 * Normalize user-turn payload to handle common field aliases
 * @param {Object} payload - Raw payload object
 * @returns {Object} - Normalized payload with standard field names
 */
function normalizeUserTurnPayload(payload = {}) {
  const p = { ...payload };
  p.player           ||= payload.targetPlayer || payload.selection || null;
  p.round             = Number(payload.round ?? payload.currentRound ?? payload.draftRound ?? NaN);
  p.pick              = Number(payload.pick  ?? payload.currentPick  ?? payload.overallPick ?? NaN);
  p.userRoster       ||= payload.roster || payload.myTeam || [];
  p.availablePlayers ||= payload.players || payload.pool || payload.visiblePlayers || [];
  return p;
}

/**
 * Validate streaming request payload
 * @param {Object} reqBody - Request body
 * @returns {Object} - Validated payload with action and data
 */
function validateStreamingRequest(reqBody) {
  const { action, conversationId, payload } = reqBody;
  
  if (!action) {
    throw new Error('Missing required field: action');
  }
  
  if (!['initialize', 'reset', 'player-taken', 'user-turn', 'legacy'].includes(action)) {
    throw new Error(`Invalid action: ${action}`);
  }
  
  if (!payload) {
    throw new Error('Missing required field: payload');
  }
  
  // Validate payload based on action
  switch (action) {
    case 'legacy':
      // Legacy action just needs a query
      if (!payload.query) {
        throw new Error('Legacy action requires: query');
      }
      break;
      
    case 'initialize':
      const { numTeams, userPickPosition, players } = payload;
      if (!numTeams || !userPickPosition || !players) {
        throw new Error('Initialize action requires: numTeams, userPickPosition, players');
      }
      break;
      
    case 'player-taken':
      const { player, round, pick } = payload;
      if (!player || !round || !pick) {
        throw new Error('Player-taken action requires: player, round, pick');
      }
      break;
      
    case 'user-turn':
      // Normalize payload to handle field aliases
      const normalizedPayload = normalizeUserTurnPayload(payload);
      
      // Strict validation after normalization
      const missing = [];
      if (!normalizedPayload.player) missing.push('player');
      if (!Number.isFinite(normalizedPayload.round)) missing.push('round');
      if (!Number.isFinite(normalizedPayload.pick)) missing.push('pick');
      if (!Array.isArray(normalizedPayload.userRoster) || normalizedPayload.userRoster.length === 0) missing.push('userRoster');
      if (!Array.isArray(normalizedPayload.availablePlayers) || normalizedPayload.availablePlayers.length === 0) missing.push('availablePlayers');
      
      if (missing.length > 0) {
        const error = new Error('User-turn action requires: ' + missing.join(', '));
        error.retryable = false;
        throw error;
      }
      
      // Update the payload with normalized values for downstream use
      Object.assign(payload, normalizedPayload);
      break;
      
    case 'reset':
      // Reset only needs optional message
      break;
  }
  
  return { action, conversationId, payload };
}

/**
 * Simple test helper for blocking requests (sends "Hello" message)
 * @returns {Promise<Object>} - Response object
 */
async function sendTestMessageBlocking() {
  return await sendToDifyBlocking('legacy', { query: 'Hello' });
}

/**
 * Simple test helper for streaming requests (sends "Hello" message)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} cleanupAndEnd - Cleanup function
 * @returns {Promise<void>} - Streams directly to response
 */
async function sendTestMessageStreaming(req, res, cleanupAndEnd) {
  return await sendToDifyStreaming(req, res, cleanupAndEnd, 'legacy', { query: 'Hello' }, 'test-user');
}

/**
 * Streaming helper returning a Response and an AbortController
 * @param {Object} params - Parameters object
 * @param {string} params.action - Action type
 * @param {string} params.query - Query string
 * @param {Object} params.inputs - Inputs object
 * @param {string} params.user - User identifier
 * @param {string|null} params.conversationId - Conversation ID
 * @returns {Promise<{response: Response, controller: AbortController}>}
 */
async function getDifyStreamingResponse({ action, query, inputs, user, conversationId }) {
  const controller = new AbortController();
  
  const payload = {
    inputs: inputs || {},
    query: query,
    user: user || "fantasy-draft-user",
    conversation_id: conversationId || undefined,
    response_mode: "streaming"
  };

  const response = await fetch(process.env.DIFY_API_URL || 'https://api.dify.ai/v1/chat-messages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.DIFY_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: controller.signal
  });

  return { response, controller };
}

/**
 * Blocking helper returning parsed JSON
 * @param {Object} params - Parameters object
 * @param {string} params.action - Action type
 * @param {string} params.query - Query string
 * @param {Object} params.inputs - Inputs object
 * @param {string} params.user - User identifier
 * @param {string|null} params.conversationId - Conversation ID
 * @param {number} params.timeoutMs - Timeout in milliseconds
 * @returns {Promise<Object>} - Parsed JSON or shaped error object
 */
async function getDifyBlockingResponse({ action, query, inputs, user, conversationId, timeoutMs = 15000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const payload = {
      inputs: inputs || {},
      query: query,
      user: user || "fantasy-draft-user",
      conversation_id: conversationId || undefined,
      response_mode: "blocking"
    };

    const response = await fetch(process.env.DIFY_API_URL || 'https://api.dify.ai/v1/chat-messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.DIFY_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: `Dify API error: ${response.status} ${response.statusText}`
      };
    }

    const data = await response.json();
    return {
      ok: true,
      data: data,
      conversationId: data.conversation_id
    };

  } catch (error) {
    clearTimeout(timeout);
    console.error('[error]', compactError(error));
    return {
      ok: false,
      status: error.name === 'AbortError' ? 408 : 500,
      message: error.message
    };
  }
}

module.exports = {
  sendToDifyBlocking,
  sendToDifyStreaming,
  validateStreamingRequest,
  normalizeUserTurnPayload,
  buildDifyMessage,
  getActionTimeout,
  trimAvailablePlayersIfNeeded,
  slimPlayers,
  logJsonSizeBE,
  sendTestMessageBlocking,
  sendTestMessageStreaming,
  getDifyStreamingResponse,
  getDifyBlockingResponse
};