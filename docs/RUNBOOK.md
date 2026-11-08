# Operations runbook

## Before enabling live dialing

Confirm staging readiness and actual Gnani STT/TTS browser audio, exact dialogue attribution, approved fact sheets/native-script questions, suppression, signed Twilio callbacks, operator attestation, calling hours, teammate allowlist, budget caps and a monitored result receiver. Confirm managed database PITR and complete a restore drill. Ensure GitHub production environment requires human reviewers. Keep production sample data out of live analytics.

## Pause / kill switch

Settings → Pause all dialing sets the tenant's persisted kill switch; existing calls complete. Pause/stop a campaign to stop new jobs for it. For an emergency involving ongoing calls, use Twilio's call controls or stop the machine; this interrupts audio. A normal campaign pause is not an active-call hangup.

## Gnani or dialogue outage

Inspect the per-call provider trace and monitor errors. Missing keys show as missing; configured providers are not advertised as healthy without a live probe. TTS fails over only to explicitly configured `TTS_FALLBACK=cartesia|sarvam`, before any audio for that sentence has been emitted; a partly spoken sentence is not replayed. STT tries one reconnect and can then switch to explicitly configured `STT_FALLBACK=soniox`. A reconnect can lose the interrupted utterance; ask the caller to repeat during manual review. If unavailable, the call fails visibly. Mocks are never an automatic fallback.

Set or rotate fallback keys on the server, verify the providers' own language/voice support, then test a teammate call. Unsupported/unavailable languages must not be marketed as supported merely because an environment variable exists. Existing fallback wrappers are retained from the prototype; live fallback compatibility remains unverified.

## Recruitment flow and response delay

Recruitment uses a server-owned question list: relevant experience, must-have skills, other configured role questions, salary, location, notice period, then interview availability. Each question keeps its configured field key. Repeats and candidate questions do not advance the list; explicit skips are saved as unknown. The server asks all questions before role Q&A and follow-up consent. Clearly unrelated personal questions are rejected in new configurations and omitted from legacy call plans. The effective plan is saved in the call snapshot. OpenAI answers candidate questions using approved role facts and generates the post-call note; it cannot skip interview stages.

Routine recruitment answers avoid a model round trip. The next fixed question is prepared during current playback in a per-call memory cache, canceled when the call ends, and included in generated TTS character usage. Speech requests are serialized per Gnani key. HTTP 429/503 responses receive at most two short retries before any audio has been emitted; long retry windows and exhausted retries remain visible failures. This avoids overlapping background work with active synthesis and replaying spoken audio.

`GNANI_MIN_SILENCE_MS` defaults to 350 ms and is bounded to 300-1000 ms. Raise it if a caller's natural pauses are split. Logs include `screening_question` ordinal/field IDs and `latency` route, cache hit, TTS startup and final-transcript-to-first-audio timing. The Details view reports the latter separately from endpoint-event timing. These are server measurements; they exclude phone playback and carrier delay. Local provider checks are saved in ignored `output/live/structured-latency-check.json` and `output/live/structured-interview-check.json` when run.

## Twilio outage or signature failure

Pause dialing, check account status/trial verified numbers/geographic permissions, `TWILIO_WEBHOOK_BASE_URL` (or deployed `PUBLIC_BASE_URL`), exact query string, number configuration and Twilio debugger. Use [Twilio security documentation](https://www.twilio.com/docs/usage/security); never turn off signature validation. Status events are idempotently handled after terminal results. The sweeper reconciles stale calls. Do not indiscriminately retry failed commercial calls.

For an abrupt call end, inspect signed status and voice callbacks, then the media stream and provider events. The voice path streams answered calls without synchronous machine detection; a `machine_start` classification previously caused an immediate hangup. The Gnani WebSocket accepts a single language code, so the integration sends the contact's preferred language (or the campaign's first language) instead of a comma-separated list. A normal caller interruption of TTS is an `AbortError` and must not fail the conversation.

For echo reports, use the phone earpiece for a comparison with Bluetooth or speakerphone. Stream-close logs include inbound/outbound frame counts, ignored audio tracks, and exact non-silent input/output matches. Only the `inbound` track enters STT. These counters can detect a digital loop; they do not diagnose acoustic echo by themselves. `call_end` logs and saved `end_reason` identify the first event that began finalization. An unfinished call with no expressed interest is `INCOMPLETE`, rather than an inferred refusal.

If a contact shows **Scheduled**, inspect its next attempt time in the campaign view. Calls outside the chosen IST window keep zero attempts and are scheduled for the next allowed window. The dial queue uses a distinct singleton key for that deferred job; maintenance recovers it if a crash leaves the contact scheduled without a pending job. Do not submit another campaign to the same number just to make the call immediate.

For local demos using a Cloudflare Quick Tunnel, check the public `/healthz` endpoint before the calling window. Quick Tunnel URLs can expire; replace `TWILIO_WEBHOOK_BASE_URL` and restart the server if that happens. Use a stable public HTTPS endpoint for unattended calls.

## Destination outage

