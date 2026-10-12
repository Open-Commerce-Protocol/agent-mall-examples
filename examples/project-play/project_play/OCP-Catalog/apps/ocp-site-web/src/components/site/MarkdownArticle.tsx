import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import {
  extractTextFromNode,
  parsePipeTable,
  renderTableCellContent,
  renderMarkdownImage,
} from '../../lib/markdown-render';
import { scrollToElementById } from '../../lib/scroll';

function buildComponents(navigate: ReturnType<typeof useNavigate>): Components {
  return {
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
      if (!href) return <span>{children}</span>;
      if (href.startsWith('#')) {
        const targetId = href.slice(1);
        return (
          <a
            href={href}
            onClick={(event) => {
              event.preventDefault();
              scrollToElementById(targetId);
            }}
            className="text-[var(--ocp-cyan)] hover:text-[var(--ocp-ink)]"
          >
            {children}
          </a>
        );
      }
      const isExternal = /^[a-z]+:/i.test(href) || href.startsWith('//');
      if (isExternal) {
        return (
          <a href={href} target="_blank" rel="noreferrer" className="text-[var(--ocp-cyan)] hover:text-[var(--ocp-ink)]">
            {children}
          </a>
        );
      }
      const target = href.startsWith('/') ? href : `/${href.replace(/^\/+/, '')}`;
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
        <pre className="docs-code-block">{children}</pre>
      </div>
    ),
    img: ({ src, alt }) => renderMarkdownImage(src, alt),
  };
}

export function MarkdownArticle({ content }: { content: string }) {
  const navigate = useNavigate();
  const components = useMemo(() => buildComponents(navigate), [navigate]);
  return (
    <article className="docs-prose prose prose-slate max-w-none prose-headings:font-bold prose-a:text-[var(--ocp-cyan)] hover:prose-a:text-[var(--ocp-ink)]">
      <Markdown components={components}>{content}</Markdown>
    </article>
  );
}
