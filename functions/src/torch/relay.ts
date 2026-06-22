import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { rtdb, db } from '../lib/admin';
import { canTakeTorch, dropTorchState, TorchState } from './logic';
import { validateSegment } from '../antiCheat/validate';
import { FieldValue } from 'firebase-admin/firestore';

const REGION = 'europe-west1';
const torchRef = () => rtdb.ref('torch/active');
const communityRef = () => rtdb.ref('community/totalKm');

/**
 * takeTorch — a hiker picks up the waiting torch. Transaction-locked so only one wins.
 * Auth required; server re-validates proximity (anti-cheat). App Check off for now.
 */
export const takeTorch = onCall(
  { region: REGION, enforceAppCheck: false, maxInstances: 10, timeoutSeconds: 15, memory: '256MiB' },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

    const { lat, lng, name, photo } = request.data ?? {};
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      throw new HttpsError('invalid-argument', 'lat/lng required.');
    }

    const now = Date.now();
    const result = await torchRef().transaction((current: TorchState | null) => {
      const check = canTakeTorch(current, { lat, lng });
      if (!check.ok) return; // abort transaction (returns committed:false)
      const next: TorchState = {
        status: 'held',
        lat: current!.lat,
        lng: current!.lng,
        holderId: uid,
        holderName: name ?? 'מטייל/ת',
        holderPhoto: photo ?? null as unknown as string,
        heldSince: now,
        source: 'phone',
      };
      return next;
    });

    if (!result.committed) {
      throw new HttpsError('failed-precondition', 'הלפיד אינו זמין לאיסוף כעת.');
    }
    logger.info('torch taken', { uid });
    return { ok: true };
  }
);

/**
 * dropTorch — holder drops the torch; segment km validated + added to community bank;
 * torch waits at the drop coords. Anti-cheat rejects teleport/impossible speed.
 */
export const dropTorch = onCall(
  { region: REGION, enforceAppCheck: false, maxInstances: 10, timeoutSeconds: 15, memory: '256MiB' },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

    const { lat, lng, segmentKm } = request.data ?? {};
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      throw new HttpsError('invalid-argument', 'lat/lng required.');
    }

    const snap = await torchRef().get();
    const torch = snap.val() as TorchState | null;
    if (!torch || torch.status !== 'held' || torch.holderId !== uid) {
      throw new HttpsError('failed-precondition', 'אינך מחזיק/ה בלפיד.');
    }

    // Validate the carry segment from where it was picked up to the drop point.
    const seg = validateSegment(
      { lat: torch.lat, lng: torch.lng, ts: torch.heldSince ?? Date.now() },
      { lat, lng, ts: Date.now() }
    );
    // Trust the smaller of client-reported and server-computed distance; reject cheats.
    const serverKm = seg.distanceM / 1000;
    const km = seg.ok ? Math.min(serverKm, Number(segmentKm) || serverKm) : 0;
    if (!seg.ok) {
      logger.warn('torch drop rejected segment (anti-cheat)', { uid, ...seg });
    }

    const now = Date.now();
    await torchRef().set(dropTorchState(torch, { lat, lng }, now));

    if (km > 0) {
      await communityRef().transaction((cur: number | null) => (cur ?? 0) + km);
      await rtdb.ref(`torch/history/${now}`).set({
        holderId: uid, km, from: { lat: torch.lat, lng: torch.lng }, to: { lat, lng }, at: now,
      });
      await db.doc(`users/${uid}`).set(
        { totalKm: FieldValue.increment(km), lastActiveAt: now },
        { merge: true }
      );
    }
    logger.info('torch dropped', { uid, km });
    return { ok: true, km };
  }
);

/** Admin: reset/relocate a stuck torch. */
export const resetTorch = onCall(
  { region: REGION, enforceAppCheck: false, maxInstances: 5, timeoutSeconds: 15, memory: '256MiB' },
  async (request) => {
    if (request.auth?.token?.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Admins only.');
    }
    const { lat, lng } = request.data ?? {};
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      throw new HttpsError('invalid-argument', 'lat/lng required.');
    }
    await torchRef().set({ status: 'waiting', lat, lng, droppedAt: Date.now() } as TorchState);
    return { ok: true };
  }
);
