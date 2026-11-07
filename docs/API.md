# API contract

Base `/api/v1`. Requests/responses use JSON except CSV export and WAV voice preview. An org-scoped httpOnly session cookie is required for every API, monitor and browser WebSocket except login. Read-only users cannot mutate; browser test calls require admin. `GET /healthz` and `/readyz` are public. Twilio routes are public only behind Twilio signature verification.

Machine-readable [OpenAPI.json](OpenAPI.json) is generated from `apps/server/src/openapi.ts` and the shared Zod contracts. The authenticated live copy is `/api/v1/openapi.json`. The shared schemas are the source of truth. The spec includes core routes and schema-backed campaign/contact/destination bodies; settings/auth bodies and WebSocket protocol are detailed here rather than falsely implying a complete generated response model.

## Authentication

`POST /auth/login` body `{ "email": "operator@example.test", "password": "..." }` → sets session cookie and returns `email`, `role`, `csrf`. Five attempts per minute per IP. Cookies are httpOnly, SameSite Strict, Secure in production, signed when SESSION_SECRET is configured. Tokens are hashed in Postgres, expire after 12 hours. Production enforces a 32+ character session secret. `GET /auth/me` returns current CSRF token; `POST /auth/logout` invalidates session.

Every mutation sends `X-CSRF-Token` from the session response. Send no JSON content type when a request has no body. Launch/resume additionally require an `Idempotency-Key` of 8–120 characters. Browser WebSockets validate the Origin against PUBLIC_BASE_URL.

## Routes

| Method | Path | Body / meaning |
|---|---|---|
| GET / POST | `/campaigns` | List / create validated Campaign |
| GET / PUT / DELETE | `/campaigns/:id` | Read / replace paused draft configuration / delete campaign data |
| POST | `/campaigns/:id/launch`, `/pause`, `/resume`, `/stop` | Start/queue or change status; idempotency key for launch/resume |
| POST | `/campaigns/:id/contacts` | Array of Contact rows; per-row valid/invalid/duplicate/suppressed report |
| GET | `/contacts?campaign_id=<uuid>` | Contact rows; optional campaign filter |
| POST | `/contacts/validate` | Validate rows before saving; does not dial or import |
| DELETE | `/contacts/:id` | Delete contact and associated calls/results |
| GET | `/calls`, `/calls/:id` | List, or call plus matching result |
| DELETE | `/calls/:id` | Delete call/result/deliveries after active call ends |
| GET | `/results` | Saved call results; internal DB always on |
| GET | `/results/export?campaign_id=<uuid>` | UTF-8 CSV, formula-neutralized cells |
| GET / POST | `/suppression` | List / `{ "phone": "+12025550101" }` |
| DELETE | `/suppression/:id` | Deliberately remove DND entry; audited |
| GET / POST | `/destinations` | List / `{name,kind:"webhook",url:"https://public.example/hook",enabled:true}` |
| DELETE | `/destinations/:id` | Remove destination configuration |
| POST | `/destinations/:id/test` | Explicit synthetic test-send |
| GET | `/deliveries` | Pending/delivered/dead-letter entries |
| POST | `/deliveries/:id/retry` | Restart attempts using original idempotency key |
| GET / PUT | `/settings` | `{retention_days,kill_switch,global_daily_minutes,global_daily_stt_seconds,global_daily_tts_chars,rates}` |
| GET | `/team`, `/audit-log` | Org users/roles and audit metadata |
| GET | `/providers` | Configuration state, attribution, documented voice/language lists; no paid probe |
| GET | `/analytics` | Separate real vs sample/simulation aggregates; missing metrics null |
| POST | `/voice-preview` | `{voice,language}` → WAV from a short real Timbre phrase; unavailable in mocks |
| GET | `/openapi.json` | Machine-readable contract |

Calling gate failures appear in each contact's `blocked_reason`. A launch queues work; it does not mean a dial passed consent/window/suppression/cap checks. Callback and retry jobs use the same gate. On queue concurrency saturation, work is deferred. Terminal contact states prevent duplicate dialing. Browser tests do not dial a phone.

List endpoints currently cap at 5,000 rows; pagination is a documented scaling follow-up. Export is CSV, not XLSX. Team provisioning/reset is administrative; no user-invitation email is sent.

## Browser transport

`GET /ws/browser/:campaignId` upgrades only for an authenticated admin with the exact Origin. Server first emits `{type:"ready",simulation,note}`. Client sends `{type:"start"}`; server emits `{type:"started",call_id}`. Audio input is binary signed PCM16LE mono **8 kHz** (browser capture downsamples before sending). Output is `{type:"audio",format:"mulaw",sample_rate:8000,audio:"<base64>"}` in 160-byte/20ms frames. Decode μ-law and queue playback. Server `{type:"mark",name}` is acknowledged after queued audio ends with `{type:"mark",name}`. `{type:"clear"}` stops pending playback. Client `{type:"end"}` ends and persists the call.

In explicit mock mode only, `{type:"text",text:"synthetic caller answer"}` injects a caller turn. Mock TTS is silence, and the UI states this. Text injection is rejected for live provider calls. Disconnect finalizes the result. Early caller turns wait until mandatory opening disclosure completes.

## Monitor

`GET /ws/monitor`, authenticated with same Origin, sends `connected`, `transcript`, `stage`, `tool`, `fields`, `provider`, `barge_in`, `error`, `latency`, `result` messages. Envelope `{call_id,type,data}`. Tenant isolation applies; subscriptions are process-local. Select a call in the monitor before interpreting its flow. Monitor events are transient; completed records are in Postgres.

## Twilio

`POST /twilio/voice?call_id=<uuid>` returns Connect/Stream TwiML; AMD machines/faxes hang up and save VOICEMAIL. `POST /twilio/status?call_id=<uuid>` handles lifecycle and failures. Both verify `X-Twilio-Signature` against exact PUBLIC_BASE_URL + request URL and parsed form fields. Inbound unknown calls do not create arbitrary campaigns.

`GET /twilio/media` verifies the upgrade signature, then requires start's `callSid` to match the reserved call, binds `streamSid`, verifies `audio/x-mulaw`, 8000 Hz, mono. Inbound media uses that stream. Connected/mark/stop are handled; DTMF/unknown events are ignored. Outbound media/mark/clear use the bound stream ID. [Twilio message reference](https://www.twilio.com/docs/voice/media-streams/websocket-messages).

## Result submission

Internal DB save and delivery outbox insert are transactional. Sales HOT/WARM requires explicit verbal follow-up consent; completed/declined HR screening is advisory and eligible for submission. Result includes agent version, outcome, redacted transcript, validated fields, tool results, language, latency, metered usage and visible provider trace. Receiver HTTPS is checked/pinned to a public IP; redirects are not followed.

Headers: `Idempotency-Key`, `X-Caller-Timestamp` (Unix seconds), `X-Caller-Signature` = hex HMAC-SHA256 over `timestamp + "." + exact JSON bytes`, using WEBHOOK_SIGNING_SECRET. Receivers verify freshness and compare securely, deduplicate keys, then return 2xx. At-least-once delivery and dead-letter behavior are described in RUNBOOK.md.

## Errors

Validation/domain failures return `{error}` with a non-2xx status. Auth 401, role/CSRF/signature 403, missing campaign 404 where applicable, rate limit 429. Provider failures emit visible events and save FAILED rather than substituting a fake successful conversation. Missing measurements remain unknown. Never log or copy request bodies containing credentials into bug reports.
