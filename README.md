# ElevateBox AI Caller

An AI voice agent that places outbound sales/support calls over Twilio, holds a natural conversation in English, Hindi, Telugu, or Tamil (with mid-call code-switching), captures structured lead/support data as it learns it, and follows up over WhatsApp once the call ends.

## Architecture

```
                         ┌─────────────────────────────────────────────┐
                         │                  Twilio                     │
                         │  places/receives the PSTN call, streams     │
                         │  raw 8kHz mu-law audio over a WebSocket     │
                         └───────────────┬─────────────────────────────┘
                                         │
                    POST /api/call/start │ (trigger)
                                         ▼
        ┌───────────────────┐   TwiML   ┌───────────────────┐   media WS   ┌───────────────────────┐
        │ api/twilio/voice   │──────────▶│  Twilio call leg   │─────────────▶│  api/media-stream      │
        └───────────────────┘           └───────────────────┘              └───────────┬────────────┘
                                                                                          │
                                                                            VOICE_PIPELINE│
                                                    ┌─────────────────────────────────────┴───────────────────────────────────┐
                                                    ▼                                                                         ▼
                                     ┌───────────────────────────┐                                       ┌───────────────────────────────┐
                                     │   "realtime" pipeline      │                                       │   "cascaded" pipeline (default) │
                                     │   OpenAI Realtime API —    │                                       │   Soniox → LLM → TTS, chained   │
                                     │   one integrated STT+LLM+  │                                       │   by CascadedBridge             │
                                     │   TTS session               │                                       └───────────────┬───────────────┘
                                     └───────────────────────────┘                                                        │
                                                                                ┌───────────────────────────────────────────┼───────────────────────────────────────────┐
                                                                                ▼                                           ▼                                           ▼
                                                                    ┌─────────────────────┐                    ┌─────────────────────┐                   ┌─────────────────────────┐
                                                                    │  Soniox (STT)        │   text + turn-end  │  DialogueClient (LLM) │   sentence chunks │  Cartesia / Sarvam (TTS) │
                                                                    │  streaming mu-law in │───────────────────▶│  OpenAI gpt-4o-mini   │──────────────────▶│  bulbul:v3, per-language │
                                                                    │  language detection  │                    │  or Sarvam sarvam-    │                   │  voice routing            │
                                                                    │  + endpoint/barge-in │                    │  105b-conversations   │                   │  audio → back to Twilio   │
                                                                    └─────────────────────┘                    └───────────┬───────────┘                   └─────────────────────────┘
                                                                                                                            │ tool calls
                                                                                                                            ▼
                                                                                                              ┌───────────────────────────┐
                                                                                                              │ capture_qualification      │
                                                                                                              │ schedule_callback          │
                                                                                                              │ end_call                   │
                                                                                                              └─────────────┬─────────────┘
                                                                                                                            │
                                                             ┌──────────────────────────────────────────────────────────────┴──────────────────────────────────┐
                                                             ▼                                                                                                  ▼
                                                ┌───────────────────────────┐                                                                    ┌───────────────────────────┐
                                                │  CallSession (in-memory)   │                                                                    │  QStash (durable callback) │
                                                │  qualification, callback,  │                                                                    │  fires /api/callback/fire  │
                                                │  transcript, callType      │                                                                    │  at the scheduled time      │
                                                └─────────────┬─────────────┘                                                                    └───────────────────────────┘
                                                              │ on call completed (api/twilio/status)
                                                              ▼
                                                ┌───────────────────────────┐
                                                │  WhatsApp Cloud API        │
                                                │  sales: recap + resume +   │
                                                │  architecture diagram      │
                                                │  support: short ack        │
                                                └───────────────────────────┘
```

### Call flow, end to end

