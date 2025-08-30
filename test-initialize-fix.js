async function testInitializeFix() {
  const testPayload = {
    user: 'test-user',
    payload: {
      numTeams: 12,
      userPickPosition: 5,
      players: [
        { name: 'Test Player 1', position: 'QB' },
        { name: 'Test Player 2', position: 'RB' }
      ]
    }
  };

  try {
    console.log('[TEST] Testing initialize streaming endpoint...');
    
    const response = await fetch('http://localhost:3000/api/draft/initialize?stream=1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testPayload)
    });

    console.log('[TEST] Response status:', response.status);
    console.log('[TEST] Response headers:', Object.fromEntries(response.headers.entries()));
    
    if (response.ok) {
      console.log('[TEST] ✅ Request succeeded - checking for debug logging in server output');
      
      // Read first few chunks to see if streaming works
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let chunkCount = 0;
      
      try {
        while (chunkCount < 3) {
          const { value, done } = await reader.read();
          if (done) break;
          
          chunkCount++;
          const chunk = decoder.decode(value, { stream: true });
          console.log(`[TEST] Chunk ${chunkCount}:`, chunk.slice(0, 200));
        }
      } catch (streamError) {
        console.log('[TEST] Stream error (expected for test):', streamError.message);
      }
    } else {
      const errorText = await response.text();
      console.log('[TEST] ❌ Request failed:', errorText.slice(0, 500));
    }
    
  } catch (error) {
    console.log('[TEST] Network error:', error.message);
  }
}

testInitializeFix();