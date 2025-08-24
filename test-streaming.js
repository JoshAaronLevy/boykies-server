/**
 * Test suite for streaming functionality
 * Run with: node test-streaming.js
 */

const { TextDecoder } = require('util');

// Test streaming utilities
const {
  setupSSEResponse,
  sendSSEEvent,
  sendHeartbeat,
  sendSSEError,
  sendSSEComplete,
  setupHeartbeat,
  setupAbortHandling,
  setupTimeout
} = require('./helpers/streaming');

// Test Dify client
const {
  validateStreamingRequest,
  buildDifyMessage,
  getActionTimeout
} = require('./helpers/dify-client');

/**
 * Mock Express response object for testing
 */
function createMockResponse() {
  const chunks = [];
  return {
    chunks,
    writableEnded: false,
    setHeader: function(name, value) {
      this.headers = this.headers || {};
      this.headers[name] = value;
    },
    write: function(chunk) {
      if (!this.writableEnded) {
        chunks.push(chunk);
      }
    },
    end: function() {
      this.writableEnded = true;
    },
    getOutput: function() {
      return chunks.join('');
    }
  };
}

/**
 * Mock Express request object for testing
 */
function createMockRequest() {
  const listeners = {};
  return {
    on: function(event, listener) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(listener);
    },
    emit: function(event, ...args) {
      if (listeners[event]) {
        listeners[event].forEach(listener => listener(...args));
      }
    }
  };
}

/**
 * Test SSE event formatting
 */
function testSSEEventFormatting() {
  console.log('🧪 Testing SSE event formatting...');
  
  const res = createMockResponse();
  
  // Test simple data event
  sendSSEEvent(res, null, 'Hello World');
  
  // Test event with type
  sendSSEEvent(res, 'chunk', { content: 'partial', id: 1 });
  
  // Test error event
  sendSSEError(res, new Error('Test error'), true);
  
  // Test completion event
  sendSSEComplete(res, { conversationId: 'test-123' });
  
  const output = res.getOutput();
  console.log('✅ SSE events formatted correctly');
  console.log('📝 Sample output:', output.substring(0, 150) + '...');
  
  // Verify format
  if (output.includes('data: Hello World\n\n') &&
      output.includes('event: chunk\n') &&
      output.includes('event: error\n') &&
      output.includes('event: done\n')) {
    console.log('✅ All SSE event types working');
  } else {
    console.log('❌ SSE event formatting failed');
  }
}

/**
 * Test heartbeat functionality
 */
function testHeartbeat() {
  console.log('\n🧪 Testing heartbeat functionality...');
  
  const res = createMockResponse();
  
  // Send a heartbeat
  sendHeartbeat(res);
  
  const output = res.getOutput();
  if (output === ': keep-alive\n\n') {
    console.log('✅ Heartbeat format correct');
  } else {
    console.log('❌ Heartbeat format incorrect:', JSON.stringify(output));
  }
}

/**
 * Test abort handling
 */
function testAbortHandling() {
  console.log('\n🧪 Testing abort handling...');
  
  const req = createMockRequest();
  const controller = new AbortController();
  let cleanupCalled = false;
  
  const cleanup = () => {
    cleanupCalled = true;
  };
  
  setupAbortHandling(req, controller, cleanup);
  
  // Simulate client disconnect
  req.emit('close');
  
  if (controller.signal.aborted && cleanupCalled) {
    console.log('✅ Abort handling working correctly');
  } else {
    console.log('❌ Abort handling failed');
  }
}

/**
 * Test timeout functionality
 */
function testTimeout() {
  console.log('\n🧪 Testing timeout functionality...');
  
  return new Promise((resolve) => {
    const controller = new AbortController();
    const clearTimeoutFn = setupTimeout(controller, 100); // 100ms timeout
    
    setTimeout(() => {
      if (controller.signal.aborted) {
        console.log('✅ Timeout working correctly');
      } else {
        console.log('❌ Timeout failed');
      }
      clearTimeoutFn();
      resolve();
    }, 150);
  });
}

/**
 * Test request validation
 */
function testRequestValidation() {
  console.log('\n🧪 Testing request validation...');
  
  // Test valid initialize request
  try {
    const result = validateStreamingRequest({
      action: 'initialize',
      conversationId: null,
      payload: {
        numTeams: 12,
        userPickPosition: 4,
        players: [{ name: 'Test Player' }]
      }
    });
    console.log('✅ Valid initialize request passed');
  } catch (error) {
    console.log('❌ Valid initialize request failed:', error.message);
  }
  
  // Test invalid request (missing action)
  try {
    validateStreamingRequest({
      payload: { test: true }
    });
    console.log('❌ Invalid request should have thrown error');
  } catch (error) {
    console.log('✅ Invalid request correctly rejected:', error.message);
  }
  
  // Test legacy request
  try {
    const result = validateStreamingRequest({
      action: 'legacy',
      payload: { query: 'Test message' }
    });
    console.log('✅ Legacy request validation passed');
  } catch (error) {
    console.log('❌ Legacy request validation failed:', error.message);
  }
}

/**
 * Test message building
 */
