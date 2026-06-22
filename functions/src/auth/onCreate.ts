import { beforeUserCreated } from 'firebase-functions/v2/identity';
import { db } from '../lib/admin';

const REGION = 'europe-west1';

/**
 * On every new user (Google or anonymous) create a users/{uid} profile with default role:user.
 * Custom claim role defaults to 'user'; admins are promoted later via setAdmin.
 */
export const onUserCreate = beforeUserCreated(
  { region: REGION },
  async (event) => {
    const user = event.data;
    if (!user) return;

    const isAnonymous = !user.email && (user.providerData?.length ?? 0) === 0;
    await db.doc(`users/${user.uid}`).set(
      {
        uid: user.uid,
        role: 'user',
        provider: isAnonymous ? 'anonymous' : 'google',
        isAnonymous,
        displayName: user.displayName ?? null,
        photoURL: user.photoURL ?? null,
        email: user.email ?? null,
        stationsVisited: [],
        totalKm: 0,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      },
      { merge: true }
    );

    // Set the default custom claim.
    return { customClaims: { role: 'user' } };
  }
);
