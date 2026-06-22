#!/usr/bin/env node
/**
 * HTTP → HTTPS relay for the Carmel-Kinneret IoT ingest endpoint.
 *
 * HTTP-only sensors (no TLS) cannot reach Cloud Run directly (it 302-redirects to https and
 * strips the Authorization header). This relay listens on plain HTTP, re-attaches the IoT
 * secret, and forwards each sensor POST to the HTTPS `ingest` function over TLS.
 *
 * The sensor talks ONLY http to this box; this box talks https to Cloud Run.
 *
 * Run:
 *   IOT_SECRET=<secret> node relay.js
 * Optional env:
 *   PORT=8080                                  (listen port; use 80 if you can bind it)
 *   INGEST_URL=https://ingest-ossscobabq-ew.a.run.app
 *
 * Sensor then POSTs to:  http://<this-box-ip>:8080/   with JSON body {id,lat,lon,...}
 * (no Authorization header needed — the relay adds it).
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8080);
const INGEST_URL = process.env.INGEST_URL || 'https://ingest-ossscobabq-ew.a.run.app';
const IOT_SECRET = process.env.IOT_SECRET;

if (!IOT_SECRET) {
  console.error('ERROR: set IOT_SECRET env var. e.g.  IOT_SECRET=xxxx node relay.js');
  process.exit(1);
}

const target = new URL(INGEST_URL);

function forward(bodyBuf) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: target.hostname,
        path: target.pathname || '/',
        port: 443,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyBuf),
          Authorization: `Bearer ${IOT_SECRET}`,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode || 502, body: data }));
      }
    );
    req.on('error', (e) => resolve({ status: 502, body: JSON.stringify({ ok: false, error: String(e) }) }));
    req.write(bodyBuf);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  // Health check.
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, relay: 'carmel-kinneret', target: INGEST_URL }));
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'method-not-allowed' }));
    return;
  }

  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > 8192) req.destroy(); // tiny cap — sensor payloads are <1KB
    else chunks.push(c);
  });
  req.on('end', async () => {
    const bodyBuf = Buffer.concat(chunks);
    const out = await forward(bodyBuf);
    res.writeHead(out.status, { 'Content-Type': 'application/json' });
    res.end(out.body);
    console.log(`${new Date().toISOString()} ${req.socket.remoteAddress} -> ${out.status} ${out.body}`);
  });
});

server.listen(PORT, () => {
  console.log(`HTTP→HTTPS relay listening on http://0.0.0.0:${PORT}`);
  console.log(`Forwarding to ${INGEST_URL}`);
  console.log(`Sensors POST JSON to http://<this-ip>:${PORT}/  (no auth header needed)`);
});
