# Security model — Carmel-Kinneret

**Principle: the client is never trusted.** All privileged writes go through Cloud Functions
(Admin SDK). Rules are deny-by-default and act as an independent backstop.

## Admin = Firebase custom claim
- Admin is `role:"admin"` in the signed ID token (never a client-writable field).
- Granted only via the `setAdmin` callable (caller must already be admin) or the one-off
  `scripts/bootstrap-admin.ts` for the first admin.
- Rules check `request.auth.token.role == 'admin'` (Firestore) / `auth.token.role === 'admin'` (RTDB).

## Cloud Functions request handling
- **Callables** (`takeTorch`, `dropTorch`, `resetTorch`, `setAdmin`, `completeTrail`): `enforceAppCheck:true`,
  reject unauthenticated (401), admin ops re-check role server-side (403). `maxInstances` caps cost.
- **IoT ingest** (`onRequest`): `Authorization: Bearer <IOT_SECRET>` (constant-time compare) OR
  `X-Signature` HMAC-SHA256 of `${ts}.${body}`; stale-timestamp (>5min) rejected (replay protection);
  per-device rate limit; payload validated before any RTDB write. `IOT_SECRET` via `defineSecret`.
- Set the secret: `firebase functions:secrets:set IOT_SECRET`.

## Data rules (see firestore.rules / database.rules.json / storage.rules)
- `users/{uid}`: read all; write own doc only, **cannot** change `role`/`totalKm`/`uid`.
- `feed`: create own posts; like/comment own; author/admin edit-delete.
- `stations`/`nfrs`/`alerts`/`takeHomeRules`/`event`: read all, **write admin only**.
- `leaderboard`: read-only (functions write via Admin SDK, which bypasses rules).
- RTDB `live/{uid}`: a user writes only their own node and **cannot** set `source` (so no spoofing
  sensor pins). `torch`/`community`: read-only to clients — mutated only by callables.
- Storage `feed/{uid}/*`: owner-only write, `image/*`, <8MB.

## Cost / loop safety
- Torch take/drop are callables; any `torch/active` listener writes a **different** node with an
  idempotency guard → no trigger loops.
- Client→server traffic throttled (location distance/time gate); geofence checks on-device.
- `maxInstances` on every function; App Check blocks non-app traffic. Set a Cloud Billing budget alert.

## App Check
Enable Play Integrity (Android) + App Attest/DeviceCheck (iOS) for the mobile app, and reCAPTCHA
Enterprise for the web admin. Grant "Firebase App Check Token Verifier" to the functions service account.
