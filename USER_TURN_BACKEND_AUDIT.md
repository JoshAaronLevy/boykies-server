# USER_TURN_BACKEND_AUDIT.md

## Route Investigation Results

### Active Route Path
- **Primary Route**: `POST /api/draft/user-turn` in `routes/draft.js:308`
- **Mount Point**: `/api/draft` via `index.js:82`
- **Duplicates**: Previous duplicate route in `index.js:320` was removed and flagged with `// ROO: duplicate route` comment

### Route Mount Order
1. `/api/llm/stream` (streamRouter) - mounted first at `index.js:76`
2. `/api/draft` (JSON parser) - mounted at `index.js:79`
3. `/api/draft` (draft routes) - mounted at `index.js:82`

## Final Required Fields (FE → BE)

### Top-level Required Fields
- `conversationId: string` (mandatory - 400 if missing)
- `user?: string` (optional; fallback to 'local-dev')
- `payload: object` (mandatory)

### Payload Required Fields
- `round: number`
- `pick: number` (supports `pickNumber` → `pick` mapping)
- `userRoster: any[]`
- `availablePlayers: any[]`
- `leagueSize: number` (now mandatory)
- `pickSlot: number` (now mandatory)

### Validation Error Response
```json
{ 
  "error": "Missing required fields: round, pick, userRoster, availablePlayers, leagueSize, pickSlot, conversationId" 
}
```

## Exact Dify Request Body

The backend constructs and sends this exact payload to Dify:

```json
{
  "user": "local-dev",
  "query": "User's turn",
  "response_mode": "streaming",
  "inputs": {
    "action": "users-turn",
    "round": 1,
    "pick": 5,
    "userRoster": [],
    "availablePlayers": [],
    "leagueSize": 12,
    "pickSlot": 5
  },
  "conversation_id": "conversation-id-here"
}
```

### Key Points
- **Forced query**: Always `"User's turn"` (with apostrophe)
- **Forced action**: Always `"users-turn"` in inputs
- **No player field**: Unlike player-taken route, no player is involved

## Timeouts Used

### Route-level Timeout
- `res.setTimeout(120_000)` - 120 seconds at `routes/draft.js:309`

### Helper Timeout
- `getDifyBufferedResponse(..., 90_000)` - 90 seconds at `routes/draft.js:334`

## Byte-size Logging Implementation

### Location
- **File**: `routes/draft.js`
- **Lines**: 304-310 (bytesOf helper function)
- **Lines**: 331-337 (actual logging)

### Implementation
```javascript
// Helper function at routes/draft.js:304-310
function bytesOf(obj) {
  try { 
    return Buffer.byteLength(JSON.stringify(obj), 'utf8'); 
  } catch { 
    return -1; 
  }
}

// Logging at routes/draft.js:331-337
const bytes = bytesOf(difyBodyForLog);
if (bytes >= 300_000) {
  console.error('[PAYLOAD][ALERT] /draft/user-turn bytes', { bytes, count: availablePlayers.length });
} else if (bytes >= 150_000) {
  console.warn('[PAYLOAD][WARN] /draft/user-turn bytes',  { bytes, count: availablePlayers.length });
}
```

### Constants
- `WARN_BYTES = 150_000`
- `ALERT_BYTES = 300_000`
- No logging below 150k bytes

## Response Format

### Success Response (200)
```json
{
  "ok": true,
  "conversationId": "conversation-id",
  "answer": "stripped answer without <think> tags",
  "usage": { /* optional usage stats */ },
  "duration_ms": 12345
}
```

### Error Responses

#### Timeout/Cloudflare (504)
```json
{
  "ok": false,
  "error": "timeout" | "cloudflare_timeout",
  "message": "error details",
  "duration_ms": 12345
}
```

#### Upstream Errors (502)
```json
{
  "ok": false,
  "error": "upstream" | "handler_error",
  "message": "error details",
  "duration_ms": 12345
}
```

### Response Headers
- `X-Streamed: true`
- `X-Backend-Timing: <duration_ms>`
- `X-Conversation-Id: <conversationId>` (if present)

## Implementation Details

### getDifyBufferedResponse Usage
- **Action**: `'legacy'` (bypasses action-based validation)
- **Payload**: `{ query: "User's turn" }`
- **Conversation ID**: Always included
- **Timeout**: 90,000ms

### Think Tag Stripping
Answer is processed to remove `<think>...</think>` tags:
```javascript
answer = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
```

## Follow-up Recommendations (Not Implemented)

1. **Enhanced Validation**: Consider adding min/max validation for `round`, `pick`, `leagueSize`, and `pickSlot`

2. **Payload Size Monitoring**: Consider implementing automatic payload trimming if size exceeds thresholds (currently only logs)

3. **Response Caching**: For repeated identical requests, consider implementing short-term response caching

4. **Metrics Collection**: Add more detailed timing and success/failure metrics for monitoring

5. **Input Sanitization**: Consider additional sanitization of user roster and available players arrays

6. **Rate Limiting**: Consider implementing rate limiting per user/conversation to prevent abuse

## Testing Status

- **Implementation**: Complete
- **Basic Validation**: Complete  
- **Integration Testing**: Ready for single safe test
- **Production Readiness**: Pending integration test results