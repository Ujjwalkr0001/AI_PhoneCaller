// Imported as the very first thing in dev-server.ts so its dotenv side
// effects run before any other import's module-level code (which may read
// process.env at import time, e.g. sarvam-tts-client.ts's speaker default).
// A plain statement placed after later imports would run too late — ES
// module imports all execute before the importing module's own statements,
// regardless of source order.
import { config } from 'dotenv';

config();
config({ path: '.env.local', override: true });
