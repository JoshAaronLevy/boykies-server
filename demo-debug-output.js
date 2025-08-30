#!/usr/bin/env node

/**
 * Simple demonstration of DEBUG_STREAM_INIT error logging
 * Shows what developers will see when DEBUG_STREAM_INIT=1 and upstream fetch fails
 */

console.log('🔍 DEBUG_STREAM_INIT Error Logging Demo');
console.log('=======================================\n');

console.log('💡 When you set DEBUG_STREAM_INIT=1 and an upstream fetch fails, you will see:');
console.log('');

// Example 1: DNS Resolution Failure (ENOTFOUND)
console.log('📍 Example 1: DNS Resolution Failure');
console.log('-----------------------------------');
console.log('$ DEBUG_STREAM_INIT=1 node server.js');
console.log('');
console.log('🔴 Console Error Output:');
console.error({
  where: 'initialize:upstream',
  name: 'TypeError',
  code: 'ENOTFOUND',
  message: 'fetch failed',
  difyBaseUrlPresent: true,
  difyApiKeyPresent: true
});

console.log('');
console.error('[DEBUG_STREAM_INIT] Upstream fetch failure:', {
  where: 'initialize:upstream', 
  name: 'TypeError',
  code: 'ENOTFOUND',
  message: 'fetch failed',
  hasUrl: true,
  hasKey: true
});

console.log('');
console.log('📡 Client receives NDJSON:');
console.log('{"event":"error","data":{"error":"fetch_error","code":"ENOTFOUND","message":"fetch failed"}}');

console.log('\n');

// Example 2: Connection Refused (ECONNREFUSED)  
console.log('📍 Example 2: Connection Refused');
console.log('-------------------------------');
console.log('$ DEBUG_STREAM_INIT=1 node server.js');
console.log('');
console.log('🔴 Console Error Output:');
console.error({
  where: 'initialize:upstream',
  name: 'TypeError', 
  code: 'ECONNREFUSED',
  message: 'fetch failed',
  difyBaseUrlPresent: true,
  difyApiKeyPresent: true
});

console.log('');
console.error('[DEBUG_STREAM_INIT] Upstream fetch failure:', {
  where: 'initialize:upstream',
  name: 'TypeError',
  code: 'ECONNREFUSED', 
  message: 'fetch failed',
  hasUrl: true,
  hasKey: true
});

console.log('');
console.log('📡 Client receives NDJSON:');
console.log('{"event":"error","data":{"error":"fetch_error","code":"ECONNREFUSED","message":"fetch failed"}}');

console.log('\n');

// Example 3: Request Timeout
console.log('📍 Example 3: Request Timeout');
console.log('----------------------------');
console.log('$ DEBUG_STREAM_INIT=1 node server.js');
console.log('');
console.log('🔴 Console Error Output:');
console.error({
  where: 'initialize:upstream',
  name: 'AbortError',
  code: undefined,
  message: 'This operation was aborted',
  difyBaseUrlPresent: true,
  difyApiKeyPresent: true
});

console.log('');
console.error('[DEBUG_STREAM_INIT] Upstream fetch failure:', {
  where: 'initialize:upstream',
  name: 'AbortError', 
  code: undefined,
  message: 'This operation was aborted',
  hasUrl: true,
  hasKey: true
});

console.log('');
console.log('📡 Client receives NDJSON:');
console.log('{"event":"error","data":{"error":"timeout","message":"This operation was aborted"}}');

console.log('\n');

console.log('🎯 Key Benefits:');
console.log('✅ Precise error codes (ENOTFOUND, ECONNREFUSED, etc.)');
console.log('✅ Environment variable validation status');
console.log('✅ Enhanced NDJSON error format with error codes');
console.log('✅ Clear distinction between timeout vs network errors');
console.log('✅ Easy troubleshooting for developers');

console.log('\n');
console.log('🔧 Usage in Production:');
console.log('export DEBUG_STREAM_INIT=1  # Enable debug logging');
console.log('node server.js             # Start with debug output');
console.log('# Now you get detailed error visibility when upstream fetch fails!');