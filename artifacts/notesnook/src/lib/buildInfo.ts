// Build metadata — injected at build time by Vite.
// Falls back to a local dev stamp when __BUILD_INFO__ is not defined.

declare const __BUILD_INFO__: string | undefined;

export interface BuildInfo {
  /** Short commit hash (e.g. "a1b2c3d") */
  commit: string;
  /** ISO-8601 build timestamp */
  buildTime: string;
  /** Human-friendly version line */
  label: string;
}

const DEV: BuildInfo = {
  commit: 'dev',
  buildTime: new Date().toISOString(),
  label: 'dev',
};

export function getBuildInfo(): BuildInfo {
  if (typeof __BUILD_INFO__ !== 'undefined' && __BUILD_INFO__) {
    try {
      return JSON.parse(__BUILD_INFO__) as BuildInfo;
    } catch { /* fall through */ }
  }
  return DEV;
}
