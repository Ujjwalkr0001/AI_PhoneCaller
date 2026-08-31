// -----------------------------------------------------------------------
// This is the ONLY module that talks to the backend. Endpoints:
//
//   placeCall(phone)        -> POST /api/call/trigger      body: { to: phone }
//                               (see api/call/trigger.ts)  -> { callSid, status }
//   getCallStatus(callSid)  -> GET  /api/call/status?callSid=...
//                               (see api/call/status.ts)   -> CallSession
//   listCalls()             -> GET  /api/call/list
//                               (see api/call/list.ts)     -> { calls: [...] }
// -----------------------------------------------------------------------

async function requestJson(url, options) {
  const res = await fetch(url, options);
  let data = null;
  try {
    data = await res.json();
  } catch {
    // no/invalid JSON body — fall through to the status-based error below
  }
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

export async function placeCall(phone) {
  return requestJson('/api/call/trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: phone }),
  });
}

export async function getCallStatus(callSid) {
  return requestJson(`/api/call/status?callSid=${encodeURIComponent(callSid)}`);
}

export async function listCalls() {
  const data = await requestJson('/api/call/list');
  return data.calls;
}
