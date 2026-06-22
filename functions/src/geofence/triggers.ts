import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { db, rtdb, messaging } from '../lib/admin';
import { idsInRadius, buildAlertMessage, type LivePoint } from '../lib/notifications';

const REGION = 'europe-west1';

/**
 * When an admin creates an alert, find users whose live position is within the radius and
 * fan out PERSONALIZED FCM (v1) push notifications (greeting them by name). Bounded; no retry.
 */
export const onAlertCreated = onDocumentCreated(
  { region: REGION, document: 'alerts/{alertId}', maxInstances: 5, concurrency: 1, timeoutSeconds: 60, memory: '256MiB', cpu: 0.25, retry: false },
  async (event) => {
    const alert = event.data?.data();
    if (!alert || typeof alert.lat !== 'number') return;

    const center = { lat: alert.lat, lng: alert.lng };
    const radius = Number(alert.radius) || 300;

    // Read current live positions (phones + sensors).
    const liveSnap = await rtdb.ref('live').get();
    const live = (liveSnap.val() as Record<string, LivePoint>) || {};

    const affectedIds = idsInRadius(live, center, radius);
    if (affectedIds.length === 0) {
      logger.info('alert: nobody in radius', { alertId: event.params.alertId });
      return;
    }

    // Build a personalized push per affected user (name from their profile).
    const sends = await Promise.all(
      affectedIds.map(async (uid) => {
        const doc = await db.doc(`users/${uid}`).get();
        const token = doc.get('pushToken');
        if (typeof token !== 'string' || !token) return null;
        const name = (doc.get('displayName') as string | undefined) ?? live[uid]?.name;
        const msg = buildAlertMessage(event.params.alertId, alert, name);
        return { token, ...msg };
      })
    );

    const valid = sends.filter((s): s is NonNullable<typeof s> => s !== null);
    if (valid.length === 0) return;

    await Promise.all(
      valid.map((s) =>
        messaging.send({
          token: s.token,
          notification: { title: s.title, body: s.body },
          data: s.data,
        }).catch((e) => logger.warn('push failed', { err: String(e) }))
      )
    );

    logger.info('alert fan-out (personalized)', { alertId: event.params.alertId, count: valid.length });
  }
);
