import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../lib/admin';
import stationsData from '../seed-data/stations.json';
import events from '../seed-data/events.json';
import routes from '../seed-data/routes.json';
import he from '../seed-data/he.json';

const REGION = 'europe-west1';

/**
 * seedContent — one-time (idempotent) admin action that populates Firestore with the canonical
 * trail content so the app reads everything live. Admin-claim guarded.
 */
export const seedContent = onCall(
  { region: REGION, enforceAppCheck: true, maxInstances: 2, timeoutSeconds: 60, memory: '256MiB' },
  async (request) => {
    if (request.auth?.token?.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Admins only.');
    }

    const now = Date.now();
    const batch = db.batch();
    for (const s of (stationsData as any).stations) {
      batch.set(db.doc(`stations/${s.id}`), { ...s, updatedAt: now }, { merge: true });
    }
    batch.set(db.doc('content/event'), { ...(events as object), updatedAt: now }, { merge: true });
    batch.set(db.doc('content/routes'), { ...(routes as object), updatedAt: now }, { merge: true });
    batch.set(db.doc('content/site'), {
      siteTitle: (he as any).siteTitle, tagline: (he as any).tagline, subtitle: (he as any).subtitle,
      memorial: (he as any).memorial, goals: (he as any).goals, values: (he as any).values,
      nav: (he as any).nav, actions: (he as any).actions, ui: (he as any).ui,
      race: (he as any).race, footer: (he as any).footer, credit: (he as any).credit, updatedAt: now,
    }, { merge: true });
    await batch.commit();

    return { ok: true, stations: (stationsData as any).stations.length };
  }
);
