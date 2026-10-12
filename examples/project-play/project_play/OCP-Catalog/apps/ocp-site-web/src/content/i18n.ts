import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { addLocalePrefix, stripLocalePrefix } from './routing';

export type DocsLocale = 'en' | 'zh';

export type LocalizedText = {
  en: string;
  zh: string;
};

export type MaybeLocalizedText = LocalizedText | string;

export const docsUiText = {
  brand: {
    en: 'Open Commerce Protocol',
    zh: 'Open Commerce Protocol',
  },
  version: {
    en: 'v1.0-dev',
    zh: 'v1.0-dev',
  },
  searchPlaceholder: {
    en: 'Search documentation...',
    zh: '搜索文档...',
  },
  currentPage: {
    en: 'Current page',
    zh: '当前页面',
  },
  onThisPage: {
    en: 'On this page',
    zh: '本页目录',
  },
  noHeadings: {
    en: 'No headings detected for this page yet.',
    zh: '当前页面还没有可提取的标题。',
  },
  authoringNoteTitle: {
    en: 'Authoring note',
    zh: '编写说明',
  },
  authoringNoteBody: {
    en: 'This page is markdown-driven. Add headings in the content file and they will show up here automatically.',
    zh: '当前页面由 Markdown 驱动。只要在内容文件中加入标题，这里就会自动生成目录。',
  },
  schemaFragments: {
    en: 'Schema Fragments',
    zh: 'Schema 片段',
  },
  schemaPackages: {
    en: 'Schema Packages',
    zh: '完整 Schema 包',
  },
  openFullSchema: {
    en: 'Open Full Schema',
    zh: '查看完整 Schema',
  },
  fullSchemaPackage: {
    en: 'Full Schema Package',
    zh: '完整 Schema 文件',
  },
  apiEndpointExamples: {
    en: 'API Endpoint Examples',
    zh: 'API 接口示例',
  },
  headers: {
    en: 'Headers',
    zh: '请求头',
  },
  request: {
    en: 'Request',
    zh: '请求体',
  },
  response: {
    en: 'Response',
    zh: '响应体',
  },
  implementedInRepo: {
    en: 'Implemented In This Repo',
    zh: '仓库中的实现位置',
  },
  langEn: {
    en: 'EN',
    zh: 'EN',
  },
  langZh: {
    en: '中文',
    zh: '中文',
  },
  docs: {
    en: 'Docs',
    zh: '文档',
  },
  updates: {
    en: 'News',
    zh: '新闻',
  },
  directory: {
    en: 'Directory',
    zh: '目录',
  },
  products: {
    en: 'Products',
    zh: '产品',
  },
  topology: {
    en: 'Topology',
    zh: '拓扑',
  },
  roadmap: {
    en: 'Roadmap',
    zh: '路线图',
  },
} satisfies Record<string, LocalizedText>;

export function resolveDocsLocale(value: string | null | undefined): DocsLocale {
  return value === 'zh' ? 'zh' : 'en';
}

export function detectSystemDocsLocale(): DocsLocale {
  if (typeof navigator === 'undefined') {
    return 'en';
  }

  const preferredLocales = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  const matchedLocale = preferredLocales.find((locale) => locale.toLowerCase().startsWith('zh'));

  return matchedLocale ? 'zh' : 'en';
}

export function getLocalizedText(text: LocalizedText, locale: DocsLocale): string {
  return text[locale];
}

export function resolveLocalizedText(text: MaybeLocalizedText, locale: DocsLocale): string {
  return typeof text === 'string' ? text : text[locale];
}

export function withDocsLocale(path: string, locale: DocsLocale): string {
  return addLocalePrefix(path, locale);
}

export function useDocsLocale() {
  const location = useLocation();
  const navigate = useNavigate();
  const locale: DocsLocale = location.pathname === '/zh' || location.pathname.startsWith('/zh/') ? 'zh' : 'en';

  const api = useMemo(
    () => ({
      locale,
      setLocale(nextLocale: DocsLocale) {
        navigate(addLocalePrefix(stripLocalePrefix(location.pathname), nextLocale));
      },
      localizePath(path: string) {
        return withDocsLocale(path, locale);
      },
      text(label: LocalizedText) {
        return getLocalizedText(label, locale);
      },
    }),
    [locale, location.pathname, navigate],
  );

  return api;
}
