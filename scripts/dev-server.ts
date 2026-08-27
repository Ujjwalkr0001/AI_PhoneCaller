// Manual local dev runner — bypasses `vercel dev` (which needs an interactive
// CLI login). Wires the exact same api/*.ts handler files into a plain Node
// http.Server, so nothing about the application code differs from what
// actually deploys to Vercel; this file is dev-only and never deployed.
import './load-env.js';

import http from 'node:http';
import { URL } from 'node:url';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const PUBLIC_DIR = path.resolve(import.meta.dirname, '..', 'public');

const STATIC_CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

function serveStaticFile(pathname: string, res: http.ServerResponse): boolean {
  const filePath = path.join(PUBLIC_DIR, pathname);
  // Reject traversal outside PUBLIC_DIR (e.g. "/../.env.local").
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    return false;
  }

  const contentType = STATIC_CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  createReadStream(filePath).pipe(res);
  return true;
}

import startHandler from '../api/call/start.js';
import voiceHandler from '../api/twilio/voice.js';
import statusHandler from '../api/twilio/status.js';
import whatsappHandler from '../api/twilio/whatsapp.js';
import whatsappWebhookHandler from '../api/whatsapp/webhook.js';
import callbackFireHandler from '../api/callback/fire.js';
import mediaStreamServer from '../api/media-stream.js';

const PORT = Number(process.env.PORT ?? 3000);

function readRawBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function parseBody(raw: string, contentType: string): unknown {
  if (!raw) return undefined;
  if (contentType.includes('application/json')) return JSON.parse(raw);
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  return raw;
}

function attachVercelHelpers(req: http.IncomingMessage, res: http.ServerResponse, url: URL, body: unknown) {
  const vReq = req as any;
  vReq.query = Object.fromEntries(url.searchParams);
  vReq.cookies = {};
  vReq.body = body;

  const vRes = res as any;
  vRes.status = (code: number) => {
    res.statusCode = code;
    return vRes;
  };
  vRes.json = (obj: unknown) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
  };
  vRes.send = (payload: unknown) => {
    res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
  };
  return { vReq, vRes };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  let raw = '';
  try {
    raw = await readRawBody(req);
  } catch {
    res.statusCode = 400;
    res.end('Failed to read body');
    return;
  }

  try {
    if (url.pathname === '/api/callback/fire') {
      const fetchReq = new Request(url.toString(), {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : raw,
      });
      const fetchRes = await callbackFireHandler.fetch(fetchReq);
      res.statusCode = fetchRes.status;
      fetchRes.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(await fetchRes.text());
      return;
    }

    const body = parseBody(raw, req.headers['content-type'] ?? '');
    const { vReq, vRes } = attachVercelHelpers(req, res, url, body);

    if (url.pathname === '/api/call/start') return await startHandler(vReq, vRes);
    if (url.pathname === '/api/twilio/voice') return await voiceHandler(vReq, vRes);
    if (url.pathname === '/api/twilio/status') return await statusHandler(vReq, vRes);
    if (url.pathname === '/api/twilio/whatsapp') return await whatsappHandler(vReq, vRes);
    if (url.pathname === '/api/whatsapp/webhook') return await whatsappWebhookHandler(vReq, vRes);

    if (req.method === 'GET' && serveStaticFile(url.pathname, res)) return;

    res.statusCode = 404;
    res.end('Not found');
  } catch (error) {
    console.error('Request handling failed', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('Internal error');
    }
  }
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (url.pathname === '/api/media-stream') {
    (mediaStreamServer as unknown as http.Server).emit('upgrade', req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`Local dev server listening on http://localhost:${PORT}`);
});
