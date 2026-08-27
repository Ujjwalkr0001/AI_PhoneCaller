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

/** Ends an in-progress call from our side — used once the agent has said
 * goodbye, so the call doesn't just linger open waiting for the human to
 * hang up. Twilio's "completed" status update is how you actively end a
 * call via the REST API (as opposed to just letting it run its course). */
export async function hangupCall(callSid: string): Promise<void> {
  const client = getTwilioClient();
  await client.calls(callSid).update({ status: 'completed' });
}
