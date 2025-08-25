/**
 * Payload size monitoring utility for tracking large request payloads
 * Provides warnings and errors for oversized payloads without blocking execution
 */

/**
 * Monitor payload size and log warnings/errors for large payloads
 * @param {any} payload - The payload object to monitor (will be JSON stringified)
 * @param {string} context - Context identifier for logging (e.g., 'user-turn endpoint', 'initialize endpoint')
 * @returns {number} - The payload size in bytes
 */
function monitorPayloadSize(payload, context = 'unknown') {
  let payloadSize = 0;
  
  try {
    // Calculate byte size using JSON.stringify
    const jsonString = JSON.stringify(payload);
    payloadSize = jsonString.length;
    
    // Log warning if payload exceeds 150,000 bytes (~146 KB)
    if (payloadSize > 150000) {
      const sizeKB = (payloadSize / 1024).toFixed(2);
      console.warn(`[PAYLOAD-MONITOR] Large payload detected in ${context}: ${sizeKB} KB (${payloadSize} bytes) - Consider optimizing payload size`);
    }
    
    // Log error if payload exceeds 300,000 bytes (~293 KB)
    if (payloadSize > 300000) {
      const sizeKB = (payloadSize / 1024).toFixed(2);
      console.error(`[PAYLOAD-MONITOR] Critical payload size in ${context}: ${sizeKB} KB (${payloadSize} bytes) - Performance degradation likely`);
    }
    
  } catch (error) {
    // Handle JSON.stringify errors gracefully without blocking
    console.warn(`[PAYLOAD-MONITOR] Unable to calculate payload size for ${context}: ${error.message}`);
    return 0;
  }
  
  return payloadSize;
}

module.exports = {
  monitorPayloadSize
};