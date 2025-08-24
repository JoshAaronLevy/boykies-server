/**
 * Stream debugging utilities with correlation IDs, phase breadcrumbs, and transcript recording
 * Only active when DIFY_DEBUG=1 to avoid production noise
 */

const crypto = require('crypto');

// In-memory transcript storage: Map<reqId, Entry[]>
const STREAM_TRANSCRIPTS = new Map();
const MAX_TRANSCRIPT_ENTRIES = 200;

/**
 * Get current timestamp
 * @returns {number} Current timestamp
 */
function now() {
  return Date.now();
}

/**
 * Record an entry in the transcript buffer (dev-only)
 * @param {string} reqId - Request correlation ID
 * @param {Object} entry - Entry to record
 */
function record(reqId, entry) {
  if (process.env.DIFY_DEBUG !== '1') return;
  
  if (!STREAM_TRANSCRIPTS.has(reqId)) {
    STREAM_TRANSCRIPTS.set(reqId, []);
  }
  
  const entries = STREAM_TRANSCRIPTS.get(reqId);
  entries.push({ t: now(), ...entry });
  
  // Cap at MAX_TRANSCRIPT_ENTRIES
  if (entries.length > MAX_TRANSCRIPT_ENTRIES) {
    entries.splice(0, entries.length - MAX_TRANSCRIPT_ENTRIES);
  }
}

/**
 * Create a phase helper function for a specific response and request ID
 * @param {Object} res - Express response object
 * @param {string} reqId - Request correlation ID
 * @returns {Function} Phase helper function
 */
function makePhase(res, reqId) {
  return (step, extra = {}) => {
    const frame = { type: 'phase', reqId, t: now(), step, ...extra };
    
    if (process.env.DIFY_DEBUG === '1') {
      // Write SSE phase frame
      try {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(frame)}\n\n`);
        }
      } catch (err) {
        // Ignore write errors
      }
      
      // Console log with [PHASE] prefix
      console.log('[PHASE]', frame);
      
      // Record in transcript
      record(reqId, frame);
    }
  };
}

/**
 * Get transcript for a specific request ID
 * @param {string} reqId - Request correlation ID
 * @returns {Array} Array of transcript entries
 */
function getTranscript(reqId) {
  return STREAM_TRANSCRIPTS.get(reqId) || [];
}

/**
 * Get the last transcript (most recent request)
 * @returns {Object} Object with reqId and entries
 */
function getLastTranscript() {
  if (STREAM_TRANSCRIPTS.size === 0) {
    return { reqId: null, entries: [] };
  }
  
  // Find the most recent transcript by looking at the latest timestamp
  let lastReqId = null;
  let lastTimestamp = 0;
  
  for (const [reqId, entries] of STREAM_TRANSCRIPTS.entries()) {
    if (entries.length > 0) {
      const maxT = Math.max(...entries.map(e => e.t || 0));
      if (maxT > lastTimestamp) {
        lastTimestamp = maxT;
        lastReqId = reqId;
      }
    }
  }
  
  return {
    reqId: lastReqId,
    entries: lastReqId ? STREAM_TRANSCRIPTS.get(lastReqId) || [] : []
  };
}

/**
 * Generate a new correlation ID
 * @returns {string} UUID correlation ID
 */
function generateReqId() {
  return crypto.randomUUID();
}

module.exports = {
  now,
  record,
  makePhase,
  getTranscript,
  getLastTranscript,
  generateReqId,
  STREAM_TRANSCRIPTS
};