Results are saved before delivery. Pending deliveries use exponential delays (10, 20, 40, 80 seconds after the first failures), then dead-letter after five attempts. Settings shows status/attempts and Retry. Receivers must deduplicate `Idempotency-Key` and verify HMAC over `<unix_timestamp>.<exact_body>`. Reject old timestamps (for example beyond your agreed tolerance) and compare signatures in constant time. Delivery is at least once; a crash after receiver acceptance can cause replay with the same key. DNS is validated and the HTTPS connection is pinned to a public address; redirects are not followed.

Retrying a dead letter restarts its attempt counter with the same logical idempotency key. Check the receiver before doing so. No receiver delivery has been independently verified without a human-approved endpoint and signing secret.

## DND complaint

Immediately add the number in Settings → Suppression (or `POST /api/v1/suppression`), pause the affected campaign, and review the audit/result record with authorized staff. Do not send another call or follow-up message to apologize. Preserve only data required for the operator's obligations. A caller's DND tool writes suppression synchronously; suppression failure must fail the call rather than announce success. If the database was unavailable, keep dialing disabled until the operator reconciles any complaint manually. The app does not scrub national registries.

## Secret rotation

Use `fly secrets set` on staging, verify, then production. Rotate Gnani/dialogue/Twilio separately. Rotating `SESSION_SECRET` invalidates signed browser cookies; remove DB sessions to revoke all sessions immediately. Never print token values. Rotate the webhook signing secret in coordination with the receiver; no automated dual-key overlap is implemented. Seed admin credentials create an account only when absent; changing the seed password does **not** reset an existing account. Use a controlled Argon2id password reset in the database or a trusted administrator script; do not log plaintext.

## Deploy / rollback

Pause campaigns and deploy outside calling windows. `fly releases --app <app>` lists releases. Use the previous known-good image with `fly deploy --image <previous-image> --app <app>` (verify current Fly CLI syntax in your installed version). Run health, login and handshake smoke checks after rollback. The initial SQL migration is idempotent; future destructive migrations need explicit rollback planning. Do not assume an image rollback also rolls back a database schema.

## Backup / restore

Use your managed Postgres PITR console to restore into a **new isolated database**, verify tables and audit logs, then set that environment's `DATABASE_URL`. Avoid restoring over a live database. Check suppression records before resuming dialing. Take a pre-change snapshot and document restoration RPO/RTO from actual drills; no restore drill or recovery guarantee has been claimed here.

## Retention / deletion

Default retention: results/transcripts, calls and delivery records 30 days. A minute maintenance job purges expired records. Settings narrows/extends 1–365 days. Suppression persists until deliberately removed; it is not expired with transcripts. Contacts stay until explicitly deleted; campaign deletion removes its contacts/calls/results/deliveries. Audit metadata has no transcript or phone, but still needs an organizational retention policy. Delete endpoints are documented in API.md. Exports contain permitted contact/call fields: secure exported files separately.

## Observability

Pino writes JSON call scheduling, calling-gate decisions, dial attempts, telephony acceptance/failure, signed Twilio callbacks and media-stream lifecycle with IDs and safe status codes. It omits phone numbers and credentials. Set `LOG_LEVEL=info` to see the full lifecycle. In the current local setup, stdout goes to ignored `output/live/server.out.log` and stderr to `output/live/server.err.log`. Monitor/result events carry call IDs, flow, provider trace, tools and measured latency. `/metrics` requires an authenticated session (set a monitor cookie securely or scrape through a trusted authenticated proxy). It exposes active calls, queue-error count and drain state. `/readyz` is public for uptime checks and verifies DB availability plus drain state. Never publish metrics session cookies.

Suggested operational alerts, to be wired into your monitoring account: readiness failures for 2 minutes; increasing queue errors; active calls stuck after duration; repeated FAILED results; dead-letter deliveries; provider failover/error events; queue backlog. Some alerts require querying stored outcomes/deliveries or adding a metrics collector; no Sentry account or alert receiver is configured. No unsupported error-rate/breaker/queue-depth metric is claimed.

## Cost references

| Component | Rate entry | Source to verify for your plan |
|---|---|---|
| Gnani Prisma | INR/minute, unknown until supplied | [Gnani platform](https://app.gnani.ai/) |
| Gnani Timbre | INR/1,000 characters, unknown | [Gnani platform](https://app.gnani.ai/) |
| Dialogue model | INR/1,000 tokens, unknown | [Sarvam pricing](https://www.sarvam.ai/pricing) or your provider's official pricing |
| Twilio voice | INR/minute, unknown | [Twilio India voice pricing](https://www.twilio.com/en-us/voice/pricing/in) |
| Fly | Infrastructure, unknown | [Fly pricing](https://fly.io/docs/about/pricing/) |
| Database | Managed plan/PITR, unknown | [Neon pricing](https://neon.tech/pricing) or Fly Managed Postgres plan |

No prices are invented. Settings accepts operator-supplied INR rates for estimates. Verify currency, tier, taxes, billing granularity and discounts yourself. Metered application usage and rounded vendor invoices can differ.
