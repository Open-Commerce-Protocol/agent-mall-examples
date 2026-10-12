import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { useDocsLocale } from '../content/i18n';
import { loadPageContent } from '../content/loader';
import { loadPageArtifacts, type LoadedPageArtifacts } from '../content/page-artifacts';
import { docsContentIdToPublicPath } from '../content/routing';
import type { TocHeading } from '../components/docs/DocsLayout';
import { PageArtifacts } from '../components/docs/PageArtifacts';
import { scrollToElementById } from '../lib/scroll';
import {
  extractTextFromNode,
  parsePipeTable,
  renderTableCellContent,
  renderMarkdownImage,
} from '../lib/markdown-render';

type LayoutContext = {
  setHeadings: (headings: TocHeading[]) => void;
};

type MarkdownAstNode = {
  position?: {
    start?: {
      line?: number;
    };
  };
};

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/g, '-');

  return normalized || 'section';
}

function normalizeHeadingText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/[*_~]/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
    .trim();
}

function createHeadingId(text: string, line?: number): string {
  const baseId = slugify(normalizeHeadingText(text));
  return line ? `${baseId}-${line}` : baseId;
}

function extractHeadings(markdown: string): TocHeading[] {
  return markdown
    .split('\n')
    .flatMap((line, index) => {
      const match = line.match(/^(#{1,3})\s+(.+)$/);

      if (!match) {
        return [];
      }

      const level = match[1].length;
      const text = normalizeHeadingText(match[2]);

      return [{
        id: createHeadingId(text, index + 1),
        level,
        text,
      }];
    });
}

function createHeadingComponents(
  navigate: ReturnType<typeof useNavigate>,
  localizePath: (path: string) => string,
): Components {
  function nextId(children: ReactNode, node?: MarkdownAstNode) {
    return createHeadingId(extractTextFromNode(children), node?.position?.start?.line);
  }

  return {
    h1: ({ children, node }) => <h1 id={nextId(children, node)} className="scroll-mt-24">{children}</h1>,
    h2: ({ children, node }) => <h2 id={nextId(children, node)} className="scroll-mt-24">{children}</h2>,
    h3: ({ children, node }) => <h3 id={nextId(children, node)} className="scroll-mt-24">{children}</h3>,
    p: ({ children }) => {
      const tableRows = parsePipeTable(extractTextFromNode(children));

      if (!tableRows) {
        return <p>{children}</p>;
      }

      const [headers, ...bodyRows] = tableRows;

      return (
        <div className="docs-table-shell not-prose">
          <table className="docs-table">
            <thead>
              <tr>
                {headers.map((header, index) => (
                  <th key={index}>{renderTableCellContent(header)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{renderTableCellContent(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    },
    a: ({ href, children }) => {
      if (!href) {
        return <span>{children}</span>;
      }

      if (href.startsWith('#')) {
        const targetId = href.slice(1);
        return (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              scrollToElementById(targetId);
            }}
            className="text-[var(--ocp-cyan)] underline underline-offset-2 hover:text-[var(--ocp-ink)]"
          >
            {children}
          </button>
        );
      }

      const isExternal = /^[a-z]+:/i.test(href) || href.startsWith('//');
      if (isExternal) {
        return (
          <a href={href} className="text-[var(--ocp-cyan)] hover:text-[var(--ocp-ink)]">
            {children}
          </a>
        );
      }

      const normalizedPath = href.startsWith('/') ? href : `/${href.replace(/^\/+/, '')}`;
      const target = localizePath(docsContentIdToPublicPath(normalizedPath));
      return (
        <a
          href={target}
          onClick={(event) => {
            event.preventDefault();
            navigate(target);
          }}
          className="text-[var(--ocp-cyan)] hover:text-[var(--ocp-ink)]"
        >
          {children}
        </a>
      );
    },
    pre: ({ children }) => (
      <div className="docs-code-shell not-prose">
        <pre className="docs-code-block">
          {children}
        </pre>
      </div>
    ),
    img: ({ src, alt }) => renderMarkdownImage(src, alt),
  };
}

export function PageView() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setHeadings } = useOutletContext<LayoutContext>();
  const { locale, text, localizePath } = useDocsLocale();
  const [content, setContent] = useState<string>('# Loading...');
  const [artifacts, setArtifacts] = useState<LoadedPageArtifacts>({
    schemaSections: [],
    schemaPackages: [],
    implementationRefs: [],
    endpointExamples: [],
  });
  const headings = useMemo(() => extractHeadings(content), [content]);
  const markdownComponents = createHeadingComponents(navigate, localizePath);

  const routePath = location.pathname;

  useEffect(() => {
    let isCancelled = false;

    async function fetchContent() {
      setContent('# Loading...');
      setArtifacts({
        schemaSections: [],
        schemaPackages: [],
        implementationRefs: [],
        endpointExamples: [],
      });
      const [mdContent, pageArtifacts] = await Promise.all([
        loadPageContent(routePath, locale),
        loadPageArtifacts(routePath),
      ]);

      if (!isCancelled) {
        setContent(mdContent);
        setArtifacts(pageArtifacts);
      }
    }

    fetchContent();

    return () => {
      isCancelled = true;
    };
  }, [locale, routePath]);

  useEffect(() => {
    const artifactHeadings: TocHeading[] = [];

    if (artifacts.schemaSections.length > 0) {
      artifactHeadings.push({ id: 'schema-fragments', level: 2, text: text({ en: 'Schema Fragments', zh: 'Schema 片段' }) });
    }

    if (artifacts.schemaPackages.length > 0) {
      artifactHeadings.push({ id: 'schema-packages', level: 2, text: text({ en: 'Schema Packages', zh: '完整 Schema 包' }) });
    }

    if (artifacts.endpointExamples.length > 0) {
      artifactHeadings.push({
        id: 'api-endpoint-examples',
        level: 2,
        text: text({ en: 'API Endpoint Examples', zh: 'API 接口示例' }),
      });
    }

    if (artifacts.implementationRefs.length > 0) {
      artifactHeadings.push({
        id: 'implemented-in-this-repo',
        level: 2,
        text: text({ en: 'Implemented In This Repo', zh: '仓库中的实现位置' }),
      });
    }

    setHeadings([...headings, ...artifactHeadings]);

    return () => {
      setHeadings([]);
    };
  }, [artifacts, headings, setHeadings, text]);

  return (
    <>
      <article className="docs-prose prose prose-slate max-w-none prose-headings:font-bold prose-a:text-[var(--ocp-cyan)] hover:prose-a:text-[var(--ocp-ink)]">
        <Markdown components={markdownComponents}>{content}</Markdown>
      </article>
      <PageArtifacts artifacts={artifacts} />
    </>
  );
}
