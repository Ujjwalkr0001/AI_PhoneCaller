// One-off diagnostic: send a single WhatsApp message directly via Meta's
// WhatsApp Cloud API to see the real delivery outcome (not just whether the
// initial API call threw).
//
// Usage:
//   tsx scripts/test-whatsapp.ts [to] [text|template]
//
// A plain "text" send only delivers if the recipient messaged this business
// number within the last 24 hours (WhatsApp's customer-service-window rule —
// applies to any real, non-sandbox number). "template" sends the default
// pre-approved "hello_world" template, which is allowed to reach anyone
// regardless of window state — use it to confirm the token/number/recipient
// are actually correct before worrying about the window.
import 'dotenv/config';
import { config as loadEnvLocal } from 'dotenv';
loadEnvLocal({ path: '.env.local', override: true });

const to = process.argv[2];
const mode = process.argv[3] === 'text' ? 'text' : 'template';

async function main() {
  if (!to) {
    console.error('Usage: tsx scripts/test-whatsapp.ts <to-e164> [text|template]');
    process.exit(1);
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN!;
  const toDigits = to.replace(/^\+/, '');

  const payload =
    mode === 'template'
      ? {
          messaging_product: 'whatsapp',
          to: toDigits,
          type: 'template',
          template: { name: 'hello_world', language: { code: 'en_US' } },
        }
      : {
          messaging_product: 'whatsapp',
          to: toDigits,
          type: 'text',
          text: { body: 'ElevateBox test message — if you see this, WhatsApp sending works.' },
        };

  console.log(`Sending ${mode} message from phone_number_id`, phoneNumberId, 'to', toDigits);

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const json = await res.json();
  console.log(`[${res.status}]`, JSON.stringify(json, null, 2));

  if (!res.ok) process.exit(1);
}

main().catch((error) => {
  console.error('Send failed:', error);
  process.exit(1);
});
