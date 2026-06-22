import { canTakeTorch, dropTorchState, TorchState, TORCH_PICKUP_RADIUS_M } from './logic';
import { validateSegment, MAX_SPEED_MPS } from '../antiCheat/validate';
import { distanceMeters } from '../lib/geo';

describe('geo.distanceMeters', () => {
  it('is ~0 for the same point', () => {
    expect(distanceMeters({ lat: 32.75, lng: 35.07 }, { lat: 32.75, lng: 35.07 })).toBeLessThan(1);
  });
  it('computes a known distance roughly correctly', () => {
    // ~111m per 0.001 deg latitude
    const d = distanceMeters({ lat: 32.75, lng: 35.07 }, { lat: 32.751, lng: 35.07 });
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });
});

describe('canTakeTorch', () => {
  const waiting: TorchState = { status: 'waiting', lat: 32.75, lng: 35.07 };

  it('rejects when no torch', () => {
    expect(canTakeTorch(null, { lat: 32.75, lng: 35.07 }).ok).toBe(false);
  });
  it('rejects when torch is held', () => {
    expect(canTakeTorch({ ...waiting, status: 'held' }, { lat: 32.75, lng: 35.07 }).ok).toBe(false);
  });
  it('allows when within pickup radius', () => {
    const res = canTakeTorch(waiting, { lat: 32.7503, lng: 35.07 });
    expect(res.ok).toBe(true);
    expect(res.distanceM!).toBeLessThan(TORCH_PICKUP_RADIUS_M);
  });
  it('rejects when too far', () => {
    const res = canTakeTorch(waiting, { lat: 32.80, lng: 35.07 });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('too-far');
  });
});

describe('dropTorchState', () => {
  it('leaves the torch waiting at the drop coordinates', () => {
    const held: TorchState = { status: 'held', lat: 32.75, lng: 35.07, holderId: 'u1' };
    const next = dropTorchState(held, { lat: 32.76, lng: 35.10 }, 1000);
    expect(next.status).toBe('waiting');
    expect(next.lat).toBe(32.76);
    expect(next.lng).toBe(35.10);
    expect(next.holderId).toBeUndefined();
  });
});

describe('validateSegment (anti-cheat)', () => {
  it('accepts a plausible walking segment', () => {
    const r = validateSegment(
      { lat: 32.75, lng: 35.07, ts: 0 },
      { lat: 32.7501, lng: 35.07, ts: 60_000 } // ~11m in 60s
    );
    expect(r.ok).toBe(true);
    expect(r.speedMps).toBeLessThan(MAX_SPEED_MPS);
  });
  it('rejects a teleport (impossible speed)', () => {
    const r = validateSegment(
      { lat: 32.75, lng: 35.07, ts: 0 },
      { lat: 33.00, lng: 35.50, ts: 1000 } // tens of km in 1s
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('impossible-speed');
  });
  it('rejects non-positive time', () => {
    const r = validateSegment(
      { lat: 32.75, lng: 35.07, ts: 1000 },
      { lat: 32.75, lng: 35.07, ts: 1000 }
    );
    expect(r.ok).toBe(false);
  });
});
