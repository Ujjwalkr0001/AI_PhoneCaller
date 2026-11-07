# Evaluation

## Real dialogue-model evaluation: NOT RUN

No dialogue API credentials were available. No live Gnani spike, live PSTN call, or live multilingual pronunciation evaluation was run. Hallucination rate, capture accuracy, live latency, outcome accuracy and production concurrency are **not measured**. Do not turn mock observations into competition performance claims.

`eval/personas.ts` contains 24 synthetic, scripted personas: 16 development, 8 held-out test. `RUN_LIVE_EVAL=true pnpm eval` evaluates only the held-out split and writes exact observations to `eval/artifacts/latest.json`. It consumes credits. Do not tune on that split. This small harness checks prohibited salary/guarantee patterns and expected tool presence; it does not establish a comprehensive semantic hallucination rate or multi-turn field accuracy. Extend the evaluator and manually review transcripts before reporting those metrics.

## Local automated verification

`pnpm test` exercises shared schemas, compliance boundaries, prompt snapshot, flow ordering, conservative grounding, field/consent validation, rule-based eligibility, G.711 known vectors, framing, masking, signatures, protocol parsing, full mock calls, provider fallback and Postgres-backed auth/persistence/submission behavior. Current observed result: **83 tests passing** (7 files), including original qualification/time-parser tests. Counts may change; rerun before submission.

The browser suite covers login → HR wizard → CSV mapping → attestation → mock launch → browser simulation and monitor → stored result → CSV export, plus mobile horizontal-overflow inspection. See `output/playwright/` for actual rendered screenshots. A browser simulation uses scripted text and silent mock audio; this is not evidence of live Gnani speech quality.

## Synthetic media load observation

See [LOADTEST.json](LOADTEST.json). Four concurrent local synthetic Twilio protocol clients ran for approximately two seconds each against silent mocks, with 4 first-audio observations and 0 failures. The measured connection-to-first-mock-audio p50 was 30.83 ms and p95 56.91 ms on Windows/Node 24.12.0. This is **not** end-of-speech latency, a sustained capacity result, a Fly benchmark, or a provider benchmark. No maximum supported concurrency was established.

## Measurement definitions and limits

- STT final delay: local receipt of Prisma `processing` to local receipt of `transcript`. Prisma endpointing/VAD silence before `processing` is excluded.
- `end_of_speech_to_audio_ms` currently uses that local processing receipt as an endpointing proxy. It is not a hardware timestamp for the caller's last voiced sample; do not compare it directly with acoustic laboratory measurements.
- LLM first-token delay: dialogue request to first streamed content token (JSON), not first spoken word.
- TTS first byte: speech request to first chunk. Caching can reduce it; provider trace identifies selection/failover, but per-cache-hit billing is not derived.
- Missing measurements stay absent/null. Sentiment is `unknown`; no sentiment model is claimed. Usage is application metering, not the provider's invoice. A provider that omits token usage cannot be billed accurately from this application alone.
- Numeric/prohibited phrase checks plus an extractive response gate reject novel factual prose. This favors conservative follow-up over fluent paraphrase. Supply approved native-script facts/questions for other languages. Cross-language pronunciation and sensitive-data filtering require human review.
