# Draft Endpoints Implementation Audit

## Overview
This document provides a comprehensive audit of the current draft endpoints implementation, examining route definitions, implementation modes, timeout configurations, and payload handling.

## Current Draft Endpoints

### 1. POST /api/draft/player-taken
- **Location**: `index.js:247`
- **Implementation Mode**: Blocking
- **Function Used**: `sendToDify()` → `sendToDifyBlocking()`
- **Timeout**: 360000ms (6 minutes) via `getActionTimeout('legacy', false)`
- **Payload Requirements**:
  - `player` (required)
  - `round` (required) 
  - `pick` (required)
  - `conversationId` (required)
- **Message Format**: 
  ```
  Player taken: ${JSON.stringify(player)} in round ${round}, pick ${pick}.
  ```
- **Response Format**:
  ```json
  {
    "success": true,
    "confirmation": "...",
    "conversationId": "..."
  }
  ```

### 2. POST /api/draft/user-turn
- **Location**: `index.js:287`
- **Implementation Mode**: Blocking
- **Function Used**: `sendToDify()` → `sendToDifyBlocking()` with `isUserTurn=true`
- **Timeout**: 120000ms (2 minutes) via `getActionTimeout('legacy', false)` with isUserTurn override
- **Payload Requirements**:
  - `player` (required)
  - `round` (required)
  - `pick` (required) 
  - `userRoster` (required)
  - `availablePlayers` (required)
  - `conversationId` (required)
- **Message Format**:
  ```
  Player taken: ${JSON.stringify(player)} in round ${round}, pick ${pick}.

  IT'S MY TURN NOW!

  My current roster: ${JSON.stringify(userRoster)}
  Available players (top options): ${JSON.stringify(availablePlayers)}

  Please provide your analysis and recommendations for my next pick.
  ```
- **Response Format**:
  ```json
  {
    "success": true,
    "analysis": "...",
    "conversationId": "..."
  }
  ```

## Additional Draft Endpoints Found

### 3. POST /api/draft/reset (DUPLICATE ROUTES)

#### Version A - routes/draft.js:213
- **Implementation Mode**: Blocking
- **Function Used**: Direct `fetch()` call to Dify API
- **Timeout**: `LLM_BLOCKING_TIMEOUT_MS` (3000000ms = 50 minutes)
- **Payload Requirements**: `user` (required)
- **Message**: `RESET_DRAFT: user is starting over. Please acknowledge reset.`

#### Version B - index.js:213 
- **Implementation Mode**: Blocking  
- **Function Used**: `sendToDify()` → `sendToDifyBlocking()`
- **Timeout**: 360000ms (6 minutes) via `getActionTimeout()`
- **Payload Requirements**: `message` (optional, defaults to "Draft reset - starting over.")
- **Message**: Uses provided message or default

### 4. POST /api/draft/initialize
- **Location**: `routes/draft.js:102`
- **Implementation Mode**: Streaming Buffer (server-side buffering)
- **Function Used**: `getDifyBufferedResponse()`
- **Timeout**: 295000ms (295 seconds) via parameter to `getDifyBufferedResponse()`
- **Response Timeout**: 320000ms (320 seconds) set on Express response
- **Payload Requirements**:
  - `user` (required)
  - `conversationId` (optional)
  - `payload.numTeams` (required, number)
  - `payload.userPickPosition` (required, number) 
  - `payload.players` (required, array, max 50 via `MAX_INIT_PLAYERS`)

### 5. POST /api/draft/marco
- **Location**: `routes/draft.js:37`
- **Implementation Mode**: Blocking
- **Function Used**: Direct `fetch()` call to Dify API
- **Timeout**: 90000ms (90 seconds)
- **Payload**: Forces `query: 'Marco'` regardless of input
- **Purpose**: Simple connectivity test expecting "Polo!" response

## Route Organization Issues

### File Distribution
- **routes/draft.js**: marco, initialize, reset
- **index.js**: reset (duplicate), player-taken, user-turn

### Route Mounting
```javascript
// index.js:81
app.use('/api/draft', require('./routes/draft'));
```
This means routes/draft.js endpoints are mounted first, so the duplicate reset route in routes/draft.js takes precedence over the one in index.js.

