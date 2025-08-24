/**
 * Server-Sent Events (SSE) utilities for streaming responses
 */

/**
 * Setup SSE response headers and disable buffering
 * @param {Object} res - Express response object
 */
function setupSSEResponse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Disable nginx buffering for streaming responses
  // This header tells nginx not to buffer the response, allowing real-time streaming
  res.setHeader('X-Accel-Buffering', 'no');
}

/**
 * Send an SSE event to the client
 * @param {Object} res - Express response object
 * @param {string} event - Event type (optional)
 * @param {string|Object} data - Data to send
 */
function sendSSEEvent(res, event, data) {
  if (res.writableEnded) return;
  
  let message = '';
  if (event) {
    message += `event: ${event}\n`;
  }
  
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
  message += `data: ${dataStr}\n\n`;
  
  res.write(message);
}

/**
 * Send a heartbeat comment to keep connection alive
 * @param {Object} res - Express response object
 */
function sendHeartbeat(res) {
  if (res.writableEnded) return;
  res.write(': keep-alive\n\n');
}

/**
 * Send an error event and end the stream
 * @param {Object} res - Express response object
 * @param {Error|string} error - Error to send
 * @param {boolean} retryable - Whether the error is retryable
 */
function sendSSEError(res, error, retryable = false) {
  if (res.writableEnded) return;
  
  const errorData = {
    message: error.message || String(error),
    retryable: retryable
  };
  
  sendSSEEvent(res, 'error', errorData);
}

/**
 * Send completion event
 * @param {Object} res - Express response object
 * @param {Object} data - Completion data (optional)
 */
function sendSSEComplete(res, data = {}) {
  if (res.writableEnded) return;
  sendSSEEvent(res, 'done', data);
}

/**
 * Setup heartbeat interval for keeping connection alive
 * @param {Object} res - Express response object
 * @param {number} intervalMs - Heartbeat interval in milliseconds
 * @returns {number} Timer ID for cleanup with clearInterval
 */
function setupHeartbeat(res, intervalMs = 20000) {
  const heartbeatTimer = setInterval(() => {
    sendHeartbeat(res);
  }, intervalMs);
  
  return heartbeatTimer;
}

/**
 * Setup abort handling for client disconnect
 * @param {Object} req - Express request object
 * @param {AbortController} controller - Abort controller to signal
 * @param {Function} cleanup - Cleanup function to call on abort
 */
function setupAbortHandling(req, controller, cleanup) {
  req.on('close', () => {
    controller.abort();
    cleanup();
  });
}

/**
 * Create timeout that aborts the controller
 * @param {AbortController} controller - Abort controller
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Function} Cleanup function to clear timeout
 */
function setupTimeout(controller, timeoutMs) {
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return () => clearTimeout(timeout);
}

module.exports = {
  setupSSEResponse,
  sendSSEEvent,
  sendHeartbeat,
  sendSSEError,
  sendSSEComplete,
  setupHeartbeat,
  setupAbortHandling,
  setupTimeout
};