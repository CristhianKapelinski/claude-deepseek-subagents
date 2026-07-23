#!/usr/bin/env node
// DeepSeek subagent routing proxy for Claude Code.
//
// Claude Code points ANTHROPIC_BASE_URL here. This proxy inspects the `model`
// field of each request and forwards it to the right upstream:
//
//   model "claude-*"    -> https://api.anthropic.com   (headers passed THROUGH,
//                          so your Claude subscription / OAuth token is used as-is)
//   model "deepseek-*"  -> https://api.deepseek.com/anthropic (Authorization
//                          header swapped for your DeepSeek key)
//
// Net effect: the main Opus agent stays on your subscription, while any subagent
// whose model is a deepseek-* id runs on DeepSeek. Zero external dependencies.
//
// Key is read from process.env.DEEPSEEK_API_KEY or ~/.claude/deepseek/.env
// Port from DEEPSEEK_PROXY_PORT (default 8080).

import http from 'node:http';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.DEEPSEEK_PROXY_PORT || 8080);
const ANTHROPIC_UPSTREAM = 'https://api.anthropic.com';
const DEEPSEEK_UPSTREAM = 'https://api.deepseek.com/anthropic';

function loadKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY.trim();
  try {
    const txt = readFileSync(path.join(homedir(), '.claude', 'deepseek', '.env'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?DEEPSEEK_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    }
  } catch { /* no .env */ }
  return null;
}
const DEEPSEEK_KEY = loadKey();

const HOP = new Set(['host', 'content-length', 'connection', 'accept-encoding', 'transfer-encoding', 'keep-alive']);
const RESP_STRIP = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

function log(...a) { process.stderr.write('[ds-proxy] ' + a.join(' ') + '\n'); }

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const bodyBuf = Buffer.concat(chunks);

  let model = '';
  try { model = (JSON.parse(bodyBuf.toString('utf8') || '{}').model) || ''; } catch { /* not json */ }
  const isDeepSeek = /^deepseek/i.test(model);
  const upstream = isDeepSeek ? DEEPSEEK_UPSTREAM : ANTHROPIC_UPSTREAM;
  if (req.url.startsWith('/v1/messages')) log((model || '(no-model)'), '->', isDeepSeek ? 'DEEPSEEK' : 'anthropic');

  // Build forwarded headers.
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (HOP.has(k.toLowerCase())) continue;
    headers[k] = v;
  }

  if (isDeepSeek) {
    if (!DEEPSEEK_KEY) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'config_error', message: 'DEEPSEEK_API_KEY not set (put it in ~/.claude/deepseek/.env)' } })); return; }
    // Swap Anthropic auth for the DeepSeek key.
    for (const h of Object.keys(headers)) {
      const lk = h.toLowerCase();
      if (lk === 'authorization' || lk === 'x-api-key' || lk === 'anthropic-beta') delete headers[h];
    }
    headers['authorization'] = 'Bearer ' + DEEPSEEK_KEY;
    // DeepSeek's Anthropic endpoint may not implement token counting; synthesize a
    // rough estimate so Claude Code's preflight never stalls the subagent.
    if (req.url.includes('/count_tokens')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ input_tokens: Math.ceil(bodyBuf.length / 4) }));
      return;
    }
  }

  try {
    const upstreamRes = await fetch(upstream + req.url, {
      method: req.method,
      headers,
      body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : bodyBuf,
      duplex: 'half',
    });
    const outHeaders = {};
    upstreamRes.headers.forEach((v, k) => { if (!RESP_STRIP.has(k.toLowerCase())) outHeaders[k] = v; });
    res.writeHead(upstreamRes.status, outHeaders);
    if (upstreamRes.body) Readable.fromWeb(upstreamRes.body).pipe(res);
    else res.end();
  } catch (e) {
    log('upstream error', String(e && e.message || e));
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'proxy_error', message: String(e && e.message || e) } }));
  }
});

server.listen(PORT, '127.0.0.1', () => log('listening on 127.0.0.1:' + PORT, DEEPSEEK_KEY ? '(deepseek key loaded)' : '(NO DEEPSEEK KEY)'));
