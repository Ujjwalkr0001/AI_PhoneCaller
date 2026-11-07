/** Keep private provider credentials on the server. Legacy names remain supported. */
export const gnaniSttKey = () => process.env.GNANI_STT || process.env.GNANI_API_KEY;
export const gnaniTtsKey = () => process.env.GNANI_TTS || process.env.GNANI_API_KEY;

export function dialogueConfig() {
  const groq = !!process.env.GROQ_API_KEY && !process.env.DIALOGUE_API_KEY;
  const provider = process.env.DIALOGUE_PROVIDER || (groq ? 'groq' : 'sarvam');
  return {
    provider,
    key:
      process.env.DIALOGUE_API_KEY ||
      (provider === 'groq' ? process.env.GROQ_API_KEY : process.env.SARVAM_API_KEY),
    model:
      process.env.DIALOGUE_MODEL ||
      (provider === 'groq' ? 'openai/gpt-oss-20b' : 'sarvam-105b-conversations'),
    url:
      process.env.DIALOGUE_URL ||
      (provider === 'groq'
        ? 'https://api.groq.com/openai/v1/chat/completions'
        : 'https://api.sarvam.ai/v1/chat/completions'),
  };
}

export const twilioWebhookBase = () =>
  (process.env.TWILIO_WEBHOOK_BASE_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');

export function liveReadiness() {
  const url = twilioWebhookBase();
  let webhook = false;
  try {
    const parsed = new URL(url);
    webhook =
      parsed.protocol === 'https:' &&
      !!parsed.hostname &&
      !parsed.username &&
      !parsed.password;
  } catch {
    // A public HTTPS URL is mandatory for Twilio voice and media callbacks.
  }
  return {
    stt: !!gnaniSttKey(),
    tts: !!gnaniTtsKey(),
    dialogue: !!dialogueConfig().key,
    twilio: !!(
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER
    ),
    webhook,
  };
}

export function requireLiveCalling() {
  const ready = liveReadiness();
  const missing = Object.entries(ready)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  if (missing.length)
    throw new Error(`Live calling needs ${missing.join(', ')}. Check Settings → Connections.`);
}
