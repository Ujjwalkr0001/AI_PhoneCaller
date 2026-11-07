# UI changes

Historical report for the 7 November U0–U5 iteration. The [8 November frontend refresh](FRONTEND_REFRESH.md) supersedes the public site and signed-in home described here.

The workspace now has three destinations: **Campaigns, Conversations, Settings**. Standalone Analytics and Compliance pages redirect; privacy and technical detail use disclosures. The old monolithic UI, sidebar, decorative panels and external font loading were removed.

Sales and HR start with two purpose cards, then **Details → Contacts → Review**. Default field groups total **7 for Sales**, **10 for HR**; measured visible native controls are **3/1/1** and **4/3/1**. Optional configuration stays in Fine-tune. Shared minimal schemas expand into the unchanged server configuration; empty drafts persist without manufacturing facts.

Campaigns show stored progress/outcomes and at most three quiet home totals. Conversation drawers pair a transcript with captured fields, outcome and real delivery status; Details starts closed. Settings is one scrolling page. Warm neutral surfaces, one indigo accent, self-hosted Inter, focus rings and responsive table cards replace the previous visual system.

**Verified:** 90 unit/integration tests, three Playwright tests, typecheck, lint and build; 360px overflow checks; desktop/mobile screenshots; Lighthouse accessibility 100 on seven main pages. See [audit](UI_AUDIT.md), [measured evidence](UI_VERIFICATION.json) and [screenshots](screens/README.md).

**Still limited:** live voice needs configured Gnani credentials; cache playback was checked with a silent fixture. Description drafting needs a same-origin adapter and is hidden by default. Automatic WhatsApp follow-up, Sheets and persisted resume-received actions need server support and were omitted. The call pipeline and server were not changed.

Human review: listen to a live voice sample, inspect long real content, check a real webhook retry, and try the mobile conversation stack with a screen reader. See `UI_AUDIT.md` for exact verification scope and before/after counts.
