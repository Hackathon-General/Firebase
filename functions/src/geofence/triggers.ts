import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { db, rtdb, messaging } from '../lib/admin';
import { isWithin } from '../lib/geo';

const REGION = 'europe-west1';

/**
 * When an admin creates an alert, find users whose live position is within the radius and
 * fan out FCM (v1, via Admin SDK) push notifications to their stored tokens. Bounded + batched.
 */
export const onAlertCreated = onDocumentCreated(
  { region: REGION, document: 'alerts/{alertId}', maxInstances: 5 },
  async (event) => {
    const alert = event.data?.data();
    if (!alert || typeof alert.lat !== 'number') return;

    const center = { lat: alert.lat, lng: alert.lng };
    const radius = Number(alert.radius) || 300;

    // Read current live positions (phones + sensors).
    const liveSnap = await rtdb.ref('live').get();
    const live = (liveSnap.val() as Record<string, { lat: number; lng: number }>) || {};

    const affectedIds = Object.entries(live)
      .filter(([, p]) => p && isWithin(p, center, radius))
      .map(([id]) => id);

    if (affectedIds.length === 0) {
      logger.info('alert: nobody in radius', { alertId: event.params.alertId });
      return;
    }

    // Look up push tokens for affected users (skip sensor ids gracefully).
    const tokens: string[] = [];
    await Promise.all(
      affectedIds.map(async (uid) => {
        const doc = await db.doc(`users/${uid}`).get();
        const token = doc.get('pushToken');
        if (typeof token === 'string' && token) tokens.push(token);
      })
    );

    if (tokens.length === 0) return;

    // FCM v1 multicast (batched in chunks of 500).
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      await messaging.sendEachForMulticast({
        tokens: batch,
        notification: {
          title: alert.title || 'התראה מההנהלה',
          body: alert.message || '',
        },
        data: {
          url: `carmelkinneret://alert/${event.params.alertId}`,
          audioUrl: alert.audioUrl || '',
        },
      });
    }
    logger.info('alert fan-out', { alertId: event.params.alertId, count: tokens.length });
  }
);