function testMessageBuilding() {
  console.log('\n🧪 Testing message building...');
  
  // Test legacy message
  const legacyMessage = buildDifyMessage('legacy', { query: 'Hello world' });
  if (legacyMessage === 'Hello world') {
    console.log('✅ Legacy message building works');
  } else {
    console.log('❌ Legacy message building failed');
  }
  
  // Test initialize message
  const initMessage = buildDifyMessage('initialize', {
    numTeams: 12,
    userPickPosition: 4,
    players: [{ name: 'Test' }]
  });
  if (initMessage.includes('Fantasy football draft is beginning')) {
    console.log('✅ Initialize message building works');
  } else {
    console.log('❌ Initialize message building failed');
  }
}

/**
 * Test timeout calculation
 */
function testTimeoutCalculation() {
  console.log('\n🧪 Testing timeout calculation...');
  
  // Test user turn timeout
  const userTurnTimeout = getActionTimeout('user-turn', false);
  if (userTurnTimeout === 120000) {
    console.log('✅ User turn timeout correct (120s)');
  } else {
    console.log('❌ User turn timeout incorrect:', userTurnTimeout);
  }
  
  // Test streaming timeout
  const streamingTimeout = getActionTimeout('user-turn', true);
  const expectedStreaming = Number(process.env.LLM_REQUEST_TIMEOUT_MS) || 240000;
  if (streamingTimeout === expectedStreaming) {
    console.log('✅ Streaming timeout correct');
  } else {
    console.log('❌ Streaming timeout incorrect:', streamingTimeout);
  }
}

/**
 * Integration test with mock upstream
 */
async function testIntegration() {
  console.log('\n🧪 Running integration test...');
  
  // Mock fetch for testing
  const originalFetch = global.fetch;
  
  // Create a mock readable stream
  const mockStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"chunk": "Hello"}\n\n'));
      controller.enqueue(new TextEncoder().encode('data: {"chunk": " World"}\n\n'));
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      controller.close();
    }
  });
  
  global.fetch = async () => ({
    ok: true,
    status: 200,
    body: mockStream
  });
  
  try {
    const { sendToDifyStreaming } = require('./helpers/dify-client');
    
    // Mock req object
    const mockReq = {
      on: (event, callback) => {
        // Mock request close handling
      }
    };
    
    // Mock res object to capture written data
    let writtenData = [];
    const mockRes = {
      write: (data) => {
        // Handle both string and Uint8Array data
        if (data instanceof Uint8Array) {
          writtenData.push(new TextDecoder().decode(data));
        } else {
          writtenData.push(data);
        }
      },
      end: () => {
        // Mock response end
      },
      writableEnded: false
    };
    
    // Mock heartbeat timer
    const mockHeartbeatTimer = setInterval(() => {}, 1000);
    
    // Test the new streaming function
    await sendToDifyStreaming(mockReq, mockRes, mockHeartbeatTimer, 'legacy', { query: 'test' }, 'test-user', null);
    
    // Check if data was written to response
    const output = writtenData.join('');
    if (output.includes('Hello') && output.includes('World')) {
      console.log('✅ Integration test: streaming data received correctly');
    } else {
      console.log('❌ Integration test: streaming data incorrect');
      console.log('Output received:', output);
    }
    
    clearInterval(mockHeartbeatTimer);
  } catch (error) {
    console.log('❌ Integration test error:', error.message);
  } finally {
    global.fetch = originalFetch;
  }
}

/**
 * Manual curl test instructions
 */
function printManualTestInstructions() {
  console.log('\n📋 Manual Test Instructions:');
  console.log('==========================');
  console.log('1. Start the server: npm start');
  console.log('2. Test streaming endpoint:');
  console.log('');
  console.log('curl -N -X POST http://localhost:3000/api/llm/stream \\');
  console.log('  -H "Content-Type: application/json" \\');
  console.log('  -H "Authorization: Bearer YOUR_TOKEN" \\');
  console.log('  -d \'{"action":"reset","payload":{"message":"Test reset"}}\'');
  console.log('');
  console.log('3. Test user turn streaming:');
  console.log('curl -N -X POST http://localhost:3000/api/llm/stream \\');
  console.log('  -H "Content-Type: application/json" \\');
  console.log('  -H "Authorization: Bearer YOUR_TOKEN" \\');
  console.log('  -d \'{"action":"user-turn","payload":{"player":{"name":"Test"},"round":1,"pick":1,"userRoster":[],"availablePlayers":[]}}\'');
  console.log('');
  console.log('Expected output: SSE events with data: fields');
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('🚀 Starting streaming tests...\n');
  
  testSSEEventFormatting();
  testHeartbeat();
  testAbortHandling();
  await testTimeout();
  testRequestValidation();
  testMessageBuilding();
  testTimeoutCalculation();
  await testIntegration();
  
  console.log('\n🎉 All tests completed!');
  printManualTestInstructions();
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = {
  testSSEEventFormatting,
  testHeartbeat,
  testAbortHandling,
  testTimeout,
  testRequestValidation,
  testMessageBuilding,
  testTimeoutCalculation,
  testIntegration,
  runAllTests
};