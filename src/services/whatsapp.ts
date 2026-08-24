import type { CallSession } from '../state/call-session.js';
import { logger } from '../utils/logger.js';

const GRAPH_API_VERSION = 'v21.0';

function toE164Digits(number: string): string {
  return number.replace(/^\+/, '');
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * Sends via Meta's WhatsApp Cloud API directly (not Twilio). `mediaType`
 * matters to the Graph API itself — a PDF must go as "document" and a PNG
 * as "image", each under its own payload key.
 */
async function sendOne(
  to: string,
  body?: string,
  mediaUrl?: string,
  mediaType: 'image' | 'document' = 'document',
  filename?: string,
): Promise<void> {
  const phoneNumberId = requireEnv('WHATSAPP_PHONE_NUMBER_ID');
  const accessToken = requireEnv('WHATSAPP_ACCESS_TOKEN');

  const payload = mediaUrl
    ? {
        messaging_product: 'whatsapp',
        to: toE164Digits(to),
        type: mediaType,
        [mediaType]: { link: mediaUrl, ...(filename ? { filename } : {}) },
      }
    : { messaging_product: 'whatsapp', to: toE164Digits(to), type: 'text', text: { body } };

  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`WhatsApp Cloud API send failed (${res.status}): ${await res.text()}`);
  }
}

interface TemplateHeader {
  type: 'document' | 'image';
  link: string;
  filename?: string;
}

/**
 * Sends an approved template message. Unlike sendOne, this delivers
 * regardless of whether a 24-hour customer-service window is open — that's
 * the whole point of using a template for a business-initiated message.
 * Throws if the named template isn't APPROVED yet (or doesn't exist).
 */
async function sendTemplate(
  to: string,
  templateName: string,
  options: { bodyParams?: string[]; header?: TemplateHeader } = {},
): Promise<void> {
  const phoneNumberId = requireEnv('WHATSAPP_PHONE_NUMBER_ID');
  const accessToken = requireEnv('WHATSAPP_ACCESS_TOKEN');

  const components: unknown[] = [];
  if (options.header) {
    const { type, link, filename } = options.header;
    components.push({ type: 'header', parameters: [{ type, [type]: { link, ...(filename ? { filename } : {}) } }] });
  }
  if (options.bodyParams?.length) {
    components.push({ type: 'body', parameters: options.bodyParams.map((text) => ({ type: 'text', text })) });
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: toE164Digits(to),
    type: 'template',
    template: { name: templateName, language: { code: 'en_US' }, ...(components.length ? { components } : {}) },
  };

  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`WhatsApp template send failed (${res.status}): ${await res.text()}`);
  }
}

/** Tries the approved template first (works on any number, any time); falls
 * back to a free-form send if the template isn't approved yet — so delivery
 * degrades to "best effort within an open window" rather than failing outright. */
async function sendWithTemplateFallback(
  label: string,
  log: ReturnType<typeof logger.withCallSid>,
  templateSend: () => Promise<void>,
  fallbackSend: () => Promise<void>,
): Promise<void> {
  try {
    await templateSend();
    log.info(`${label} sent via approved template`);
  } catch (error) {
    log.warn(`${label}: template not available yet, falling back to free-form send`, error);
    await fallbackSend();
  }
}

/** Condensed, single-line version of the call's specifics — used as the
 * {{1}} variable in the approved call_recap_body template. Template variables
 * can't contain newlines, so this can't use the paragraph-per-topic layout
 * buildPostCallText uses for the free-form fallback. */
