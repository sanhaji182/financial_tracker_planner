/** Build / release metadata injected at Vite build time. */
export const APP_NAME = 'Financial OS';
export const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string) || '0.1.0';
export const BUILD_SHA = (import.meta.env.VITE_BUILD_SHA as string) || 'dev';

export function shortSha(sha: string = BUILD_SHA): string {
  return (sha || 'dev').slice(0, 7);
}

export function appTitle(page?: string): string {
  const base = `${APP_NAME} · v${APP_VERSION} (${shortSha()})`;
  return page ? `${page} · ${base}` : base;
}
