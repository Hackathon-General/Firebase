import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../lib/admin';

const REGION = 'europe-west1';
const opts = { region: REGION, enforceAppCheck: false, maxInstances: 5, timeoutSeconds: 15, memory: '256MiB' as const, cpu: 0.25 };

function assertAdmin(role: unknown) {
  if (role !== 'admin') throw new HttpsError('permission-denied', 'Admins only.');
}

/** Create or update a station. Admin only. Reflected live in the app via Firestore listeners. */
export const upsertStation = onCall(opts, async (request) => {
  assertAdmin(request.auth?.token?.role);
  const s = request.data?.station;
  if (!s || typeof s.id !== 'string' || typeof s.name !== 'string') {
    throw new HttpsError('invalid-argument', 'station.id and station.name required.');
  }
  if (typeof s.lat !== 'number' || typeof s.lng !== 'number') {
    throw new HttpsError('invalid-argument', 'station.lat/lng required.');
  }
  await db.doc(`stations/${s.id}`).set({ ...s, updatedAt: Date.now() }, { merge: true });
  return { ok: true, id: s.id };
});

/** Delete a station. Admin only. */
export const deleteStation = onCall(opts, async (request) => {
  assertAdmin(request.auth?.token?.role);
  const id = request.data?.id;
  if (typeof id !== 'string') throw new HttpsError('invalid-argument', 'id required.');
  await db.doc(`stations/${id}`).delete();
  return { ok: true, id };
});

/**
 * Update a content singleton (event | routes | site). Admin only.
 * Shallow-merges the provided patch so admins can change one field at a time.
 */
export const updateContent = onCall(opts, async (request) => {
  assertAdmin(request.auth?.token?.role);
  const doc = request.data?.doc;
  const patch = request.data?.patch;
  if (!['event', 'routes', 'site'].includes(doc)) {
    throw new HttpsError('invalid-argument', 'doc must be event|routes|site.');
  }
  if (!patch || typeof patch !== 'object') {
    throw new HttpsError('invalid-argument', 'patch object required.');
  }
  await db.doc(`content/${doc}`).set({ ...patch, updatedAt: Date.now() }, { merge: true });
  return { ok: true, doc };
});
