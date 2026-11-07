# Archived Vercel prototype

These original handlers/configuration are retained for provenance and comparison with `docs/AUDIT.md`. They are **not mounted, supported or copied into the container**. Their relative source imports refer to the original repository layout. Do not deploy this directory or re-enable its unauthenticated dial/history endpoints.

The persistent runtime is `apps/server/src/index.ts`; the UI is `apps/web`. Original history is preserved. Useful speech wrappers, callback parsing and event concepts remain under `src/` and are selectively reused by explicit adapters. Legacy development/WhatsApp diagnostic scripts are not the new entry points.
