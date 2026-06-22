/**
 * End-to-end test of every admin God-Mode capability against the LIVE backend.
 * Mirrors exactly what each admin screen / function writes, then verifies it landed.
 * Watch the simulator while this runs — each step should reflect within ~1s via listeners.
 *
 * Run in Cloud Shell (owner creds):
 *   cd /tmp && npm i firebase-admin@13
 *   node admin-e2e.js
 */
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getDatabase } = require('firebase-admin/database');

initializeApp({
  credential: applicationDefault(),
  projectId: 'carmel-kinneret',
  databaseURL: 'https://carmel-kinneret-default-rtdb.europe-west1.firebasedatabase.app',
});
const db = getFirestore();
const rtdb = getDatabase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n) => { console.log(`  ✅ ${n}`); pass++; };
const no = (n, e) => { console.log(`  ❌ ${n} — ${e}`); fail++; };

async function cleanup() {
  console.log('Cleaning up E2E test data...');
  await db.doc('stations/e2e-test-station').delete().catch(() => {});
  await rtdb.ref('live/e2e-runner').remove().catch(() => {});
  const nfrs = await db.collection('nfrs').where('title', '==', 'משימת בדיקה').get();
  for (const d of nfrs.docs) await d.ref.delete();
  const alerts = await db.collection('alerts').where('title', '==', 'התראת בדיקה').get();
  for (const d of alerts.docs) await d.ref.delete();
  console.log('✓ cleaned'); process.exit(0);
}

(async () => {
  if (process.argv.includes('--cleanup')) return cleanup();
  console.log('\n=== ADMIN E2E (live backend) ===\n');

  // 1) CONTENT: seed presence (תוכן tab "רענן")
  console.log('1. תוכן — content seeded?');
  const st = await db.collection('stations').get();
  st.size >= 13 ? ok(`stations present (${st.size})`) : no('stations', `only ${st.size}`);
  const ct = await db.collection('content').get();
  ['event', 'routes', 'site'].every((id) => ct.docs.find((d) => d.id === id))
    ? ok('content/{event,routes,site} present') : no('content docs', ct.docs.map((d) => d.id).join(','));

  // 2) CONTENT: upsert a station (תוכן "הוסף/ערוך") → app map should show it
  console.log('\n2. תוכן — upsert station (admin add/edit)');
  const testId = 'e2e-test-station';
  await db.doc(`stations/${testId}`).set({
    id: testId, number: 99, name: 'תחנת בדיקה E2E', value: 'volunteering', region: 'east',
    lat: 32.73, lng: 35.20, whatYouDo: 'בדיקה', aboutPlace: 'נקודת בדיקה', contactName: 'בודק', contactPhone: '0500000000',
    updatedAt: Date.now(),
  }, { merge: true });
  await sleep(800);
  (await db.doc(`stations/${testId}`).get()).exists ? ok('station written (check map for "תחנת בדיקה E2E")') : no('upsert', 'missing');

  // 3) CONTENT: update a singleton (updateContent)
  console.log('\n3. תוכן — updateContent (event banner)');
  await db.doc('content/event').set({ _e2e: Date.now() }, { merge: true });
  (await db.doc('content/event').get()).get('_e2e') ? ok('content/event patched') : no('updateContent', 'no field');

  // 4) NFR: place a mission (משימות tab)
  console.log('\n4. משימות — place NFR');
  const nfr = await db.collection('nfrs').add({
    lat: 32.74, lng: 35.10, radius: 150, title: 'משימת בדיקה', task: 'צלמו את הנוף', active: true, createdAt: Date.now(),
  });
  (await db.doc(`nfrs/${nfr.id}`).get()).exists ? ok('NFR created') : no('nfr', 'missing');

  // 5) ALERTS: fire an alert (התראות tab) → triggers onAlertCreated push fan-out
  console.log('\n5. התראות — fire alert (also exercises onAlertCreated)');
  const alert = await db.collection('alerts').add({
    lat: 32.75, lng: 35.07, radius: 1000, title: 'התראת בדיקה', message: 'בדיקת מערכת', createdAt: Date.now(),
  });
  (await db.doc(`alerts/${alert.id}`).get()).exists ? ok('alert created (onAlertCreated should fire)') : no('alert', 'missing');

  // 6) GOD-MODE MAP: simulate a live sensor pin (what ingest writes)
  console.log('\n6. מפה חיה — live sensor pin');
  await rtdb.ref('live/e2e-runner').set({ lat: 32.755, lng: 35.12, speed: 9, ts: Date.now(), source: 'sensor', name: 'רץ בדיקה' });
  await sleep(600);
  (await rtdb.ref('live/e2e-runner').get()).exists() ? ok('live pin set (check God-Mode + user map)') : no('live pin', 'missing');

  // 7) TORCH + LEADERBOARD: place torch + bump community km
  console.log('\n7. לפיד/מובילים — torch + community km');
  await rtdb.ref('torch/active').set({ status: 'waiting', lat: 32.749, lng: 35.07, droppedAt: Date.now() });
  await rtdb.ref('community/totalKm').set(42.5);
  const km = (await rtdb.ref('community/totalKm').get()).val();
  km === 42.5 ? ok('torch placed + km=42.5 (check leaderboard bank)') : no('torch/km', `km=${km}`);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  console.log('Now check the SIMULATOR — every item above should be visible live.');
  console.log('Cleanup test data:  node admin-e2e.js --cleanup\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
