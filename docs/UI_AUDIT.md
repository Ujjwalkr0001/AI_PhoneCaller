# UI audit — before and after

Baseline `7d242b4`. Scope: web UI, shared minimal-form expansion, UI tests/docs only. The server, speech/call pipeline, telephony, compliance gate and submission logic stay unchanged.

## Baseline inventory and decisions

| Surface | Every visible element/field group | Decision and reason |
|---|---|---|
| Shell | ElevateBox wordmark | Keep, read from PRODUCT_NAME config. |
| Shell | Workspace switcher, workspace/manage labels, breadcrumb, India/IST badge | Delete; no decisions/actions. |
| Shell | Overview, Campaigns, Leads, Candidates, Analytics, Settings, Compliance navigation | Simplify to Campaigns, Conversations, Settings; old URLs redirect. |
| Shell | New campaign | Keep as single primary shell action; hide during wizard. |
| Shell | Theme control, help icon, speech-provider footer panel, technical attribution footer | Move to Settings → Status; light-first design. |
| Shell | User email/role/sign-out | Simplify into small user menu. |
| Shell | Simulation and kill-switch banners, toast | Keep compact and truthful. |
| Login | Wordmark, email, password, submit, validation | Keep in centred card. |
| Login | Story panel, feature list, large slogan, disclosure marketing | Delete. |
| Overview | Headline, subtitle, sample-data checkbox, Today badge | Simplify to Campaigns title and clear sample labels. |
| Overview | Calls today, connect rate, interested leads, completed screenings | Simplify to at most three quiet stored-data totals. |
| Overview | Campaign list/card metadata/status | Keep, use real progress/outcome card. |
| Overview | Provider-health rows, explanatory footer, workflow marketing cards, trust panel | Delete from home; providers move to Status. |
| Campaign list | Search, campaign name/company, workflow, language, status, safety columns | Simplify into searchable cards; safety/languages become small chips. |
| Wizard entry | Sales/HR choice | Keep before the wizard. |
| Wizard | Six-part stepper, saved-device badge, long instructional paragraphs | Replace with Details → Contacts → Review and quiet saved indicator. |
| Shared Details | Campaign name, company name/about, website, fact sheet, key facts | Keep company; derive campaign name, move all others to Fine-tune. |
| Sales Details | Product name/description, audience, price, benefits, price flexibility, discount percent/conditions, offer/expiry, CTA, disqualifiers | Combine product into one offering textarea; keep price and goal; others Fine-tune. |
| HR Details | Job title/ref, department, location, work mode, employment type, openings, experience, role summary, salary, notice preference, nice-to-haves, eligibility, interview process, resume channel/value/instructions | Keep title, location/work mode, requirements; resume/salary move to Contacts; all other fields Fine-tune. |
| Repeated fields | Question, key, expected answer, must-have, remove/add row; FAQ question/answer; objection/response | Replace ordinary screening with selectable presets and tags; advanced repeaters remain behind disclosure. |
| Agent | Name, tone, primary language, additional-language select, voice per language, callback contact, max duration, do-not-say | Languages stay visible as pills; all others Fine-tune. |
| Agent preview | Decorative avatar/waveform, greeting, provider rows, recording row, grounding footer, voice-preview button | Keep disclosure greeting, capture chips and cached Voice sample. Remove decoration and technical rows. |
| Contacts | File input, paste CSV, column selectors, apply mapping, row count, editable phone/name, validation status, remove, manual row | Simplify to FileDrop/paste, real validation summary, collapsed corrections with undo. Mapping appears only when necessary. |
| Schedule | Start/end, attempts, retry gap, concurrency, daily calls/minutes/STT/TTS, test mode, allowlist, attestation, destination picker | Hours become editable chip; attestation visible; retain test allowlist automatically for validated imported numbers. Remaining safety controls/destinations behind Fine-tune. Never broaden server limits. |
| Review | Campaign/type/company/product/role/contact/schedule summaries, usage banner, Test, Save draft, Launch, Back | One summary card, plain facts count/usage, Test secondary, Launch primary. Autosave replaces separate Save draft. |
| Campaign detail | Back, name/status, Browser test, Launch/Pause/Resume/Stop, sample banner | Keep concise header; destructive Stop in confirmed overflow. |
| Campaign detail | Contacts, Live monitor, Results, Configuration tabs | Replace with Leads/Candidates, Calls, Settings. Active-only Watch strip. |
| Contacts table | Name, phone, status, block reason, delete; import form | Keep masked identity/status, move reasons/actions into row/details. |
| Monitor | Call UUID selector, stage, latency, transcript, fields/tool/provider/error logs | Replace UUIDs with contact labels; transcript and captured fields primary; logs/latency collapsed. |
| Browser test | Mode badge, explanation, start/end, status, transcript monitor, simulation input/send, close | Keep; use same untouched BrowserAudio transport and clear simulation labels. |
| Leads/Candidates | Count, outcome select, export; campaign/time/outcome/eligibility or follow-up/language/source table | Merge into Conversations, chip filters; campaign-specific view stays in detail. |
| Result drawer | Outcome/source, summary, eligibility/reasons/recommendation, fields, transcript, latency, providers, usage/version, delivery status/retry | Two-column transcript + structured card. Technical information goes into collapsed Details. |
| Analytics | Sample toggle, calls/duration/p50/p95 tiles, outcome/language/date bars, cost panel/settings link | Delete standalone screen; stored outcomes appear in campaign progress; metrics remain in Details/Status. |
| Settings | Provider rows/dialogue, retention, minute cap, four rates/save, kill switch | Status and Data/privacy disclosures. |
| Settings | Suppression phone/add/list/remove | Keep as Do-not-call section, confirm removal. |
| Settings | Destination name/URL/add/list/test/delete, delivery status/attempts/retry | Keep as Delivery; form collapsed, no unimplemented destinations. |
| Settings | Team emails/roles and provisioning note | Keep as quiet Team section. |
| Privacy | Six large cards: disclosure, grounding, calling checks, advisory screening, retention, obligations | Move to compact footer disclosure/Data & privacy. |

