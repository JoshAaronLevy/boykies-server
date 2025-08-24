# LLM Streaming Implementation

This document describes the streaming implementation for the Dify LLM integration in the fantasy football draft application.

## Overview

The streaming implementation provides real-time responses from the Dify LLM API using Server-Sent Events (SSE) with fetch streaming transport. This allows for immediate feedback as the AI generates responses, improving user experience for long-running operations.

## Architecture

### Transport Layer
- **Primary**: `POST /api/llm/stream` using fetch with Authorization headers
- **Format**: SSE-framed responses (`text/event-stream`)
- **Client**: Uses fetch API, not native EventSource (due to header requirements)

### Components

#### 1. Streaming Utilities (`helpers/streaming.js`)
- SSE response setup and formatting
- Heartbeat mechanism (configurable, default 20s)
- Error handling and completion events
- Abort signal management

#### 2. Dify Client (`helpers/dify-client.js`)
- Unified client supporting both blocking and streaming modes
- Native Node.js fetch API (requires Node 18+)
- Request validation and message building
- Timeout management per operation type

#### 3. Main Endpoint (`/api/llm/stream`)
- Validates requests and sets up SSE
- Proxies streaming data from Dify API
- Handles client disconnection and cleanup

## Configuration

### Environment Variables

```bash
# Required
DIFY_API_URL=https://api.dify.ai/v1/chat-messages
DIFY_SECRET_KEY=your_secret_key

# Streaming Configuration
LLM_REQUEST_TIMEOUT_MS=240000    # 4 minutes default
STREAM_HEARTBEAT_MS=20000        # 20 seconds default
STREAMING_ENABLED=true           # Feature flag
```

### Server Configuration

The server is configured with extended timeouts for streaming:
- Request timeout: 240 seconds (configurable)
- Headers timeout: 250 seconds (request timeout + 10s buffer)
- Connection keep-alive with heartbeats

## API Usage

### Endpoint: `POST /api/llm/stream`

#### Request Format
```json
{
  "action": "initialize|reset|player-taken|user-turn",
  "conversationId": "string|null",
  "payload": {
    // Action-specific data
  }
}
```

#### Response Format (SSE)
```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no

: keep-alive

data: {"type": "chunk", "content": "partial response text"}

event: error
data: {"message": "error details", "retryable": false}

event: done
data: {}
```

### Action Types

#### 1. Initialize Draft
```json
{
  "action": "initialize",
  "conversationId": null,
  "payload": {
    "numTeams": 12,
    "userPickPosition": 4,
    "players": [{"name": "Player Name", "position": "RB"}]
  }
}
```

#### 2. Reset Draft
```json
{
  "action": "reset",
  "conversationId": "optional",
  "payload": {
    "message": "Custom reset message (optional)"
  }
}
```

#### 3. Player Taken
```json
{
  "action": "player-taken",
  "conversationId": "required",
  "payload": {
    "player": {"name": "Player Name", "position": "RB"},
    "round": 1,
    "pick": 3
  }
}
```

#### 4. User Turn
```json
{
  "action": "user-turn",
  "conversationId": "required",
  "payload": {
    "player": {"name": "Last Player Taken"},
    "round": 2,
    "pick": 8,
    "userRoster": [{"name": "My Player 1"}],
    "availablePlayers": [{"name": "Available Player 1"}]
  }
}
```

## Client Implementation

### JavaScript Example
```javascript
async function streamLLMResponse(action, payload, conversationId = null) {
  const response = await fetch('/api/llm/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      action,
      conversationId,
      payload
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        handleChunk(data);
      } else if (line.startsWith('event: ')) {
        const event = line.slice(7);
        if (event === 'done') {
          handleComplete();
          return;
        } else if (event === 'error') {
          // Next line contains error data
          handleError();
          return;
        }
      }
    }
  }
}
```

### React Hook Example
```javascript
function useStreamingLLM() {
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const stream = useCallback(async (action, payload, conversationId) => {
    setLoading(true);
    setError(null);
    setResponse('');

    try {
      // ... streaming implementation
      // Update response state as chunks arrive
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { response, loading, error, stream };
}
```

## Error Handling

### Error Types
- **Validation Errors**: Invalid request payload
- **Authentication Errors**: Missing or invalid API key
- **Timeout Errors**: Request exceeds configured timeout
- **Network Errors**: Connection issues with Dify API
- **Client Disconnect**: User closes browser/cancels request

### Error Response Format
```
event: error
data: {"message": "Error description", "retryable": true|false}
```

### Retry Strategy
- Retryable errors: Network timeouts, temporary API errors
- Non-retryable errors: Authentication, validation errors
- Client should implement exponential backoff for retries

## Testing

### Unit Tests
```bash
node test-streaming.js
```

### Manual Testing
```bash
# Start server
npm start

# Test streaming endpoint
curl -N -X POST http://localhost:3000/api/llm/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"action":"reset","payload":{"message":"Test reset"}}'

# Test with user turn
curl -N -X POST http://localhost:3000/api/llm/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"action":"user-turn","payload":{"player":{"name":"Test"},"round":1,"pick":1,"userRoster":[],"availablePlayers":[]}}'
```

### Expected Output
```
: keep-alive

data: {"type": "chunk", "content": "I"}

data: {"type": "chunk", "content": "'ll help"}

data: {"type": "chunk", "content": " you with"}

event: done
data: {}
```

## Deployment Considerations

### Nginx Configuration
If using Nginx as a reverse proxy, add the following to disable buffering for streaming endpoints:

```nginx
location /api/llm/stream {
    proxy_pass http://backend;
    proxy_buffering off;
    proxy_cache off;
    proxy_set_header Connection '';
    proxy_http_version 1.1;
    chunked_transfer_encoding off;
}
```

### Load Balancing
- Use session affinity for conversation continuity
- Monitor connection counts and duration
- Consider connection limits per client

### Monitoring
- Track streaming connection duration
- Monitor memory usage for long-running streams
- Log timeout and error rates
- Alert on high connection counts

## Backward Compatibility

All existing synchronous endpoints remain unchanged:
- `POST /draft/reset`
- `POST /draft/initialize` 
- `POST /draft/player-taken`
- `POST /draft/user-turn`

The streaming implementation runs in parallel, allowing gradual migration.

## Performance

### Optimizations
- Direct streaming from Dify (no buffering)
- Minimal memory footprint per connection
- Efficient cleanup on disconnect
- Configurable heartbeat intervals

### Limits
- Connection timeout: 240 seconds (configurable)
- Heartbeat interval: 20 seconds (configurable)
- Memory usage: ~1-2KB per active connection

## Security

### Authentication
- Bearer token required in Authorization header
- Same security model as existing endpoints
- Rate limiting recommended

### Headers
- CORS configuration may need updates for streaming
- CSP headers should allow Server-Sent Events
- Ensure secure WebSocket upgrade if using WSS

## Troubleshooting

### Common Issues

1. **Empty responses**: Check DIFY_SECRET_KEY configuration
2. **Connection timeouts**: Verify LLM_REQUEST_TIMEOUT_MS setting
3. **No heartbeats**: Check STREAM_HEARTBEAT_MS configuration
4. **Buffering issues**: Verify nginx/proxy configuration

### Debug Mode
Set environment variable for detailed logging:
```bash
DEBUG=streaming npm start
```

### Health Check
Test basic functionality:
```bash
curl -X GET http://localhost:3000/version