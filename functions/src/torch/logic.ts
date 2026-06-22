import { distanceMeters } from '../lib/geo';

/** Pickup radius — how close (m) a hiker must be to take the waiting torch. */
export const TORCH_PICKUP_RADIUS_M = 60;

export type TorchStatus = 'waiting' | 'held';

export interface TorchState {
  status: TorchStatus;
  lat: number;
  lng: number;
  holderId?: string;
  holderName?: string;
  holderPhoto?: string;
  heldSince?: number;
  source?: 'phone' | 'sensor';
  droppedAt?: number;
}

/** Can `user` at (lat,lng) take the torch? Only if it's waiting and within pickup radius. */
export function canTakeTorch(
  torch: TorchState | null,
  user: { lat: number; lng: number }
): { ok: boolean; reason?: string; distanceM?: number } {
  if (!torch) return { ok: false, reason: 'no-torch' };
  if (torch.status !== 'waiting') return { ok: false, reason: 'not-waiting' };
  const distanceM = distanceMeters({ lat: torch.lat, lng: torch.lng }, user);
  if (distanceM > TORCH_PICKUP_RADIUS_M) {
    return { ok: false, reason: 'too-far', distanceM };
  }
  return { ok: true, distanceM };
}

/** Build the new state when a holder drops the torch — it waits at the drop coords. */
export function dropTorchState(
  torch: TorchState,
  dropAt: { lat: number; lng: number },
  now: number
): TorchState {
  return {
    status: 'waiting',
    lat: dropAt.lat,
    lng: dropAt.lng,
    droppedAt: now,
  };
}
