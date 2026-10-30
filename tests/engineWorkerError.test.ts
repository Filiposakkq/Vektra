import { describe, expect, it } from 'vitest';
import { describeWorkerError } from '../src/engine/workerError';

describe('engine worker error details', () => {
  it('preserves object causes and worker source coordinates', () => {
    const event = new ErrorEvent('error', {
      message: '[object Object]',
      filename: 'chrome-extension://test/engine/stockfish.js',
      lineno: 12,
      colno: 4,
      error: { reason: 'WASM initialization failed' },
    });

    expect(describeWorkerError(event)).toContain('stockfish.js:12:4');
    expect(describeWorkerError(event)).toContain('{"reason":"WASM initialization failed"}');
  });

  it('uses the Error stack when the worker reports an Error', () => {
    const cause = new TypeError('bad wasm response');
    const event = new ErrorEvent('error', { message: 'worker failure', error: cause });

    expect(describeWorkerError(event)).toContain('TypeError: bad wasm response');
  });
});
