/**
 * Unified Dify API client with support for blocking, streaming, and buffered modes
 * Uses native fetch API with standardized error handling and observability
 */

const crypto = require('crypto');
const { TextDecoder } = require('util');

// Constants
const DIFY_API_URL = process.env.DIFY_API_URL || 'https://api.dify.ai/v1/chat-messages';
const DIFY_SECRET_KEY = process.env.DIFY_SECRET_KEY;

/**
 * TraceLogger class for observability and breadcrumb tracking
 */
class TraceLogger {
  /**
   * @param {string|null} traceId - Optional trace ID, generates UUID if not provided
   */
  constructor(traceId = null) {
    this.traceId = traceId || crypto.randomUUID();
    this.startTime = Date.now();
  }

  /**
   * Log a breadcrumb event with timestamp and elapsed time
   * @param {string} phase - Phase identifier
   * @param {Object} data - Additional data to log
   * @returns {Object} - Log entry object
   */
  breadcrumb(phase, data = {}) {
    const timestamp = Date.now();
    const elapsed = timestamp - this.startTime;
    const entry = { 
      traceId: this.traceId, 
      phase, 
      timestamp, 
      elapsed_ms: elapsed,
      ...data 
    };
    
    console.log(`[${this.traceId}] ${phase}`, entry);
    return entry;
  }

  /**
   * Log payload size warnings
   * @param {number} bytes - Payload size in bytes
   * @param {string} context - Context for the warning
   */
  payloadWarning(bytes, context = 'unknown') {
    if (bytes >= 300000) {
      console.error(`[${this.traceId}][PAYLOAD][ALERT]`, { bytes, context });
    } else if (bytes >= 150000) {
      console.warn(`[${this.traceId}][PAYLOAD][WARN]`, { bytes, context });
    }
  }

  /**
   * Log an error with compact formatting
   * @param {Error} error - Error object
   * @param {Object} context - Additional context
   */
  error(error, context = {}) {
    const compacted = this.compactError(error);
    console.error(`[${this.traceId}][ERROR]`, { 
      error: compacted, 
      elapsed_ms: Date.now() - this.startTime,
      ...context 
    });
  }

  /**
   * Compact error for logging (max 600 chars)
   * @param {Error} err - Error object
   * @param {number} max - Maximum length
   * @returns {string} - Compacted error string
   */
  compactError(err, max = 600) {
    const name = err?.name || 'Error';
    const msg = (err?.message || String(err)).toString();
    const stack = (err?.stack || '').split('\n')[1]?.trim() || '';
    const base = `${name}: ${msg}`;
    const trimmed = base.length > max ? (base.slice(0, max) + '… [truncated]') : base;
    return stack ? `${trimmed} | ${stack}` : trimmed;
  }

  /**
   * Get elapsed time since start
   * @returns {number} - Elapsed time in milliseconds
   */
  elapsed() {
    return Date.now() - this.startTime;
  }
}

/**
 * Build standardized headers for Dify API requests
 * @param {Object} options - Options object
 * @param {boolean} options.streaming - Whether this is a streaming request
 * @returns {Object} - Headers object
 */
function buildHeaders({ streaming = false } = {}) {
  const headers = {
    'Authorization': `Bearer ${DIFY_SECRET_KEY}`,
    'Content-Type': 'application/json'
  };
  
  if (streaming) {
    headers['Accept'] = 'text/event-stream';
    headers['Cache-Control'] = 'no-cache';
  }
  
  return headers;
}

/**
 * Unified Dify Client class with standardized error handling and observability
 */
class UnifiedDifyClient {
  constructor() {
    this.apiUrl = DIFY_API_URL;
    this.secretKey = DIFY_SECRET_KEY;
    
    // Validate configuration on construction
    if (!this.secretKey) {
      console.error('[DIFY] CRITICAL: DIFY_SECRET_KEY environment variable is not set');
      throw new Error('DIFY_SECRET_KEY environment variable is required');
    }
    
    if (!this.apiUrl) {
      console.error('[DIFY] CRITICAL: DIFY_API_URL is not set');
      throw new Error('DIFY_API_URL is required');
    }
    
    // Validate URL format
    try {
      new URL(this.apiUrl);
    } catch (urlError) {
      console.error('[DIFY] CRITICAL: Invalid DIFY_API_URL format:', this.apiUrl);
      throw new Error(`Invalid DIFY_API_URL format: ${this.apiUrl}`);
    }
  }

