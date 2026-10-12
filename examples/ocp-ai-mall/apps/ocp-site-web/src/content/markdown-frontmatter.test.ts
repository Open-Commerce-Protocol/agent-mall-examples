import { describe, expect, test } from 'bun:test';
import { stripFrontmatter } from './markdown-frontmatter';

describe('stripFrontmatter', () => {
  test('removes a leading frontmatter block', () => {
    const input = '---\ntitle: Hi\n---\n# Body\n\ntext';
    expect(stripFrontmatter(input)).toBe('# Body\n\ntext');
  });

  test('handles CRLF line endings', () => {
    const input = '---\r\ntitle: Hi\r\n---\r\n# Body';
    expect(stripFrontmatter(input)).toBe('# Body');
  });

  test('leaves content without frontmatter untouched', () => {
    const input = '# Body\n\ntext';
    expect(stripFrontmatter(input)).toBe('# Body\n\ntext');
  });
});
