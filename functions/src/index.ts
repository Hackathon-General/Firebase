/**
 * Carmel-Kinneret Cloud Functions (2nd gen, nodejs22, region europe-west1).
 * All privileged writes go through these; rules are deny-by-default.
 * Deploy revision: r2 (full redeploy)
 */
export { setAdmin } from './admin/setAdmin';
export { ingest } from './iot/ingest';
export { takeTorch, dropTorch, resetTorch } from './torch/relay';
export { onAlertCreated } from './geofence/triggers';
export { completeTrail } from './missions/takeHome';
export { onUserCreate } from './auth/onCreate';
