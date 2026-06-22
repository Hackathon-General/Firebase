import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { createHmac, timingSafeEqual } from 'crypto';
import { rtdb } from '../lib/admin';
import { IOT_SECRET } from '../lib/secrets';

const REGION = 'europe-west1';

// Per-device rate limit (best-effort, per warm instance; maxInstances also caps total throughput).
const lastSeen = new Map<string, number>();
const MIN_INTERVAL_MS = 2000; // ≤ 1 accepted update per device per 2s; floods → 429

function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * IoT sensor ingest — POST { id, utc, lat, lon, speed_kmh, heading_deg }.
 * Secured by Authorization: Bearer <IOT_SECRET> (constant-time) or HMAC X-Signature.
 * DDoS-safe: per-device rate limit (429), payload validation, maxInstances cap, bounded memory.
 * Saves to RTDB live/{id} with source:"sensor" (clients can never spoof this path via rules).
 * Returns { ok: true } / { ok: false, error }.
 */
export const ingest = onRequest(
  { region: REGION, secrets: [IOT_SECRET], maxInstances: 2, concurrency: 80, timeoutSeconds: 10, memory: '512MiB', cpu: 1, cors: false },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method-not-allowed' });
      return;
    }
    const secret = IOT_SECRET.value();
    // Sensor payload: { id, utc, lat, lon, speed_kmh, heading_deg }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { id, utc, lat, lon, speed_kmh, heading_deg } = body;

    // --- Auth: Authorization: Bearer <IOT_SECRET> (constant-time), or HMAC X-Signature ---
    const authHeader = String(req.get('authorization') ?? '');
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const sig = String(req.get('x-signature') ?? '');

    let authed = false;
    if (bearer && constantTimeEqual(bearer, secret)) {
      authed = true;
    } else if (sig) {
      const expected = createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
      authed = constantTimeEqual(sig, expected);
    }
    if (!authed) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }

    // --- Payload validation ---
    const deviceId = typeof id === 'string' ? id.trim() : '';
    const latitude = Number(lat);
    const longitude = Number(lon);
    if (
      !deviceId ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 ||
      (latitude === 0 && longitude === 0) // sensor not yet GPS-locked
    ) {
      res.status(400).json({ ok: false, error: 'invalid-payload' });
      return;
    }

    // --- DDoS / cost protection: per-device rate limit (drop floods) ---
    const now = Date.now();
    const prev = lastSeen.get(deviceId) ?? 0;
    if (now - prev < MIN_INTERVAL_MS) {
      res.status(429).json({ ok: false, error: 'rate-limited' });
      return;
    }
    lastSeen.set(deviceId, now);
    // Bound the in-memory map so a flood of distinct ids can't grow it unboundedly.
    if (lastSeen.size > 5000) lastSeen.clear();

    // --- Save to Firebase RTDB (clients can't spoof source:"sensor" via rules) ---
    // Guard the write so the function NEVER hangs to a 504: if RTDB is slow/unreachable,
    // fail fast with a clear error instead of timing out the whole instance.
    try {
      const write = rtdb.ref(`live/${deviceId}`).set({
        lat: latitude,
        lng: longitude,
        speed: Number.isFinite(Number(speed_kmh)) ? Number(speed_kmh) : null,
        heading: Number.isFinite(Number(heading_deg)) ? Number(heading_deg) : null,
        utc: typeof utc === 'string' ? utc : null,
        ts: now,
        source: 'sensor',
        name: `חיישן ${deviceId}`,
      });
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('rtdb-write-timeout')), 5000)
      );
      await Promise.race([write, timeout]);
    } catch (e) {
      logger.error('iot ingest: rtdb write failed', { deviceId, err: String(e) });
      res.status(500).json({ ok: false, error: 'db-write-failed' });
      return;
    }

    logger.info('iot ingest ok', { deviceId });
    res.status(200).json({ ok: true });
  }
);
