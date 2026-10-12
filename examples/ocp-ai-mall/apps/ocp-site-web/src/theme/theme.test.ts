import { describe, it, expect } from 'bun:test';
import { resolveTheme, DEFAULT_THEME } from './theme';

describe('resolveTheme', () => {
  it('defaults to light when no page declares a theme', () => {
    expect(resolveTheme(null)).toBe('light');
    expect(DEFAULT_THEME).toBe('light');
  });

  it('uses the declared theme when a page declares one', () => {
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
  });
});
