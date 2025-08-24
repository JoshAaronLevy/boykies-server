#!/usr/bin/env node

/**
 * Basic test to reproduce the AbortError issue with initialize draft requests
 */

async function testInitializeAbortError() {
  console.log('🧪 Testing initialize draft request to reproduce AbortError...\n');

  // Simple test payload similar to what causes the issue
  const testPayload = {
    action: 'initialize',
    conversationId: null, // This is the key - null conversationId for new conversations
    payload: {
      numTeams: 6,
      userPickPosition: 4,
      players: [
        {
          id: "1",
          name: "Christian McCaffrey",
          position: "RB",
          team: { abbr: "SF" }
        },
        {
          id: "2", 
          name: "Justin Jefferson",
          position: "WR",
          team: { abbr: "MIN" }
        }
      ]
    }
  };

  try {
    console.log('📤 Sending POST request to /api/llm/stream...');
    console.log('🔧 Request payload:', JSON.stringify({
      action: testPayload.action,
      conversationId: testPayload.conversationId,
      payloadSize: JSON.stringify(testPayload.payload).length
    }, null, 2));

    const response = await fetch('http://localhost:3000/api/llm/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token'
      },
      body: JSON.stringify(testPayload)
    });

    console.log('📥 Response status:', response.status);
    console.log('📄 Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.body) {
      console.log('❌ No response body received');
      return;
    }

    // Read the streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let chunks = 0;
    let totalData = '';

    console.log('📺 Reading streaming response...\n');

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          console.log('✅ Stream completed normally');
          break;
        }

        chunks++;
        const chunk = decoder.decode(value, { stream: true });
        totalData += chunk;
        
        console.log(`[CHUNK ${chunks}]`, chunk.slice(0, 100) + (chunk.length > 100 ? '...' : ''));

        // Check for error events in SSE
        if (chunk.includes('event: error')) {
          console.log('🚨 ERROR EVENT DETECTED in chunk!');
          console.log('📝 Full chunk:', chunk);
        }
      }
    } catch (readerError) {
      console.log('❌ Reader error:', readerError.message);
      console.log('📊 Stats before error:', { chunks, totalDataLength: totalData.length });
    }

    console.log('\n📊 Final stats:');
    console.log('- Total chunks received:', chunks);
    console.log('- Total data length:', totalData.length);
    console.log('- Contains error event:', totalData.includes('event: error'));

  } catch (error) {
    console.log('❌ Request failed with error:', error.message);
    console.log('🔍 Error details:', {
      name: error.name,
      cause: error.cause,
      stack: error.stack?.split('\n')[0]
    });
  }
}

// Run the test
testInitializeAbortError().catch(console.error);