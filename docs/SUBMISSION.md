# Contest submission draft — verify before sending

ElevateBox Campaign Studio configures sales and recruitment calling campaigns, with immutable AI disclosure, approved facts, job-related questions, a test-number allowlist, suppression and calling-hour gates. Gnani Prisma and Timbre adapters supply speech recognition and voice. A separately configured dialogue LLM decides the next response; this is stated in the UI and README.

The implementation includes an authenticated React wizard, persistent Fastify/WebSocket server, shared campaign schemas, Postgres records, a pg-boss dialer/callback queue, browser test transport, live event monitor, deterministic advisory eligibility, CSV export and signed retryable webhook submissions.

## Evidence available

- Local application and Postgres integration tests.
- Actual running-app screenshots showing simulation labels.
- Container build and local health/login/CRUD/browser-handshake smoke checks.
- A bounded four-client local synthetic media observation, explicitly not a live Gnani or production benchmark.

## Claims not yet supported

**Live Gnani calls, live Twilio calling, real webhook receiver delivery, public staging/prod deployment and held-out real-LLM evaluation have not been run.** Do not remove this paragraph or submit a “live Gnani platform” claim until the human verifies and records those runs. Do not describe mock silent speech as a live voice agent. No accuracy, customer counts, provider latency, billed cost or production capacity number is claimed.

The brief gives a deadline of 10 November 2026, 11:59 PM IST. Human operators must verify the current official challenge rules, required posts/hashtags/tags and nomination form. This file does not submit anything automatically.

Complete public repository/demo URL, team names, contribution table, proof of Gnani usage, held-out results if actually run, and consented test-call evidence before final submission.