function buildRecapSentence(session: CallSession): string {
  const { qualification: q, callback } = session;
  const parts: string[] = [];

  if (q.businessType) {
    const productPart = q.productCount ? ` with around ${q.productCount} products` : '';
    parts.push(`you're looking to build an e-commerce site for your ${q.businessType} business${productPart}`);
  }
  const budgetPart = q.budget ? `a budget around ₹${q.budget.toLocaleString('en-IN')}` : undefined;
  const timelinePart = q.timeline ? `wanting it live ${q.timeline}` : undefined;
  if (budgetPart || timelinePart) {
    parts.push(`you mentioned ${[budgetPart, timelinePart].filter(Boolean).join(' and ')}`);
  }
  if (q.features.length) {
    parts.push(`you asked about ${q.features.join(', ')}`);
  }
  if (q.objections.length) {
    parts.push(`you raised ${q.objections[0]}`);
  }
  if (callback.requested && callback.confirmedAt) {
    const when = new Date(callback.confirmedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
    parts.push(`I'll call you back around ${when} as discussed`);
  }

  if (!parts.length) {
    return "we didn't get into the specifics on this call, but happy to pick that up whenever suits you";
  }
  return parts.join('; ');
}

function buildPostCallText(session: CallSession): string {
  const { qualification: q, callback } = session;
  const repName = process.env.SALES_REP_NAME || 'the ElevateBox team';
  const repPhone = process.env.SALES_REP_PHONE;

  const lines: string[] = ['Hey! Thanks for taking my call just now.'];

  if (q.businessType) {
    const productPart = q.productCount ? ` with around ${q.productCount} products` : '';
    lines.push(`Recapping what you told me — you're looking to build an e-commerce site for your ${q.businessType} business${productPart}.`);
  }
  const budgetPart = q.budget ? `a budget around ₹${q.budget.toLocaleString('en-IN')}` : undefined;
  const timelinePart = q.timeline ? `wanting it live ${q.timeline}` : undefined;
  if (budgetPart || timelinePart) {
    lines.push(`You mentioned ${[budgetPart, timelinePart].filter(Boolean).join(', ')}.`);
  }
  if (q.features.length) {
    lines.push(`On features, you asked about: ${q.features.join(', ')}.`);
  }
  if (q.objections.length) {
    lines.push(`You also raised ${q.objections[0]} — fair point, happy to work through that whenever you're ready.`);
  }
  if (!q.businessType && !budgetPart && !timelinePart && !q.features.length) {
    lines.push("We didn't get into the specifics on this call — happy to pick that up whenever suits you.");
  }
  if (callback.requested && callback.confirmedAt) {
    const when = new Date(callback.confirmedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
    lines.push(`I'll call you back around ${when}, like we discussed.`);
  }
  lines.push('Sharing my resume and a look at how this calling system is built below.');
  lines.push(`You can reach me directly anytime at ${repPhone ?? '(number not configured)'} — ${repName}.`);

  return lines.join('\n\n');
}

/**
 * WhatsApp media messages cannot combine a text body with a document
 * attachment (only images may carry accompanying text), so this is three
 * sequential sends rather than one message with two attachments — Meta's
 * Cloud API also only accepts a single media object per message.
 *
 * Sent once the call has ended (not mid-call) — an outbound sales call
 * doesn't open a WhatsApp customer-service window on its own, so this only
 * delivers if the recipient has messaged this WhatsApp number within the
 * last 24 hours (or it's sent as an approved template outside that window).
 */
export async function sendPostCallFollowUp(session: CallSession): Promise<void> {
  const log = logger.withCallSid(session.callSid);
  const baseUrl = process.env.PUBLIC_BASE_URL;
  if (!baseUrl) {
    log.error('Cannot send post-call WhatsApp: PUBLIC_BASE_URL not configured');
    return;
  }

  const repPhone = process.env.SALES_REP_PHONE ?? '(number not configured)';
  const repName = process.env.SALES_REP_NAME || 'the ElevateBox team';

  try {
    await sendWithTemplateFallback(
      'Recap text',
      log,
      () => sendTemplate(session.phone, 'call_recap_body', { bodyParams: [buildRecapSentence(session), repPhone, repName] }),
      () => sendOne(session.phone, buildPostCallText(session)),
    );
    await sendWithTemplateFallback(
      'Resume',
      log,
      () =>
        sendTemplate(session.phone, 'call_recap_resume', {
          header: { type: 'document', link: `${baseUrl}/Resume.pdf`, filename: 'Resume.pdf' },
        }),
      () => sendOne(session.phone, undefined, `${baseUrl}/Resume.pdf`, 'document', 'Resume.pdf'),
    );
    await sendWithTemplateFallback(
      'Architecture image',
      log,
      () => sendTemplate(session.phone, 'call_recap_architecture', { header: { type: 'image', link: `${baseUrl}/architecture.png` } }),
      () => sendOne(session.phone, undefined, `${baseUrl}/architecture.png`, 'image'),
    );
    session.whatsappFollowUpSent = true;
    log.info('Post-call WhatsApp follow-up sent');
  } catch (error) {
    log.error('Post-call WhatsApp follow-up failed', error);
  }
}
