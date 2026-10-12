import type { DocsLocale } from './i18n';

/**
 * Build the ordered list of candidate module paths for an article body.
 * en → just the english file; zh → localized first, then english fallback.
 * Pure and glob-free, so it is safe to import under the `bun test` runner.
 */
export function updateContentCandidates(slug: string, locale: DocsLocale): string[] {
  const en = `./updates/${slug}.md`;
  const localized = `./updates/locales/${locale}/${slug}.md`;
  return locale === 'en' ? [en] : [localized, en];
}

/**
 * Pure resolver: given a map of module-path -> raw string, return the best
 * raw markdown for (slug, locale), or null if no candidate is present.
 * Exported for testing; production resolves through loadUpdateContent.
 */
export function resolveUpdateContent(
  slug: string,
  locale: DocsLocale,
  resolved: Record<string, string>,
): string | null {
  for (const candidate of updateContentCandidates(slug, locale)) {
    if (candidate in resolved) return resolved[candidate];
  }
  return null;
}
