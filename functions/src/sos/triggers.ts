import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { db, messaging } from '../lib/admin';

const REGION = 'europe-west1';

/**
 * When a user triggers SOS (dials 101 from the app), an sosEvents doc is created.
 * Fan out an FCM push to every admin so the חמ"ל knows immediately, with the user's
 * name + last-known location. Bounded, no retry. The doc itself is the admin-visible log.
 */
export const onSosCreated = onDocumentCreated(
  { region: REGION, document: 'sosEvents/{sosId}', maxInstances: 5, concurrency: 1, timeoutSeconds: 60, memory: '256MiB', cpu: 0.25, retry: false },
  async (event) => {
    const sos = event.data?.data();
    if (!sos) return;

    // All admins with a push token.
    const adminsSnap = await db.collection('users').where('role', '==', 'admin').get();
    const tokens = adminsSnap.docs
      .map((d) => d.get('pushToken'))
      .filter((t): t is string => typeof t === 'string' && t.length > 0);

    if (tokens.length === 0) {
      logger.warn('SOS created but no admin push tokens', { sosId: event.params.sosId });
      return;
    }

    const name = (sos.authorName as string | undefined) ?? 'מטייל/ת';
    const where = sos.lat != null ? `מיקום: ${Number(sos.lat).toFixed(4)}, ${Number(sos.lng).toFixed(4)}` : 'מיקום לא ידוע';
    const title = '🚨 קריאת מצוקה (SOS)';
    const body = `${name} חייג/ה 101. ${where}`;

    await Promise.all(
      tokens.map((token) =>
        messaging.send({
          token,
          notification: { title, body },
          data: { type: 'sos', sosId: event.params.sosId, lat: String(sos.lat ?? ''), lng: String(sos.lng ?? '') },
          android: { priority: 'high' },
          apns: { payload: { aps: { sound: 'default', 'interruption-level': 'critical' } } },
        }).catch((e) => logger.warn('SOS push failed', { err: String(e) }))
      )
    );

    logger.info('SOS fan-out to admins', { sosId: event.params.sosId, admins: tokens.length });
  }
);
