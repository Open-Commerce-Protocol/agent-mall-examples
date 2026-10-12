import { docsPublicPathToContentModule } from './routing';
import { stripFrontmatter } from './markdown-frontmatter';

const modules = import.meta.glob('./**/*.md', {
  query: '?raw',
  import: 'default',
});

function normalizePath(path: string): string {
  return docsPublicPathToContentModule(path);
}

function localizedCandidates(path: string, locale: 'en' | 'zh') {
  const fullPath = normalizePath(path);
  const localizedPath = fullPath.replace('./', `./locales/${locale}/`);

  return locale === 'en' ? [fullPath] : [localizedPath, fullPath];
}

export async function loadPageContent(path: string, locale: 'en' | 'zh' = 'en'): Promise<string> {
  const candidates = localizedCandidates(path, locale);

  for (const candidate of candidates) {
    if (modules[candidate]) {
      const loader = modules[candidate] as () => Promise<string>;
      return stripFrontmatter(await loader());
    }
  }

  const fullPath = candidates[0];

  return `# Page Not Found

The documentation for \`${path}\` does not exist yet.

Add a markdown file at \`${fullPath.replace('./', 'src/content/')}\` to continue building this section.`;
}
