import type { DocsLocale } from './i18n';
import { stripFrontmatter } from './markdown-frontmatter';
import { updateContentCandidates } from './updates-content';

// Mirrors the docs loader.ts: `import.meta.glob` is a Vite compile-time macro
// that is statically replaced with the resolved module map. It is called
// UNCONDITIONALLY (no `typeof` guard) so Vite transforms it and the result is
// actually used at runtime — a guard like `typeof import.meta.glob === 'function'`
// would short-circuit to `{}` in the browser, because Vite rewrites the call
// site but not the surrounding guard, and `import.meta.glob` is undefined at
// runtime. The `bun test` runner never imports this module (tests import the
// glob-free updates-content.ts instead), so the macro never needs a fallback.
const rawModules = import.meta.glob('./updates/**/*.md', {
  query: '?raw',
  import: 'default',
});

// Re-export the pure resolver so existing importers keep working.
export { resolveUpdateContent, updateContentCandidates } from './updates-content';

/**
 * Load + strip frontmatter for a news article. Returns a fallback markdown
 * string if the slug has no content file.
 */
export async function loadUpdateContent(slug: string, locale: DocsLocale = 'en'): Promise<string> {
  for (const candidate of updateContentCandidates(slug, locale)) {
    const loader = rawModules[candidate] as (() => Promise<string>) | undefined;
    if (loader) {
      return stripFrontmatter(await loader());
    }
  }

  return `# Not available\n\nThis news article has no content file yet (expected \`src/content/updates/${slug}.md\`).`;
}
