import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: { alias: { '@core': path('./core'), '@ext': path('./extension/src') } },
  test: {
    environment: 'node',
    include: ['tests/core/strengthCalibration.test.ts'],
  },
});
