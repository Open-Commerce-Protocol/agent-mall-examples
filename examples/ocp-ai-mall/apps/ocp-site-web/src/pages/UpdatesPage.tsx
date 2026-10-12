import { Link } from 'react-router-dom';
import { ArrowRight, CircleAlert, Newspaper } from 'lucide-react';
import { resolveLocalizedText, useDocsLocale } from '../content/i18n';
import { breakingChangeLabel, updateCategoryLabels, updates } from '../content/updates';
import { resolvePublicImageSrc } from '../lib/markdown-render';

export function UpdatesPage() {
  const { locale, localizePath } = useDocsLocale();

  return (
    <main>
      <section className="relative isolate overflow-hidden border-b border-black/10">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-76"
          style={{ backgroundImage: 'url(/images/site/updates-release-ledger.png)' }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(246,247,242,0.96)_0%,rgba(246,247,242,0.86)_42%,rgba(246,247,242,0.22)_100%)]" aria-hidden="true" />
        <div className="relative mx-auto min-h-[48vh] max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <div className="section-kicker">{locale === 'zh' ? '项目进展' : 'Project updates'}</div>
            <h1 className="mt-4 text-5xl font-semibold leading-tight">{locale === 'zh' ? '了解 OCP Catalog 正在变得更可用。' : 'Follow how OCP Catalog is becoming easier to use.'}</h1>
            <p className="mt-5 text-lg leading-8 text-black/65">
              {locale === 'zh'
                ? '这里记录协议能力、接入示例、文档入口和生态协作的进展，方便你快速判断现在适合从哪里开始。'
                : 'This page tracks protocol capabilities, integration examples, documentation entry points, and ecosystem progress so visitors can see where to start.'}
            </p>
          </div>
        </div>
      </section>

      <section className="site-section">
        <div className="site-container">
          <div className="space-y-4">
            {updates.map((update) => (
              <Link
                key={update.slug}
                to={localizePath(`/updates/${update.slug}`)}
                className="grid gap-5 rounded-md border border-black/10 bg-white p-5 shadow-sm transition-transform hover:-translate-y-1 md:grid-cols-[10rem_1fr_auto]"
              >
                <div>
                  <div className="text-sm font-semibold text-black/72">{update.publishedAt}</div>
                  <div className="mt-2 inline-flex rounded-md bg-black/[0.06] px-2 py-1 text-xs font-semibold text-black/60">
                    {resolveLocalizedText(updateCategoryLabels[update.category], locale)}
                  </div>
                </div>
                <div>
                  {update.cover && (
                    <img
                      src={resolvePublicImageSrc(update.cover)}
                      alt=""
                      className="mb-3 aspect-[16/7] w-full rounded-md border border-black/10 object-cover"
                    />
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {update.breaking && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-[rgba(217,84,54,0.12)] px-2 py-1 text-xs font-semibold text-[var(--ocp-vermilion)]">
                        <CircleAlert className="h-3.5 w-3.5" />
                        {resolveLocalizedText(breakingChangeLabel, locale)}
                      </span>
                    )}
                    {update.version && <span className="rounded-md bg-[rgba(0,167,165,0.12)] px-2 py-1 text-xs font-semibold text-[var(--ocp-cyan)]">{update.version}</span>}
                  </div>
                  <h2 className="mt-3 text-2xl font-semibold">{resolveLocalizedText(update.title, locale)}</h2>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-black/62">{resolveLocalizedText(update.summary, locale)}</p>
                </div>
                <div className="flex items-center text-sm font-semibold text-black/70">
                  {locale === 'zh' ? '阅读' : 'Read'}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="site-section border-t border-black/10 bg-white">
        <div className="site-container flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ocp-green)]">
              <Newspaper className="h-4 w-4" />
              {locale === 'zh' ? '持续更新' : 'More to come'}
            </div>
            <p className="mt-2 max-w-2xl text-black/62">
              {locale === 'zh'
                ? '后续会继续补充协议进展、接入案例、工具发布和社区协作信息。'
                : 'Future posts will cover protocol progress, integration stories, tooling releases, and community collaboration.'}
            </p>
          </div>
          <Link to={localizePath('/docs')} className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--ocp-ink)] px-5 py-3 text-sm font-semibold text-[var(--ocp-paper)]">
            {locale === 'zh' ? '返回文档' : 'Back to docs'}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </main>
  );
}
