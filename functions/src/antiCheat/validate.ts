import { distanceMeters } from '../lib/geo';

/** Max plausible human speed on foot/relay, m/s (≈ 36 km/h covers fast running + GPS jitter). */
export const MAX_SPEED_MPS = 10;

export interface Point {
  lat: number;
  lng: number;
  ts: number; // ms epoch
}

export interface ValidationResult {
  ok: boolean;
  distanceM: number;
  speedMps: number;
  reason?: string;
}

/**
 * Validate a movement segment between two points: reject teleports / impossible speed.
 * Pure + unit-testable; used by torch km accrual and live-position anti-cheat.
 */
export function validateSegment(prev: Point, next: Point): ValidationResult {
  const dtSec = (next.ts - prev.ts) / 1000;
  const distanceM = distanceMeters(prev, next);

  if (dtSec <= 0) {
    return { ok: false, distanceM, speedMps: Infinity, reason: 'non-positive-time' };
  }
  const speedMps = distanceM / dtSec;
  if (speedMps > MAX_SPEED_MPS) {
    return { ok: false, distanceM, speedMps, reason: 'impossible-speed' };
  }
  return { ok: true, distanceM, speedMps };
}
