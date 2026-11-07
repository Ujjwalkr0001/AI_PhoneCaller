# Human setup and remaining verification

The local build and simulation are implemented. **Live Gnani/Twilio operation and public deployment are not verified or deployed.** No real calls, external messages, contest posts or form submissions were made.

## Accounts and server secrets

- [ ] Supply a Gnani API key with Prisma v3.0 streaming and Timbre v3.0 permissions/credits (`GNANI_API_KEY`). Run the gated spike with a synthetic/consented 8 kHz mono PCM16LE fixture; record exact observations.
- [ ] Verify the retrieved Gnani contract for your account: STT `wss://api.vachana.ai/stt/v3/stream`, `x-api-key-id`, language_code/model/format headers, exactly 1024-byte paced PCM frames, `speech_start`/`processing`/`transcript` and detected language. TTS SSE endpoint, key header, voice/model compatibility, raw μ-law chunks and complete/error events. The adapter is documented/protocol-mocked; it has not been run against your account.
- [ ] Verify enabled languages/voices and actual pronunciation, including Hinglish and native-script material. Configure approved native-script facts/questions; the conservative grounding gate rejects novel translated assertions. Validate the translated disclosure with native speakers.
- [ ] Supply/verify the separate dialogue key/model/URL (`DIALOGUE_API_KEY`, etc.). JSON-object streaming and token usage support must be tested. Keep actual LLM attribution in UI and README.
- [ ] Set independent SESSION_SECRET (32+ chars), WEBHOOK_SIGNING_SECRET, seed admin email and a strong 12+ character seed password. Production requires HTTPS. Changing seed credentials does not reset an existing account.
- [ ] Create separate staging/prod databases; enable PITR and perform a restore drill. Use direct/session-mode Postgres for pg-boss, not transaction-mode pooling.
- [ ] Optional live fallback keys: Soniox, Cartesia or Sarvam. Verify fallback formats/languages and visible traces before enabling. Mock fallback is never automatic.

## Twilio and operator obligations

- [ ] Configure separate staging/prod Twilio numbers, account SID/token, verified teammate destinations for trial restrictions, appropriate geographic/routing permissions and PUBLIC_BASE_URL.
- [ ] Wire voice POST `/twilio/voice`, status `/twilio/status`, media `wss://<host>/twilio/media`. Outbound adapter appends its call ID. Verify real webhook/upgrade signatures, AMD, media framing, barge-in clear, mark acknowledgments and hangup.
- [ ] Obtain consent, meet applicable DLT/NCPR/TRAI registration and national DND scrubbing obligations. This app supplies checks/hooks and suppression; it does not perform national registry scrubbing or certify compliance.
- [ ] Keep test mode on and allow only teammates' own phones. Verify immediate DND suppression and no redial after a process restart. Use synthetic or consented data only.

## Public deployment

- [ ] Install/sign in to Fly; no Fly token was configured. Confirm `sin` region availability with `fly platform regions`, unique staging/prod app names, account billing and machine capacity. Fill GitHub environment variables/secrets.
- [ ] Set Fly secrets using [DEPLOY.md](docs/DEPLOY.md), deploy with `fly deploy --remote-only --app <staging-app>`, keep one always-on machine and separate database. No public staging URL currently exists.
- [ ] Configure required reviewers on GitHub `prod` environment and CI branch protection. Do not assume YAML alone creates manual approval.
- [ ] Run `SMOKE_BASE_URL=https://<staging-host> pnpm smoke`. Provide `SMOKE_DESTINATION_ID` for a consenting synthetic public receiver, verify HMAC/idempotency at the receiver, and inspect an actual successful submission. Receiver sends were not run here.
- [ ] Run real browser microphone → Prisma → dialogue → Timbre; listen for disclosure, factual grounding and turn-taking. Then call a teammate with explicit consent. No live-provider success is claimed by the local tests.
- [ ] Measure sustained concurrency on the actual Fly VM before increasing limits. The local four-client/two-second mock observation is not a production capacity N.
- [ ] Wire uptime/alerts, check masking, perform deployment drain/rollback and DB restore exercises. Fly/managed account configuration cannot be verified from source alone.

## Product limits to review before commercial use

- [ ] Live multilingual quality, provider reconnection, fallback compatibility and real acoustic latency remain unverified. Silence/repeat/abuse and deterministic safety paths have mock tests; they are not a substitute for listening to actual calls.
- [ ] Conservative extractive grounding favors follow-up responses over new paraphrases. Human review is required for approved facts, price policy, native-script questions and volunteered sensitive data.
- [ ] List endpoints currently cap at 5,000 rows; add pagination/SQL aggregation before larger operation. Multi-machine monitor fan-out is not implemented. Keep one machine.
- [ ] Team UI lists seeded users; self-service team provisioning/password resets are not implemented. Recording remains disabled. Optional WhatsApp/SMS, Google Sheets, warm transfer and generated FAQs are intentionally omitted.
- [ ] Consider an AudioWorklet and more rigorous browser resampling/echo evaluation for production audio. Provider token usage and invoice rounding may differ from estimates.

## Submission checklist (brief deadline: 10 Nov 2026, 11:59 PM IST)

- [ ] Staging URL live and provider traces prove genuine Gnani speech usage.
- [ ] Demo recorded with clear live/simulation labels and only synthetic/consented information.
- [ ] Real LLM held-out evaluation run if reporting metrics; otherwise retain **not run**. Never infer provider accuracy/latency from mocks.
- [ ] README, SUBMISSION.md, screenshots and claims re-verified against the final repository and actual live evidence.
- [ ] Contribution table completed with one row per actual human team member; distinguish AI assistance.
- [ ] Verify official contest rules, required hashtags and exact Gnani account to tag; publish required posts yourself.
- [ ] Nominate actual post links in the contest form, verify all links and submit before the confirmed deadline.
