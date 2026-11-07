# Current frontend captures

Generated from the local production build in explicit simulation mode. All entered contacts and company/role details are synthetic. The 100% shown in the recruitment example is coverage of one explicit test requirement, not a live hiring or accuracy metric.

| Screen | Desktop | Mobile |
|---|---|---|
| Landing page | [1440px](landing-1440.png) | [390px](landing-390.png) |
| Sign in | [1440px](login-1440.png) | [390px](login-390.png) |
| Five-workflow workspace | [1440px](workspace-1440.png) | [390px](workspace-390.png) |
| Recruitment setup | [1440px](recruitment-setup-1440.png) | [390px](recruitment-setup-390.png) |
| Phone-call portal | [1440px](phone-portal-1440.png) | [390px](phone-portal-390.png) |
| Conversation and requirements coverage | [1440px](recruitment-result-1440.png) | [390px](recruitment-result-390.png) |
| Connections | [1440px](connections-1440.png) | [390px](connections-390.png) |

Run `pnpm exec playwright test tests/e2e/workspace.spec.ts` to refresh this set. The legacy wizard regression suite now saves temporary captures under ignored `output/playwright/legacy-refresh/`, preserving the historical UI audit's screenshots.
