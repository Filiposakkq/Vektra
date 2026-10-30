// Types for build-fingerprint.mjs, so TypeScript callers (vite.config.ts,
// tests) can import it without allowJs.

export const BUILD_STAMP_FILE: string;
export const FINGERPRINT_INPUTS: readonly string[];
export const FINGERPRINT_EXCLUDES: readonly string[];

export interface Fingerprint {
  /** SHA-256 over every input path and its content hash. */
  fingerprint: string;
  /** Content hash per input file, keyed by its path relative to the root. */
  files: Record<string, string>;
}

export function computeFingerprint(
  root: string,
  options?: { inputs?: readonly string[]; exclude?: readonly string[] },
): Fingerprint;

export function diffFingerprintFiles(
  built: Record<string, string>,
  current: Record<string, string>,
): { added: string[]; removed: string[]; changed: string[] };
