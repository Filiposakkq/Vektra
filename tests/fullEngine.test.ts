import { describe, expect, it } from 'vitest';
import { FullEngineUrlLeases } from '../src/engine/fullEngine';

describe('full-engine Blob URL leases', () => {
  it('revokes a retired URL only after every worker releases it', () => {
    const revoked: string[] = [];
    const leases = new FullEngineUrlLeases((url) => revoked.push(url));
    const releaseFirst = leases.acquire('blob:full-engine');
    const releaseSecond = leases.acquire('blob:full-engine');

    leases.retire('blob:full-engine');
    expect(revoked).toEqual([]);
    releaseFirst();
    expect(revoked).toEqual([]);
    releaseSecond();
    expect(revoked).toEqual(['blob:full-engine']);
  });

  it('revokes a retired URL immediately when no worker is using it', () => {
    const revoked: string[] = [];
    const leases = new FullEngineUrlLeases((url) => revoked.push(url));

    leases.retire('blob:unused');

    expect(revoked).toEqual(['blob:unused']);
  });

  it('makes each worker release idempotent', () => {
    const revoked: string[] = [];
    const leases = new FullEngineUrlLeases((url) => revoked.push(url));
    const release = leases.acquire('blob:full-engine');
    leases.retire('blob:full-engine');

    release();
    release();

    expect(revoked).toEqual(['blob:full-engine']);
  });
});
