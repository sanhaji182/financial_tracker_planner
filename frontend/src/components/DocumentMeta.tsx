import React from 'react';
import { appTitle, BUILD_SHA, APP_VERSION, shortSha } from '../utils/release';

/**
 * Sets document.title + optional meta description once on mount.
 * Keeps product name + release SHA visible for support/debug.
 */
export const DocumentMeta: React.FC<{ page?: string }> = ({ page }) => {
  React.useEffect(() => {
    document.title = appTitle(page);
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    meta.content =
      'Financial OS — household finance operating system. Estimasi edukatif, bukan nasihat investasi berizin.';
    // Expose build for support without cluttering UI.
    document.documentElement.dataset.buildSha = BUILD_SHA;
    document.documentElement.dataset.appVersion = APP_VERSION;
  }, [page]);

  return (
    <span className="sr-only" aria-live="polite">
      Financial OS versi {APP_VERSION}, build {shortSha()}
    </span>
  );
};

export default DocumentMeta;
