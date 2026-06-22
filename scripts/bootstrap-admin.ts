/**
 * One-off: grant the first admin. Run with a service account:
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json npx ts-node scripts/bootstrap-admin.ts <uid>
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const uid = process.argv[2];
if (!uid) {
  console.error('Usage: bootstrap-admin.ts <uid>');
  process.exit(1);
}

initializeApp({ credential: applicationDefault() });

(async () => {
  await getAuth().setCustomUserClaims(uid, { role: 'admin' });
  await getFirestore().doc(`users/${uid}`).set({ role: 'admin' }, { merge: true });
  console.log(`✓ ${uid} is now an admin. They must re-login to refresh the token.`);
  process.exit(0);
})();
