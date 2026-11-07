const url = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${url}/readyz`)).ok) process.exit(0); } catch { /* process still starting */ } await new Promise(r => setTimeout(r, 500)); }
throw new Error('Server did not become ready');
