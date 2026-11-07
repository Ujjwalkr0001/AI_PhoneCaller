# Prototype audit — 7 November 2026

Baseline: `58f1cb5`, ElevateBox AI Caller by Ujjwal / original repository contributors. Original files remain in git history. This audit precedes application changes. No live provider calls were made during the audit. The unmounted prototype files described below were removed from the current tree during the live-calling cleanup; the table records the original review.

| Module | Responsibility and verified evidence | Decision |
|---|---|---|
| `api/call/*` | start uses shared header, trigger has **no authentication**; list/status expose process-local records. Regex-only telephone validation. | Replace with authenticated, org-scoped versioned routes and compliance gate. |
| `api/media-stream.ts` | Creates `http.Server` + `WebSocketServer`, exports server; no production `listen`. Local runner forwards upgrade events. `maxDuration:300` does not establish WebSocket hosting. Cold-start pinger comment is misleading. | Persistent Fastify WebSocket runtime; never deploy old functions. |
| `api/twilio/*` | Voice returns Connect/Stream TwiML; status mutates Map and invokes follow-up. No Twilio signature verification. WhatsApp logs body/from. | Port TwiML/status; validate signatures including media handshake. |
| `api/callback/*` | QStash raw-body signature check is useful; immediately dials without suppression, window or cap checks. | pg-boss callback jobs with gate on every attempt. |
| `api/whatsapp/*`, `api/config.ts` | Meta verification GET; POST lacks authenticity check; logs sender/text and failed verification token. Config exposes rep contact. | Do not mount legacy endpoints. Optional approved-template adapter only. |
| `src/cascaded/*` | Useful cancellable generation, sentence chunking, language hints, silence padding, TTS interface and provider wrappers. Bridge currently instantiates Sarvam directly. STT/TTS startup errors are caught while call continues in silence. No persistent result or failover trace. μ-law encoder uses wrong bias/clipping constants for 16-bit input. | Preserve architecture and reusable wrappers; new dependency-injected pipeline with tested codec, Gnani adapters and visible failures. Keep old bridge as reference, outside runtime. |
| `src/agent/*` | Static Aarav/ElevateBox prompt; INR qualification heuristics; explicit callback parser. No campaign schema, disclosure enforcement, HR policy or DND tool. | Versioned campaign prompt builder and deterministic field/state/outcome validation. Reuse callback parser with explicit-time confirmation. |
| `src/realtime/*` | Earlier OpenAI realtime bridge includes clear/mark/truncate and reconnect. `session.ts` now chooses cascaded bridge exclusively. Tools log raw arguments; delayed hangup is timer-based. | Reuse event helpers and provider wrappers; new org-scoped pipeline and playback acknowledgments. No OpenAI audio used in Gnani path. |
| `src/services/*` | Twilio REST wrapper useful; local Markdown transcripts include telephone in filename; QStash scheduling lacks application persistence. WhatsApp always attempts sales résumé/architecture send and fallback free-form. Follow-up errors often swallowed. | Replace persistence/queue/submission; keep legacy source unmounted. Never serve personal résumé. |
| `src/state/*` | One global `Map`; lost on restart; unbounded; instances cannot share state. | Postgres persistent records; only active audio connection remains in memory and pinned to machine. |
| `src/utils/*` | Callback parser has multilingual casual phrases with ambiguity safeguards. Logger has correlation but dumps metadata, no PII redaction. | Keep parser, add safe structured logs. |
| `scripts/*` | Local development HTTP adapter explains why WebSockets work locally. WhatsApp diagnostics make live external sends, unguarded; `test-post-call.ts` omits required callType. | Replace default scripts; legacy diagnostics excluded from runtime and CI. No diagnostic sends in development. |
| `tests/*` | Two suites: qualification and callback parsing. No transport/security/grounding/compliance integration coverage. | Retain baseline tests; add domain, protocol, security and end-to-end tests against mocks. |
| `public/*` | Small dark single-number dialer, polls history, no campaigns/auth. `Resume.pdf` is a personal artifact, not synthetic data. | New React SPA; legacy public directory never served or copied into image. Remove personal PDF from current tree; history remains unchanged. |
| root config | Vercel function map; strict TS; no DB, auth, CI or container. No lockfile. | pnpm workspace + persistent container; preserve history. |

## Verification limits

There is no evidence of a working production WebSocket deployment in the repository. Local dev explicitly forwards upgrade requests, while the Vercel handler exports a server object. Vercel documents that Functions do not act as WebSocket servers: https://vercel.com/docs/functions/limitations#websockets . Neither an uptime pinger nor a function duration change fixes this topology.

Inspected source/configuration, scripts, tests and existing static UI; binary architecture image is a reference artifact, and the personal PDF must not be exposed. Existing secret values were not needed. No claim is made that previously reported real-call observations in comments have been independently reproduced.

## Archive after migration

The original `api/` and `vercel.json` were archived after migration and have now been removed from the current tree. Their original paths above describe the audited baseline. Git history preserves them; the old runtime is not supported.
