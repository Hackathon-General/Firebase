import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { auth, db } from '../lib/admin';

const REGION = 'europe-west1';

/**
 * setAdmin — grant/revoke the `role:admin` custom claim. Caller MUST already be an admin
 * (App Check enforced). The first admin is bootstrapped via scripts/bootstrap-admin.ts.
 */
export const setAdmin = onCall(
  { region: REGION, enforceAppCheck: true, maxInstances: 3 },
  async (request) => {
    if (request.auth?.token?.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Admins only.');
    }
    const { uid, makeAdmin } = request.data ?? {};
    if (typeof uid !== 'string') {
      throw new HttpsError('invalid-argument', 'uid required.');
    }
    const role = makeAdmin === false ? 'user' : 'admin';
    await auth.setCustomUserClaims(uid, { role });
    await db.doc(`users/${uid}`).set({ role }, { merge: true });
    return { ok: true, uid, role };
  }
);