## Timeout Configuration Analysis

### Environment Variables
- `LLM_BLOCKING_TIMEOUT_MS`: 3000000ms (50 minutes) - used in routes/draft.js
- `BLOCKING_TIMEOUT_MS`: 3000000ms (50 minutes) - used in index.js boot log only
- `MAX_INIT_PLAYERS`: 50 (used in routes/draft.js)

### Hardcoded Timeouts
- **routes/draft.js marco**: 90000ms (90 seconds)
- **routes/draft.js reset**: 3000000ms (50 minutes)
- **routes/draft.js initialize**: 295000ms (295 seconds) for Dify + 320000ms response timeout
- **index.js player-taken**: 360000ms (6 minutes)
- **index.js user-turn**: 120000ms (2 minutes)

### Timeout Function Logic
From `helpers/dify-client.js:getActionTimeout()`:
```javascript
function getActionTimeout(action, streaming = false) {
  // For blocking mode:
  return isUserTurn ? 120000 : 360000; // 2 min vs 6 min
}
```

## Implementation Patterns

### Legacy Pattern (index.js endpoints)
```javascript
const result = await sendToDify(message, conversationId, isUserTurn);
```
- Uses wrapper function `sendToDify()`
- Calls `sendToDifyBlocking()` internally
- Action type is hardcoded as 'legacy'

### Direct Pattern (routes/draft.js reset & marco)
```javascript
const response = await fetch(DIFY_API_URL, {
  method: 'POST',
  headers: { ... },
  body: JSON.stringify(difyPayload),
  signal: controller.signal
});
```
- Direct fetch calls to Dify API
- Manual AbortController setup
- Custom timeout handling

### Streaming Buffer Pattern (routes/draft.js initialize)
```javascript
const result = await getDifyBufferedResponse('initialize', payload, conversationId, 295000);
```
- Uses `getDifyBufferedResponse()` from dify-client.js
- Server-side streaming consumption with single JSON response
- More sophisticated error handling

## Payload Handling

### Size Limits
- **Body parser limit**: 5mb for `/api/draft` routes (set in index.js:78)
- **Global limit**: 100kb for other routes (set in index.js:104)
- **Player limits**: MAX_INIT_PLAYERS=50 for initialize endpoint

### Payload Processing
- **player-taken**: Simple JSON stringification of player object
- **user-turn**: Large payload with userRoster + availablePlayers arrays
- **initialize**: Uses `slimPlayers()` function to reduce payload size

## Error Handling Patterns

### Legacy Endpoints (index.js)
```javascript
if (result.success) {
  res.json({ success: true, ... });
} else {
  res.status(500).json({ success: false, error: result.error });
}
```

### Modern Endpoints (routes/draft.js)
```javascript
if (result.success) {
  return res.json({ ok: true, ... });
} else {
  if (result.errorType === 'timeout') {
    return res.status(504).json({ ok: false, message: result.error });
  } else {
    return res.status(502).json({ ok: false, message: result.error });
  }
}
```

## Critical Issues Identified

### 1. Duplicate Route Definition
- `POST /api/draft/reset` exists in both files
- routes/draft.js version takes precedence
- Different implementations and timeouts

### 2. Inconsistent Implementation Patterns
- Mix of legacy wrapper vs direct calls vs new helpers
- Different error response formats (`success` vs `ok`)
- Inconsistent timeout handling

### 3. Timeout Inconsistencies
- user-turn: 2 minutes (very short for complex analysis)
- player-taken: 6 minutes 
- reset: 50 minutes (varies by file)
- initialize: ~5 minutes

### 4. Missing Route
- No `/api/draft/users-turn` variant found
- Only `/api/draft/user-turn` exists

## Recommendations

1. **Consolidate routes**: Move all draft endpoints to routes/draft.js
2. **Standardize implementation**: Use consistent dify-client helper functions
3. **Unify error handling**: Consistent response format across all endpoints
4. **Review timeouts**: Align timeout values with actual usage patterns
5. **Remove duplicates**: Eliminate duplicate reset route
6. **Add route aliases**: Consider adding `/users-turn` alias if needed by frontend