import { describe, expect, test } from 'bun:test';
import { resolveUpdateContent } from './updates-content';

const modules: Record<string, string> = {
  './updates/demo.md': '# English body',
  './updates/locales/zh/demo.md': '# 中文正文',
  './updates/en-only.md': '# Only english',
};

describe('resolveUpdateContent', () => {
  test('returns english content for en locale', () => {
    expect(resolveUpdateContent('demo', 'en', modules)).toBe('# English body');
  });

  test('returns localized content for zh when present', () => {
    expect(resolveUpdateContent('demo', 'zh', modules)).toBe('# 中文正文');
  });

  test('falls back to english when zh missing', () => {
    expect(resolveUpdateContent('en-only', 'zh', modules)).toBe('# Only english');
  });

  test('returns null when the slug does not exist', () => {
    expect(resolveUpdateContent('missing', 'en', modules)).toBeNull();
  });
});
