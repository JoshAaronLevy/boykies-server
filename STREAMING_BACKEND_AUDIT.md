# Backend Streaming Audit Report: `/api/draft/initialize?stream=1`

**Generated:** 2025-08-30T18:27:40Z  
**Target Route:** `POST /api/draft/initialize?stream=1`  
**Issue:** Frontend receives only `{"event":"error","data":{"error":"fetch_error"}}` then stream ends

---

## 1) Executive Summary

**Most Probable Root Causes:**

1. **Missing Content-Type Preflight Check (Confidence: 95%)** - The code does not verify that the upstream response has `content-type: text/event-stream` before attempting SSE parsing. When Dify returns JSON errors (401, 404, 500), the SSE parser fails and triggers the generic `fetch_error` response.

2. **Environment Variable Configuration Issue (Confidence: 80%)** - While the code references the correct env vars, there may be a mismatch between expected vs actual Dify URL/key values causing upstream authentication failures.

3. **Upstream Request Timeout During Connect Phase (Confidence: 70%)** - The safety timeout (235s) may be aborting before the upstream connect completes, especially under load.

---

## 2) Trace of the Initialize Streaming Path

**Entrypoint:** [`routes/draft.js:102`](routes/draft.js:102)
```javascript
router.post('/initialize', async (req, res) => {
  const isStreaming = req.query.stream;
  if (isStreaming) {
    // Enter streaming mode
```

**Route Handler:** [`routes/draft.js:165-501`](routes/draft.js:165)
```javascript
if (isStreaming) {
  const timeoutMs = 235000; // ~235s (≈3:55)
  
  // Set NDJSON streaming headers
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
```

**Upstream Call:** [`routes/draft.js:264-275`](routes/draft.js:264)
```javascript
const response = await fetch(DIFY_API_URL, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${DIFY_SECRET_KEY}`,
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
    'Cache-Control': 'no-cache'
  },
  body: JSON.stringify(difyPayload),
  signal: controller.signal,
  duplex: 'half'
});
```

**Error Handler:** [`routes/draft.js:433-494`](routes/draft.js:433)
```javascript
catch (error) {
  const errorEvent = {
    event: 'error',
    data: {
      error: error.name === 'AbortError' ? 'timeout' : 'fetch_error',
      code: error.code || error.cause?.code || error.name,
      message: error.message
    }
  };
  res.write(JSON.stringify(errorEvent) + '\n');
}
```

---

## 3) Verification Checklist

| Check | Status | Location | Details |
|-------|--------|----------|---------|
| **Headers to client (NDJSON)** | ✅ PASS | [`routes/draft.js:199-203`](routes/draft.js:199) | Correct NDJSON headers set |
| **Compression bypass** | ✅ PASS | [`index.js:98-99`](index.js:98) | Route excluded from compression |
| **`flushHeaders` called** | ✅ PASS | [`routes/draft.js:203`](routes/draft.js:203) | `res.flushHeaders?.()` called |
| **Upstream `Accept: text/event-stream`** | ✅ PASS | [`routes/draft.js:269`](routes/draft.js:269) | Correct Accept header |
| **Upstream `Content-Type: application/json`** | ✅ PASS | [`routes/draft.js:268`](routes/draft.js:268) | Correct Content-Type |
| **Streaming payload (`response_mode: streaming`)** | ✅ PASS | [`routes/draft.js:246`](routes/draft.js:246) | Correctly set |
| **`duplex: 'half'` set** | ✅ PASS | [`routes/draft.js:274`](routes/draft.js:274) | Present for POST+body |
| **Preflight status/content-type check** | ❌ FAIL | [`routes/draft.js:280-283`](routes/draft.js:280) | Only checks `response.ok`, no content-type validation |
| **Connect/watchdog timeout reasonable** | ✅ PASS | [`routes/draft.js:168`](routes/draft.js:168) | 235s safety timeout |
| **Error mapping surfaces code/name** | ⚠️ PARTIAL | [`routes/draft.js:475-482`](routes/draft.js:475) | Only in debug mode or non-production |
| **Env vars read points** | ✅ PASS | [`routes/draft.js:23-24`](routes/draft.js:23) | `DIFY_API_URL`, `DIFY_SECRET_KEY` |

---

## 4) Findings with Evidence

### ❌ **CRITICAL: Missing Content-Type Preflight Check**
**What:** No validation that upstream response is SSE before parsing  
**Why:** When Dify returns JSON errors (401/404), SSE parser fails  
**Where:** [`routes/draft.js:280-283`](routes/draft.js:280)
```javascript
if (!response.ok) {
  const errorText = await response.text();
  throw new Error(`Dify API error: ${response.status} ${errorText.slice(0, 200)}`);
}
// Missing: if (!response.headers.get('content-type')?.includes('text/event-stream'))
```
**Fix:** Add content-type check before SSE parsing

### ⚠️ **HIGH: Limited Error Detail Surfacing**
**What:** Real error codes/names only shown in debug mode  
**Why:** Production users get generic `fetch_error` without actionable details  
**Where:** [`routes/draft.js:485-489`](routes/draft.js:485)
```javascript
if (process.env.NODE_ENV !== 'production' || process.env.DEBUG_STREAM_INIT) {
  errorEvent.data.name = error.name;
  errorEvent.data.hasUrl = !!process.env.DIFY_URL;
  errorEvent.data.hasKey = !!process.env.DIFY_API_KEY;
}
```
**Fix:** Always surface basic error types (timeout, auth, network)

### ⚠️ **MEDIUM: Environment Variable Reference Inconsistency**
**What:** Debug code references `DIFY_URL`/`DIFY_API_KEY` vs actual `DIFY_API_URL`/`DIFY_SECRET_KEY`  
**Why:** Debug flags may show incorrect values  
**Where:** [`routes/draft.js:487-488`](routes/draft.js:487)
```javascript
errorEvent.data.hasUrl = !!process.env.DIFY_URL;  // Should be DIFY_API_URL
errorEvent.data.hasKey = !!process.env.DIFY_API_KEY;  // Should be DIFY_SECRET_KEY
```
**Fix:** Use consistent environment variable names

### ⚠️ **LOW: No Buffer Growth Limits**
**What:** SSE buffer can grow unbounded  
**Why:** Large responses could cause memory issues  
**Where:** [`routes/draft.js:318`](routes/draft.js:318)
```javascript
buffer += chunk;  // No size limit check
```
**Fix:** Add buffer size limit (e.g., 10MB max)

---

## 5) "1-Minute Verifications" Playbook

### Test Upstream Authentication
```bash
curl -X POST https://api.dify.ai/v1/chat-messages \
  -H "Authorization: Bearer app-LL6pTn3teugLdXw4C8RQM9KR" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"user":"test","query":"hello","response_mode":"streaming"}'
