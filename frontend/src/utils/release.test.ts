import { appTitle, shortSha, APP_NAME } from './release';
import { describe, it, expect } from 'vitest';

describe('release utils', () => {
  it('shortens sha to 7 chars', () => {
    expect(shortSha('abcdef123456')).toBe('abcdef1');
  });

  it('builds product title with version + sha', () => {
    const title = appTitle('Dashboard');
    expect(title).toContain('Dashboard');
    expect(title).toContain(APP_NAME);
    expect(title).toMatch(/v\d|0\.|dev/);
  });
});