  /**
   * Build headers for requests
   * @param {boolean} streaming - Whether this is a streaming request
   * @returns {Object} - Headers object
   */
  buildHeaders(streaming = false) {
    return buildHeaders({ streaming });
  }

  /**
   * Send blocking request to Dify API
   * @param {Object} params - Request parameters
   * @param {Object} params.body - Request body (query, inputs, conversation_id, user)
   * @param {number} params.timeoutMs - Timeout in milliseconds
   * @param {AbortSignal} params.signal - Optional abort signal
   * @param {string} params.traceId - Optional trace ID
   * @returns {Promise<Object>} - Response object
   */
  async postBlocking({ body, timeoutMs, signal, traceId }) {
    const logger = new TraceLogger(traceId);
    const controller = signal || new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    logger.breadcrumb('dify_blocking_start', {
      timeoutMs,
      apiUrl: this.apiUrl,
      hasSecretKey: !!this.secretKey
    });
    
    // Validate inputs
    if (!body || typeof body !== 'object') {
      const error = new Error('Request body is required and must be an object');
      logger.error(error, { context: 'input_validation' });
      return this.mapError(error, timeoutMs, logger);
    }
    
    if (!timeoutMs || timeoutMs <= 0) {
      const error = new Error('timeoutMs must be a positive number');
      logger.error(error, { context: 'input_validation' });
      return this.mapError(error, timeoutMs || 15000, logger);
    }
    
    // Check payload size
    const bodyStr = JSON.stringify({ ...body, response_mode: 'blocking' });
    const bodyBytes = Buffer.byteLength(bodyStr, 'utf8');
    logger.payloadWarning(bodyBytes, 'blocking_request');
    
    try {
      logger.breadcrumb('dify_blocking_connect', {
        bodySize: bodyBytes,
        headers: Object.keys(this.buildHeaders(false))
      });
      
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: this.buildHeaders(false),
        body: bodyStr,
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      logger.breadcrumb('dify_blocking_response', {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers ? Object.fromEntries(response.headers.entries()) : 'no headers'
      });
      
      return await this.mapResponse(response, timeoutMs, logger);
    } catch (error) {
      clearTimeout(timeout);
      logger.error(error, {
        context: 'dify_blocking',
        apiUrl: this.apiUrl,
        errorCode: error.code,
        errorCause: error.cause
      });
      return this.mapError(error, timeoutMs, logger);
    }
  }

  /**
   * Send streaming request to Dify API
   * @param {Object} params - Request parameters
   * @param {Object} params.body - Request body (query, inputs, conversation_id, user)
   * @param {number} params.timeoutMs - Timeout in milliseconds
   * @param {AbortSignal} params.signal - Optional abort signal
   * @param {string} params.traceId - Optional trace ID
   * @returns {Promise<Object>} - Object with response, controller, and logger
   */
  async postStreaming({ body, timeoutMs, signal, traceId }) {
    const logger = new TraceLogger(traceId);
    const controller = signal || new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    // Add trace logging for initialize streaming
    if (body && body.inputs && body.inputs.action === 'initialize') {
      console.info('[TRACE_INIT] path=client');
    }
    
    logger.breadcrumb('dify_streaming_start', { timeoutMs });
    
    // Check payload size
    const bodyStr = JSON.stringify({ ...body, response_mode: 'streaming' });
    const bodyBytes = Buffer.byteLength(bodyStr, 'utf8');
    logger.payloadWarning(bodyBytes, 'streaming_request');
    
    try {
      logger.breadcrumb('dify_streaming_connect');
      
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: this.buildHeaders(true),
        body: bodyStr,
        signal: controller.signal,
        duplex: 'half'
      });
      
