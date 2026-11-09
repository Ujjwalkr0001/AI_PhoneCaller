// Apply the idempotent SQL migration before starting the web server.
await import('../../scripts/migrate.mjs');
await import('../../apps/server/dist/index.js');