## Measured baseline and target counts

Chrome inspection before edits: 7 primary navigation links; 10 distinct surfaces including login/privacy and the shared wizard (edit/new counted once). Wizard has 6 stages including workflow choice. Default visible native input/textarea/select counts after choice, steps 2–6: Sales **16 / 8 / 2 / 12 / 0**; HR **23 / 8 / 2 / 12 / 0**. Repeaters/import mapping add more controls when expanded. These counts came from the running app, not an estimate.

Target: 3 primary links; 3 product destinations plus login, entry, wizard and campaign detail; privacy is a disclosure. Wizard exactly 3 steps. Default field groups at most 5 per step; native inputs also checked independently. Sales default flow ≤8 field groups and HR ≤10, including contacts and consent; optional hours editing/Fine-tune is excluded from the default-entry budget and tested separately for safety.

## Scope conflicts resolved

No existing API exposes dialogue-driven form drafting, WhatsApp follow-up, Google Sheets, or persisted resume-received updates. Do not modify the backend or expose keys. Omit unsupported actions; allow an explicitly configured same-origin drafting adapter only. Resume instructions can be given by the existing agent, without claiming automatic messages. Voice sample calls the existing endpoint only when live speech is configured, caches successful audio in the browser, and is explicitly unavailable in simulation.

## After measurements

| Measurement | Before | After |
|---|---|---|
| Primary navigation | 7 | **3**: Campaigns, Conversations, Settings |
| Distinct page surfaces (wizard counted once) | 10 | **7**: login, campaigns, entry, wizard, campaign detail, conversations, settings |
| Wizard | 6 stages including choice | Separate choice, then **3** steps |
| Home stat tiles | 4 | **3**, excluding sample/simulation results |
| Sales native controls, by step | 16 / 8 / 2 / 12 / 0 | **3 / 1 / 1** |
| HR native controls, by step | 23 / 8 / 2 / 12 / 0 | **4 / 3 / 1** |
| Sales default field groups | Long multi-stage form | **7** = 5 Details + 1 Contacts + consent |
| HR default field groups | Long multi-stage form | **10** = 5 Details + 4 Contacts/follow-up + consent |

Native controls count visible input/textarea/select elements, including consent. Button-based goal, language and screening groups are counted separately in the field-group budget. Optional disclosures, row corrections and editable hours are excluded from the default-entry budget. Both widths independently assert ≤5 visible native controls per step. Every wizard step also checks overflow at 360px.