      clearTimeout(timeout);
      logger.breadcrumb('dify_streaming_response', { status: response.status });
      
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        const error = this.mapResponseError(response, bodyText, logger);
        throw error;
      }
      
      logger.breadcrumb('dify_streaming_success');
      return { response, controller, logger };
    } catch (error) {
      clearTimeout(timeout);
      logger.error(error, { context: 'dify_streaming' });
      throw this.mapError(error, timeoutMs, logger);
    }
  }

  /**
   * Send streaming request and buffer the response to a single JSON object
   * This maintains the current streaming→buffer behavior exactly
   * @param {Object} params - Request parameters
   * @param {Object} params.body - Request body (query, inputs, conversation_id, user)
   * @param {number} params.timeoutMs - Timeout in milliseconds
   * @param {AbortSignal} params.signal - Optional abort signal
   * @param {string} params.traceId - Optional trace ID
   * @returns {Promise<Object>} - Buffered response object
   */
  async postStreamingBuffered({ body, timeoutMs, signal, traceId }) {
    const logger = new TraceLogger(traceId);
    
    try {
      const { response, controller } = await this.postStreaming({ body, timeoutMs, signal, traceId });
      
      logger.breadcrumb('dify_buffering_start');
      
      if (!response.body) {
        throw new Error('No response body from Dify API');
      }

      // Consume SSE stream and accumulate final text
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalAnswer = '';
      let finalConversationId = body.conversation_id;
      let messageId = null;
      let chunkCount = 0;
      let eventCounts = {};

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            logger.breadcrumb('dify_buffering_complete', { chunkCount, finalAnswerLength: finalAnswer.length });
            break;
          }
          
          chunkCount++;
          if (chunkCount === 1) {
            logger.breadcrumb('dify_first_chunk');
          }
          
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          
          // Process complete SSE messages
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                
                // Count event types
                eventCounts[data.event] = (eventCounts[data.event] || 0) + 1;
                
                // Handle different event types
                if (data.event === 'message') {
                  const chunk = data.answer || '';
                  if (chunk) {
                    finalAnswer += chunk;
                  }
                  finalConversationId = data.conversation_id || finalConversationId;
                  messageId = data.id || messageId;
                } else if (data.event === 'agent_message') {
                  const chunk = data.answer || '';
                  if (chunk) {
                    finalAnswer += chunk;
                  }
                } else if (data.event === 'agent_thought') {
                  // Some Dify implementations put the answer in agent_thought events
                  if (data.thought && !finalAnswer) {
                    finalAnswer = data.thought;
                  }
                } else if (data.event === 'message_end') {
                  // Stream completed successfully
                  break;
                } else if (data.event === 'error') {
                  throw new Error(`Dify stream error: ${data.message || 'Unknown error'}`);
                }
              } catch (parseError) {
                // Skip malformed JSON lines
                logger.breadcrumb('dify_parse_error', { line: line.slice(0, 100) });
              }
            }
          }
        }
      } catch (streamError) {
        if (streamError.name === 'AbortError') {
          throw new Error('Stream timeout after ' + timeoutMs + 'ms');
        }
        throw streamError;
      }

      // Strip <think>...</think> tags from final answer
      if (finalAnswer) {
        finalAnswer = finalAnswer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      }

      logger.breadcrumb('dify_buffering_success', { 
        eventCounts, 
        finalAnswerLength: finalAnswer.length,
        duration: logger.elapsed()
      });

      return {
        ok: true,
        data: {
          answer: finalAnswer,
          conversation_id: finalConversationId,
          id: messageId,
          event: 'message'
        },
        conversationId: finalConversationId,
        traceId: logger.traceId,
        duration_ms: logger.elapsed()
      };

    } catch (error) {
      logger.error(error, { context: 'dify_buffering' });
      
      // Determine appropriate error type
      let errorType = 'stream_error';
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        errorType = 'timeout';
      } else if (error.message.includes('buffer overflow')) {
        errorType = 'buffer_overflow';
      }
      
      return {
        ok: false,
        error: errorType,
        message: error.message,
        traceId: logger.traceId,
        duration_ms: logger.elapsed()
      };
    }
  }

  /**
   * Map successful response to standardized format
   * @param {Response} response - Fetch response object
   * @param {number} timeoutMs - Timeout that was used
   * @param {TraceLogger} logger - Logger instance
   * @returns {Promise<Object>} - Mapped response object
   */
  async mapResponse(response, timeoutMs, logger) {
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      return this.mapResponseError(response, bodyText, logger);
    }
    
    const data = await response.json();
    logger.breadcrumb('dify_blocking_success', { conversationId: data.conversation_id });
    
    return {
      ok: true,
      data,
      conversationId: data.conversation_id,
      traceId: logger.traceId,
      duration_ms: logger.elapsed()
    };
  }

  /**
   * Map response errors to standardized format
   * @param {Response} response - Fetch response object
   * @param {string} bodyText - Response body text
   * @param {TraceLogger} logger - Logger instance
   * @returns {Object} - Standardized error response
   */
  mapResponseError(response, bodyText, logger) {
    const bodySnippet = bodyText.slice(0, 600);
    
    // Handle conversation not found specifically
    if (response.status === 404 && bodyText.toLowerCase().includes('conversation')) {
      logger.breadcrumb('dify_error_invalid_conversation', { status: 404 });
      return {
        ok: false,
        status: 409,
        error: 'invalid_conversation',
        message: 'Conversation not found or invalid',
        traceId: logger.traceId,
        duration_ms: logger.elapsed(),
        upstreamStatus: response.status,
        bodySnippet
      };
    }
    
    // Handle other upstream errors
    const status = response.status >= 500 ? 502 : 400;
    const error = response.status >= 500 ? 'upstream_error' : 'bad_request';
    
    logger.breadcrumb('dify_error_upstream', { originalStatus: response.status, mappedStatus: status });
    
    return {
      ok: false,
      status,
      error,
      message: `Upstream error: ${response.status} ${response.statusText}`,
      traceId: logger.traceId,
      duration_ms: logger.elapsed(),
      upstreamStatus: response.status,
      bodySnippet
    };
  }

  /**
   * Map network/timeout errors to standardized format
   * @param {Error} error - Error object
   * @param {number} timeoutMs - Timeout that was used
   * @param {TraceLogger} logger - Logger instance
   * @returns {Object} - Standardized error response
   */
  mapError(error, timeoutMs, logger) {
    // Log detailed error information for debugging
    logger.breadcrumb('dify_network_error_details', {
      errorName: error.name,
      errorMessage: error.message,
      errorCode: error.code,
      errorStack: error.stack?.split('\n')[0] || 'no stack',
      timeoutMs
    });
    
    if (error.name === 'AbortError') {
      logger.breadcrumb('dify_error_timeout', { timeoutMs });
      return {
        ok: false,
        status: 504,
        error: 'timeout',
        message: `Request timeout after ${timeoutMs}ms`,
        traceId: logger.traceId,
        duration_ms: logger.elapsed()
      };
    }
    
    // Handle specific network error types
    if (error.code === 'ECONNREFUSED') {
      logger.breadcrumb('dify_error_connection_refused');
      return {
        ok: false,
        status: 502,
        error: 'upstream_error',
        message: 'Could not connect to Dify API - connection refused',
        traceId: logger.traceId,
        duration_ms: logger.elapsed(),
        details: { networkError: 'ECONNREFUSED', difyUrl: this.apiUrl }
      };
    }
    
    if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
      logger.breadcrumb('dify_error_dns');
      return {
        ok: false,
        status: 502,
        error: 'upstream_error',
        message: 'DNS resolution failed for Dify API',
        traceId: logger.traceId,
        duration_ms: logger.elapsed(),
        details: { networkError: error.code, difyUrl: this.apiUrl }
      };
    }
    
    if (error.message?.includes('fetch')) {
      logger.breadcrumb('dify_error_fetch_failed');
      return {
        ok: false,
        status: 502,
        error: 'upstream_error',
        message: 'Network request to Dify API failed',
        traceId: logger.traceId,
        duration_ms: logger.elapsed(),
        details: { fetchError: error.message, difyUrl: this.apiUrl }
      };
    }
    
    logger.breadcrumb('dify_error_unknown_network');
    
    return {
      ok: false,
      status: 502,
      error: 'upstream_error',
      message: `Network error: ${error.message}`,
      traceId: logger.traceId,
      duration_ms: logger.elapsed(),
      details: { unknownError: error.message, difyUrl: this.apiUrl }
    };
  }
}

