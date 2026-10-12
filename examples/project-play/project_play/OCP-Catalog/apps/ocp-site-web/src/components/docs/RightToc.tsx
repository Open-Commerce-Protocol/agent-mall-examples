import type { TocHeading } from './DocsLayout';
import { docsUiText, useDocsLocale } from '../../content/i18n';
import { scrollToElementById } from '../../lib/scroll';

type RightTocProps = {
  headings: TocHeading[];
};

export function RightToc({ headings }: RightTocProps) {
  const { text } = useDocsLocale();
  const hasHeadings = headings.length > 0;

  return (
    <div className="w-56">
      <div className="rounded-md border border-black/10 bg-white p-4 shadow-sm">
        <h4 className="mb-4 border-b border-black/10 pb-2 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ocp-ink)]">
          {text(docsUiText.onThisPage)}
        </h4>

        {hasHeadings ? (
          <ul className="space-y-2 text-sm text-black/60">
            {headings.map((heading) => (
              <li
                key={heading.id}
                className={heading.level > 2 ? 'border-l border-black/10 pl-3' : ''}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToElementById(heading.id);
                  }}
                  className="block text-left transition-colors hover:text-[var(--ocp-cyan)]"
                >
                  {heading.text}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-black/50">{text(docsUiText.noHeadings)}</p>
        )}
      </div>
    </div>
  );
}