Playwright measured login → launched **mock, allowlisted** Sales campaign at **2.68 seconds (1440px)** and **4.09 seconds (390px)** in the final run. The raw measurements are recorded in `UI_VERIFICATION.json`. This is automated entry of prepared synthetic data, including screenshots and API validation; it is not a human usability study. Both flows assert <120 seconds. Test-run waits for the unchanged server rate-limit window happen before the timing starts.

### Verification

Re-run with the database and local server running in **simulation mode**: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, then `pnpm test:e2e`. The E2E test refuses to launch when `/providers` does not report simulation. It refreshes screenshot files and ignored `output/playwright/ui-metrics.json`. Lighthouse was invoked against the authenticated production build with `--only-categories=accessibility --disable-storage-reset --output=json`; raw local reports stay in ignored `output/playwright/`, while the committed summary omits session headers.

- All **90** unit/integration tests pass: the existing 83 plus 7 minimal-expansion tests. Typecheck, lint and production build pass.
- Three Playwright tests cover both complete Sales/HR flows, mock launch, streamed browser simulation, saved transcript/result drawer, collapsed Details, keyboard Escape, CSV validation, duplicate/invalid rows, removal/undo, autosave/refresh, failed voice sample retry and cache reuse. Main flow runs assert no application console/page errors; the initial unauthenticated 401 is expected. The resilience fixture deliberately returns a sample-service 503.
- Native disclosure greeting includes AI disclosure; English and Hindi preview strings remain. Voice sample uses Web Audio so it works with the unchanged strict media policy. The cache test decodes a silent local WAV fixture and verifies one successful fetch is reused. **Live Gnani sample quality/latency is not established by that fixture.** In simulation the UI states that a live sample is unavailable.
- Lighthouse **12.8.2**, authenticated local production build, default mobile emulation: **100** accessibility on Campaigns, entry, Sales setup, HR setup, campaign detail, Conversations and Settings. Scores and audit timestamps are in `UI_VERIFICATION.json`. Lighthouse is an automated check, not a complete WCAG certification.
- Route-level lazy loading; no chart dependency, remote font request, gradients or copied reference assets. Initial JS is approximately 139kB gzip, wizard chunk approximately 78.5kB gzip, CSS approximately 7.4kB gzip. Inter is self-hosted; its OFL licence is shipped at `/fonts/Inter-OFL.txt`. This is the only added dependency.
- Background reads use a 30-second interval, 15-second freshness and targeted invalidation; live result events coalesce refreshes. The backend rate limit remains unchanged. BrowserAudio's only edit makes repeated UI cleanup safe when its AudioContext is already closed.
- `git diff 7d242b4 -- apps/server packages/shared/src/index.ts` is empty. Existing schemas, call/telephony/Gnani/compliance/submission code are unchanged.

### Screenshots and review limits

Desktop **1440×1000** and mobile **390×844** screenshots in `screens/`: campaigns, entry, Sales Details/Contacts/Review, HR Details/Contacts/Review, campaign, conversations list, saved conversation, browser test, settings. The mobile transcript has an additional capture. All contacts/companies in created campaigns are synthetic; mock and sample records are labelled. Screenshot review checked spacing, wrapping, disclosure defaults and mobile table cards. Contact masks retain the final four digits.

Manually review live voice pronunciation with your configured Gnani account; very long real company/job names; real webhook failures/retries; screen-reader reading order in the mobile conversation stack. No live PSTN call, public deployment or external message was sent during verification.

### Remaining capability gaps

The description assistant is conditional on `UI_DRAFT_ENDPOINT` (a same-origin `/api/` adapter). There is no suitable existing server route, so it is hidden by default. Its strict schema admits only source-matching company/offer/job/location/requirements, never model-supplied price or salary, and keeps values editable with a review note. The adapter path itself is not end-to-end verified here.

Automatic WhatsApp candidate notifications, Google Sheets delivery and persisted resume-received toggles/follow-up actions are omitted because no existing API supports them. Resume destinations are instructions the existing agent can share during the call. This UI does not claim that a message was sent. These requested features remain incomplete under the backend freeze.
