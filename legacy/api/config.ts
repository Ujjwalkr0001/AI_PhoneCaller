import type { VercelRequest, VercelResponse } from '@vercel/node';

/** Non-secret display config for the dashboard — e.g. a quick-dial shortcut.
 * Never put CALL_TRIGGER_SECRET or any provider API key here. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  res.status(200).json({
    salesRepName: process.env.SALES_REP_NAME ?? null,
    salesRepPhone: process.env.SALES_REP_PHONE ?? null,
  });
}
