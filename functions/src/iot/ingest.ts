import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { createHmac, timingSafeEqual } from 'crypto';
import { rtdb } from '../lib/admin';
import { IOT_SECRET } from '../lib/secrets';

const REGION = 'europe-west1';
const MAX_SKEW_MS = 5 * 60 * 1000; // reject stale/replayed payloads older than 5 min

// Simple in-instance per-device rate limit (best-effort; real limit also via maxInstances).
const lastSeen = new Map<string, number>();
const MIN_INTERVAL_MS = 2000;

function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * IoT sensor ingest — shirt sensors POST positions. Secured by:
 *  - Authorization: Bearer <IOT_SECRET>  (constant-time compare), OR
 *  - X-Signature: HMAC-SHA256(secret, `${ts}.${rawBody}`)  (replay-protected by ts)
 * Writes to RTDB live/{deviceId} with source:"sensor" (clients can never spoof this path).
 */
export const ingest = onRequest(
  { region: REGION, secrets: [IOT_SECRET], maxInstances: 5, concurrency: 40, timeoutSeconds: 10, memory: '256MiB', cors: false },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method-not-allowed' });
      return;
    }
    const secret = IOT_SECRET.value();
    const { deviceId, lat, lng, speed, ts } = req.body ?? {};

    // --- Auth: bearer token OR HMAC signature ---
    const authHeader = String(req.get('authorization') ?? '');
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const sig = String(req.get('x-signature') ?? '');

    let authed = false;
    if (bearer && constantTimeEqual(bearer, secret)) {
      authed = true;
    } else if (sig) {
      const expected = createHmac('sha256', secret)
        .update(`${ts}.${JSON.stringify(req.body)}`)
        .digest('hex');
      authed = constantTimeEqual(sig, expected);
    }
    if (!authed) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    // --- Payload validation ---
    if (
      typeof deviceId !== 'string' ||
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      typeof ts !== 'number'
    ) {
      res.status(400).json({ error: 'invalid-payload' });
      return;
    }
    // Replay / stale protection.
    if (Math.abs(Date.now() - ts) > MAX_SKEW_MS) {
      res.status(400).json({ error: 'stale-timestamp' });
      return;
    }
    // Per-device rate limit.
    const prev = lastSeen.get(deviceId) ?? 0;
    if (Date.now() - prev < MIN_INTERVAL_MS) {
      res.status(429).json({ error: 'rate-limited' });
      return;
    }
    lastSeen.set(deviceId, Date.now());

    await rtdb.ref(`live/${deviceId}`).set({
      lat,
      lng,
      speed: typeof speed === 'number' ? speed : null,
      ts,
      source: 'sensor',
      name: `חיישן ${deviceId}`,
    });

    logger.info('iot ingest', { deviceId });
    res.status(200).json({ ok: true });
  }
);
