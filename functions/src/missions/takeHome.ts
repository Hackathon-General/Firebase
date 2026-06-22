import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../lib/admin';
import { FieldValue } from 'firebase-admin/firestore';

const REGION = 'europe-west1';

/**
 * completeTrail — user marks the stations they visited; cross-reference takeHomeRules and
 * return matched take-home actions (e.g. visited a volunteering station → local volunteering link).
 */
export const completeTrail = onCall(
  { region: REGION, enforceAppCheck: true, maxInstances: 5, timeoutSeconds: 15, memory: '256MiB' },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

    const stationIds: string[] = Array.isArray(request.data?.stationIds)
      ? request.data.stationIds.filter((s: unknown) => typeof s === 'string')
      : [];
    if (stationIds.length === 0) {
      throw new HttpsError('invalid-argument', 'stationIds required.');
    }

    // Persist visited stations on the user profile.
    await db.doc(`users/${uid}`).set(
      { stationsVisited: FieldValue.arrayUnion(...stationIds), lastActiveAt: Date.now() },
      { merge: true }
    );

    // Match take-home rules by visited station and/or value.
    const rulesSnap = await db.collection('takeHomeRules').get();
    const matched = rulesSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>))
      .filter((r) => {
        const station = r.stationId as string | undefined;
        return !station || stationIds.includes(station);
      });

    return { ok: true, matched };
  }
);