```
**Expected:** SSE stream starting with `data: {"event":"message_start"...}`  
**If 401:** Invalid API key  
**If 404:** Wrong URL or app ID  
**If JSON response:** Dify not configured for streaming

### Test Streaming Endpoint
```bash
curl -X POST http://localhost:3000/api/draft/initialize?stream=1 \
  -H "Content-Type: application/json" \
  -d '{
    "user": "test",
    "payload": {
      "numTeams": 10,
      "userPickPosition": 5,
      "players": [{"id":"1","name":"Test Player","position":"RB"}]
    }
  }'
```
**Expected:** NDJSON stream `{"event":"...","data":{...}}`  
**If `fetch_error`:** Check upstream auth and content-type

### Expected Log Lines by Scenario

**Normal Success:**
```
[DEBUG_STREAM_INIT] Route entry: wantsStream=1, simulate=undefined, timeout=235000ms
[DEBUG_STREAM_INIT] Headers flushed for real streaming
[DEBUG_STREAM_INIT] AbortController created: id=abc123def, timeout=235000ms
[DEBUG_STREAM_INIT] Upstream fetch start: URL=https://api.dify.ai/v1/chat-messages, Accept=text/event-stream
[DEBUG_STREAM_INIT] First upstream chunk received
```

**Auth Failure:**
```
[DEBUG_STREAM_INIT] Route entry: wantsStream=1, simulate=undefined, timeout=235000ms
[DEBUG_STREAM_INIT] Headers flushed for real streaming
[DEBUG_STREAM_INIT] Upstream fetch start: URL=https://api.dify.ai/v1/chat-messages, Accept=text/event-stream
[DEBUG_STREAM_INIT] Upstream fetch failure: { where: 'initialize:upstream', name: 'Error', message: 'Dify API error: 401...' }
```

**Timeout:**
```
[DEBUG_STREAM_INIT] Safety timeout fired for controller=abc123def
[STREAMING][initialize] Safety timeout triggered after 235s
```

---

## 6) Appendix

### All Timeouts Table
| Timeout Type | Value | Location | Purpose |
|--------------|-------|----------|---------|
| Express Route | 320s | [`routes/draft.js:106`](routes/draft.js:106) | Overall request timeout |
| Safety Timeout | 235s | [`routes/draft.js:168`](routes/draft.js:168) | Stream processing timeout |
| Server Socket | 3000s | [`index.js:593`](index.js:593) | Server-wide timeout |
| Headers Timeout | 3100s | [`index.js:594`](index.js:594) | Header read timeout |
| Keep-Alive | 3000s | [`index.js:595`](index.js:595) | Connection keep-alive |

### SSE→NDJSON Parser Sketch
```javascript
// Input: SSE format
data: {"event":"message","answer":"Hello"}

data: {"event":"message_end"}

// Output: NDJSON format  
{"event":"message","data":{"event":"message","answer":"Hello"}}
{"event":"message_end","data":{"event":"message_end"}}
```

### Environment Variables List
| Variable | Default | Usage | Required |
|----------|---------|-------|----------|
| `DIFY_API_URL` | `https://api.dify.ai/v1/chat-messages` | Upstream API endpoint | ✅ |
| `DIFY_SECRET_KEY` | *(none)* | API authentication | ✅ |
| `MAX_INIT_PLAYERS` | `50` | Player limit for initialize | ❌ |
| `LLM_BLOCKING_TIMEOUT_MS` | `3000000` | Blocking request timeout | ❌ |
| `DEBUG_STREAM_INIT` | *(none)* | Enable debug logging | ❌ |

---

**Recommendation:** Start by adding the content-type preflight check, as this is the most likely cause of the `fetch_error` issue when upstream returns JSON instead of SSE.