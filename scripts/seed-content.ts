/**
 * Seed all trail content into Firestore so NOTHING is hardcoded in the app.
 * Reads the canonical JSON (scraped from carmel-kinneret.org) and writes:
 *   stations/{id}, content/event, content/routes, content/site (values, ui copy, etc.)
 *
 * Run once (idempotent — merges):
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json npx ts-node scripts/seed-content.ts
 */
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';

if (getApps().length === 0) initializeApp({ credential: applicationDefault() });
const db = getFirestore();

// Content lives in the app repo; allow override via CONTENT_DIR.
const CONTENT_DIR =
  process.env.CONTENT_DIR ||
  path.resolve(__dirname, '../../applicationBuild/src/content');

function read(name: string): any {
  return JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, name), 'utf8'));
}

(async () => {
  const stationsData = read('stations.json');
  const events = read('events.json');
  const routes = read('routes.json');
  const he = read('he.json');

  // Stations → one doc each (admin can edit/add/remove individually).
  const batch = db.batch();
  for (const s of stationsData.stations) {
    batch.set(db.doc(`stations/${s.id}`), { ...s, updatedAt: Date.now() }, { merge: true });
  }
  await batch.commit();
  console.log(`✓ seeded ${stationsData.stations.length} stations`);

  // Event, routes, and site copy → singleton docs under content/.
  await db.doc('content/event').set({ ...events, updatedAt: Date.now() }, { merge: true });
  await db.doc('content/routes').set({ ...routes, updatedAt: Date.now() }, { merge: true });
  await db.doc('content/site').set(
    {
      siteTitle: he.siteTitle, tagline: he.tagline, subtitle: he.subtitle,
      memorial: he.memorial, goals: he.goals, values: he.values, nav: he.nav,
      actions: he.actions, ui: he.ui, race: he.race, footer: he.footer, credit: he.credit,
      updatedAt: Date.now(),
    },
    { merge: true }
  );
  console.log('✓ seeded content/event, content/routes, content/site');
  console.log('Done. The app now reads this from Firestore; admins can edit it live.');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
