import twilio from 'twilio';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function getTwilioClient() {
  const accountSid = requireEnv('TWILIO_ACCOUNT_SID');
  const authToken = requireEnv('TWILIO_AUTH_TOKEN');
  return twilio(accountSid, authToken);
}

export interface PlaceCallParams {
  to: string;
  voiceWebhookUrl: string;
  statusCallbackUrl: string;
}

export async function placeOutboundCall({ to, voiceWebhookUrl, statusCallbackUrl }: PlaceCallParams) {
  const client = getTwilioClient();
  const from = requireEnv('TWILIO_PHONE_NUMBER');

  const call = await client.calls.create({
    to,
    from,
    url: voiceWebhookUrl,
    statusCallback: statusCallbackUrl,
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    statusCallbackMethod: 'POST',
  });

  return call;
}
