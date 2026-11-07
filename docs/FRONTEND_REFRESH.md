# Frontend refresh — 8 November 2026

The local project now opens on a public, light landing page with **“Your Entire Business Communication, All in one place.”** Sign-in leads to a workspace with **Sales, Marketing, Customer care, HR & recruitment, Appointments & bookings**. The fifth option follows the user's selection.

The design uses off-white surfaces, deep teal, mint artwork, restrained motion, self-hosted Inter and original code-rendered voice visuals. [Vapi](https://vapi.ai/) was the main visual reference; [Retell](https://www.retellai.com/) and [Outpero](https://outpero.com/) informed the workflow and conversation presentation. No reference assets, branding, testimonials, customer logos or performance claims were copied.

## What changed

- Public `/` landing page, responsive navigation, interactive solution tabs, three-step introduction and sign-in calls to action.
- `/login` split-layout sign-in; protected links return to their destination after login.
- `/workspace` five workflow cards, stored campaigns and a connection guide.
- `/agents/:workflow` agent setup → phone panel → conversation results. Each workflow has relevant, editable questions. Recruitment includes must-have tags, location, explicit work mode, screening presets and custom job-related questions.
- Phone panel validates international numbers, requires consent, checks do-not-call status through the existing API and uses the existing campaign/import/launch path. One pasted number becomes the campaign allowlist; the normal queue, calling hours and limits still apply.
- Results pair the saved transcript with captured fields, a summary and outcome. Recruitment adds **confirmed job-requirement coverage** from the server's explicit assessment reasons. Unanswered criteria remain visible; absent evidence produces no percentage. This is not a hiring probability or an automated hiring decision.
- Settings includes Twilio, Gnani and dialogue connection guides. Provider status is read from the existing API. Secret values are never requested or stored in the browser; server configuration remains the source of truth.
- Existing batch campaign/CSV flows, conversation drawers, delivery, suppression and privacy settings remain available and use the new palette.
- Corrected Vite environment handling so a production web build uses the matching React/JSX production runtime. No new runtime dependencies. Main JS is approximately 84.5kB gzip, versus approximately 139kB in the previous UI build.

## Verification

Typecheck, lint and production build pass. **93 unit/integration tests pass**, including three new requirement-coverage tests. **Five Playwright E2E tests pass**: legacy Sales/HR flows at both widths, draft/cache resilience, and the new public-site/workspace/recruitment flow at both widths. A final desktop/mobile run refreshes captures after typography and focus polish.

The new flow checks all five workflow routes, configurable HR questions, blocked launch without consent, invalid phone handling, browser simulation, persisted summary/fields, the requirements percentage, collapsed technical details, successful call-queue API submission, connections and no application page errors. Test-created campaigns are removed in a `finally` block. Tests refuse phone-queue submission unless the server reports simulation. No live external phone call was placed.

Screenshots: [desktop and mobile captures](screens-refresh/README.md), at 1440×1000 and 390×844. Overflow checks also run at 360px. Lighthouse 12.8.2 accessibility scores are **100** on the landing page, workspace, recruitment setup, conversations and settings/connections, using default mobile emulation. [Current verification evidence](FRONTEND_VERIFICATION.json) records timestamps, scores and screenshot hashes. Automated checks do not establish complete WCAG conformance or live provider quality.

Re-run against the local server in `MOCK_MODE=true`:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

## Live calling and scope

The running local server is in **simulation mode**. Browser tests use scripted dialogue and silent mock speech. To place real calls, an administrator must configure Twilio, Gnani and the dialogue provider, provide a public HTTPS `PUBLIC_BASE_URL`, select live mode and restart the server. The Settings connection guide lists the relevant environment keys. Live account credentials, audio quality and PSTN delivery were not verified in this frontend task.

The five frontend workflows use the existing Sales/HR engines and schemas. Customer care is an outbound, approved-answer/follow-up workflow. Appointments captures booking requests and preferred times for the team; no external calendar reservation is claimed. Credentials are server-managed; this refresh does not add an in-browser secret-management backend, signup/OAuth, inbound support routing, calendar integration or automatic WhatsApp delivery.

Backend, telephony, Gnani, compliance and submission source files are unchanged. Historical U0–U5 reports and captures describe the previous iteration; this document describes the current frontend.
