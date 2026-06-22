/**
 * Carmel-Kinneret Cloud Functions (2nd gen, nodejs22, region europe-west1).
 * All privileged writes go through these; rules are deny-by-default.
 * Deploy revision: r2 (full redeploy)
 */
export { setAdmin } from './admin/setAdmin';
export { upsertStation, deleteStation, updateContent } from './admin/content';
export { seedContent } from './admin/seed';
export { ingest } from './iot/ingest';
export { takeTorch, dropTorch, resetTorch } from './torch/relay';
export { onAlertCreated } from './geofence/triggers';
export { completeTrail } from './missions/takeHome';
// NOTE: onUserCreate (beforeUserCreated) removed — blocking auth functions require GCIP,
// which this project doesn't use. The users/{uid} profile is created client-side on first
// sign-in (see AuthProvider.ensureProfile); rules allow a user to create only their own doc
// with role:'user'. setAdmin (server) is the only way role becomes 'admin'.