1. **Trigger** — `POST /api/call/start` (authenticated via `x-call-secret`) places an outbound call through Twilio's REST API and creates a `CallSession` keyed by `callSid` ([src/state/call-session.ts](src/state/call-session.ts)).
2. **Connect** — Twilio hits `/api/twilio/voice`, which returns TwiML opening a bidirectional Media Stream WebSocket to `/api/media-stream`. `/api/twilio/status` receives call-status webhooks (ringing → in-progress → completed) and triggers the post-call WhatsApp follow-up once the call ends.
3. **Voice pipeline** — set via `VOICE_PIPELINE`:
   - **`cascaded`** (default): [src/cascaded/cascaded-bridge.ts](src/cascaded/cascaded-bridge.ts) wires three independent services together — [soniox-client.ts](src/cascaded/soniox-client.ts) (streaming STT, no resampling needed since Twilio's native 8kHz mu-law goes straight in), [dialogue-client.ts](src/cascaded/dialogue-client.ts) (plain streamed Chat Completions, routed per-language between OpenAI and Sarvam), and two interchangeable TTS engines behind a common `TtsEngine` interface ([tts-engine.ts](src/cascaded/tts-engine.ts)) — [cartesia-client.ts](src/cascaded/cartesia-client.ts) and [sarvam-tts-client.ts](src/cascaded/sarvam-tts-client.ts). Handles barge-in, sentence-chunked TTS flushing, silence-tail padding, and idle/duration timeouts.
   - **`realtime`**: wires the same Twilio stream directly into OpenAI's Realtime API — one integrated session instead of separate STT/LLM/TTS hops.
4. **Tools** — the model calls `capture_qualification`, `schedule_callback`, and `end_call` mid-conversation ([src/realtime/tools.ts](src/realtime/tools.ts), dispatched via [src/agent/sales-agent.ts](src/agent/sales-agent.ts)). `schedule_callback` schedules a durable QStash job that fires `/api/callback/fire` at the resolved time.
5. **Wrap-up** — on call completion, [src/services/whatsapp.ts](src/services/whatsapp.ts) sends a follow-up via Meta's WhatsApp Cloud API (sales calls get a recap + resume + architecture diagram; support calls get a short acknowledgment), and a full transcript is written to `transcripts/*.md`.

### Agent behavior

The system prompt ([src/agent/prompt.ts](src/agent/prompt.ts)) drives a single persona ("Aarav") through:
- **Intent routing** — distinguishes a new sales lead from an existing customer/support call before doing anything else, branching into a **Sales Flow** (discovery → pitch → objection handling → HOT/WARM/COLD classification) or a **Support Flow** (capture the issue, urgency, and callback window — no sales pitch, no classification).
- **Language handling** — starts every call in English, then switches to Hindi/Telugu/Tamil once a substantial caller line establishes that language (immediate single-turn switch, matching natural bilingual conversation — never announced out loud), writing native-script text so TTS pronounces it correctly.
- **Conversation mechanics** — waits for the caller to actually finish before replying, yields cleanly when interrupted, and won't fabricate specifics (budget, timeline, features) when a reply was unclear rather than genuinely vague.

## Tech stack

| Concern | Service | Notes |
|---|---|---|
| Telephony | [Twilio](https://www.twilio.com/) | Outbound calls, Media Streams (bidirectional audio WS) |
| Speech-to-text | [Soniox](https://soniox.com/) | Streaming STT, language ID, endpoint/turn detection |
| Dialogue LLM | OpenAI (`gpt-4o-mini`) + [Sarvam AI](https://www.sarvam.ai/) (`sarvam-105b-conversations`) | Routed per-language; both speak the OpenAI Chat Completions wire format |
| Text-to-speech | [Cartesia](https://cartesia.ai/) (`sonic-3.5`) + Sarvam (`bulbul:v3`) | Routed per-language; per-language voice ID overrides supported |
| Realtime alternative | OpenAI Realtime API | Single integrated STT+LLM+TTS session, selected via `VOICE_PIPELINE=realtime` |
| Follow-up messaging | WhatsApp Cloud API (Meta) | Post-call recap/support-ack, template-first with a free-form fallback |
| Durable scheduling | [Upstash QStash](https://upstash.com/docs/qstash) | Fires scheduled callbacks even across serverless cold starts |
| Hosting | [Vercel](https://vercel.com/) | Each `api/*.ts` file is a serverless function (see `vercel.json` for per-route `maxDuration`) |
| Language | TypeScript, Node 20+ | `vitest` for tests, `tsc --noEmit` for type-checking |

## Local development

```bash
npm install
npm run dev:local     # plain Node http server wiring the same api/*.ts handlers Vercel uses
```

`scripts/dev-server.ts` is dev-only — it never ships, and exists purely to run the exact same `api/*.ts` handler files without needing `vercel dev`'s interactive login. Expose it to Twilio/Meta with a tunnel (e.g. `ngrok http 3000`) and point `PUBLIC_BASE_URL` at the tunnel URL.

Copy `.env.example` to `.env.local` and fill in the required keys (Twilio, OpenAI, Soniox, Cartesia, Sarvam, WhatsApp Cloud API, QStash) — see the inline comments there for what's required vs. optional and how provider routing works.

```bash
npm run typecheck
npm test
```