// Create singleton instance
const unifiedClient = new UnifiedDifyClient();

// ============================================================================
// BACKWARD COMPATIBILITY WRAPPERS
// ============================================================================

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

    case 'analyze':
      // Apply payload trimming for performance optimization
      const trimmedPickPayload = trimAvailablePlayersIfNeeded(payload);
      const { round: analysisRound, pick: analysisPick, userRoster: analysisUserRoster, availablePlayers: analysisAvailablePlayers, leagueSize, pickSlot } = trimmedPickPayload;
      return `Current draft status - Round ${analysisRound}, Pick ${analysisPick}

League context:
- League size: ${leagueSize} teams
- My pick slot: ${pickSlot}

My current roster: ${JSON.stringify(analysisUserRoster)}
Available players (top options): ${JSON.stringify(analysisAvailablePlayers)}

Please provide a comprehensive analysis of my current draft position, roster strengths and weaknesses, and strategic recommendations for upcoming picks.`;

    case 'query':
      // Apply payload trimming for performance optimization
      const trimmedQueryPayload = trimAvailablePlayersIfNeeded(payload);
      const { query: userQuery, round: queryRound, pick: queryPick, userRoster: queryUserRoster, availablePlayers: queryAvailablePlayers, leagueSize: queryLeagueSize, pickSlot: queryPickSlot } = trimmedQueryPayload;
      return `User query: "${userQuery}"

Current draft status - Round ${queryRound}, Pick ${queryPick}

League context:
- League size: ${queryLeagueSize} teams
- My pick slot: ${queryPickSlot}

My current roster: ${JSON.stringify(queryUserRoster)}
Available players (top options): ${JSON.stringify(queryAvailablePlayers)}

Please respond to the user's query while considering the current draft context and providing relevant analysis and recommendations.`;
      
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
    
    const requestBody = {
      inputs: {},
      query: message,
      conversation_id: conversationId,
      user: "fantasy-draft-user"
    };

    const result = await unifiedClient.postBlocking({
      body: requestBody,
      timeoutMs: timeout
    });

    if (result.ok) {
      return {
        success: true,
        data: result.data,
        conversationId: result.conversationId
      };
    } else {
      return {
        success: false,
        error: result.message
      };
    }

  } catch (error) {
    console.error('[error]', unifiedClient.compactError ? unifiedClient.compactError(error) : error.message);
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

  try {
    // Build request payload with structured inputs for initialize
    const isInitialize = action === 'initialize';
    
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
        inputs: initInputs,
        query: 'Initialize draft strategy given these inputs.'
      };
    } else {
      const message = buildDifyMessage(action, payload);
      difyPayload = {
        user: process.env.DIFY_USER || user || "fantasy-draft-user",
        conversation_id: conversationId || undefined,
        inputs: {},
        query: message
      };
    }

    sendPhase('calling_upstream');

    const { response } = await unifiedClient.postStreaming({
      body: difyPayload,
      timeoutMs,
      signal: connectController.signal
    });

    clearTimeout(connectWatchdog);
    clearTimeout(timeout);

    sendPhase('upstream_response', { status: response.status, ok: response.ok });

    // Stream the response directly
    const reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      sendPhase('upstream_chunk', { size: value?.length || 0 });
      res.write(value);
    }

    sendPhase('upstream_end');
    res.write('event: done\ndata: {}\n\n');

  } catch (err) {
    clearTimeout(connectWatchdog);
    clearTimeout(timeout);
    
    if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: String(err), retryable: false })}\n\n`);
    }
  } finally {
    cleanupAndEnd();
  }
}

/**
 * Server-side streaming buffer helper that consumes SSE from Dify and returns single JSON response
 * @param {string} action - Action type for timeout calculation
 * @param {Object} payload - Request payload
 * @param {string|null} conversationId - Conversation ID for context
 * @param {number} timeoutMs - Timeout in milliseconds (default 295s)
 * @returns {Promise<Object>} - Single JSON response with accumulated text
 */
async function getDifyBufferedResponse(action, payload, conversationId = null, timeoutMs = 295000) {
  const message = buildDifyMessage(action, payload);
  
  const requestBody = {
    inputs: {},
    query: message,
    conversation_id: conversationId,
    user: "fantasy-draft-user"
  };

  const result = await unifiedClient.postStreamingBuffered({
    body: requestBody,
    timeoutMs
  });

  // Map to legacy format
  if (result.ok) {
    return {
      success: true,
      data: result.data,
      conversationId: result.conversationId,
      duration: result.duration_ms
    };
  } else {
    return {
      success: false,
      error: result.message,
      errorType: result.error,
      duration: result.duration_ms
    };
  }
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
  const payload = {
    inputs: inputs || {},
    query: query,
    user: user || "fantasy-draft-user",
    conversation_id: conversationId || undefined
  };

  const result = await unifiedClient.postStreaming({
    body: payload,
    timeoutMs: 240000  // Default timeout
  });

  return { response: result.response, controller: result.controller };
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
  const payload = {
    inputs: inputs || {},
    query: query,
    user: user || "fantasy-draft-user",
    conversation_id: conversationId || undefined
  };

  const result = await unifiedClient.postBlocking({
    body: payload,
    timeoutMs
  });

  if (result.ok) {
    return {
      ok: true,
      data: result.data,
      conversationId: result.conversationId
    };
  } else {
    return {
      ok: false,
      status: result.status,
      message: result.message
    };
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

// ============================================================================
// SERVER STARTUP LOGGING
// ============================================================================

// Log Dify configuration on first import
console.info('[DIFY]', { 
  url: DIFY_API_URL, 
  keyPrefix: DIFY_SECRET_KEY?.slice(0, 4) + '…' 
});

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // New unified exports
  DIFY_API_URL,
  buildHeaders,
  UnifiedDifyClient,
  TraceLogger,
  
  // Backward compatibility exports
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
  getDifyBlockingResponse,
  getDifyBufferedResponse
};