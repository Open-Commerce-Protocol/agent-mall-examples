import { useEffect, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, CircleDashed, Loader } from 'lucide-react';
import { ProtocolRelayCanvas } from '../components/site/ProtocolRelayCanvas';
import { resolveLocalizedText, useDocsLocale } from '../content/i18n';
import { roadmap, roadmapStatusLabels, type RoadmapStatus } from '../content/roadmap';
import { PageTheme } from '../theme/ThemeContext';

const statusIcon: Record<RoadmapStatus, typeof CheckCircle2> = {
  done: CheckCircle2,
  'in-progress': Loader,
  planned: CircleDashed,
};

export function RoadmapPage() {
  const { locale, localizePath } = useDocsLocale();

  // Reveal-on-scroll, same mechanism as HomePage.
  useEffect(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('.reveal-on-scroll'));
    if (items.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
    );

    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  return (
    <main className="home-story">
      <PageTheme theme="dark" />
      <section className="relative isolate overflow-hidden border-b border-[var(--border-soft)]">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-[0.35]"
          style={{ backgroundImage: 'url(/images/site/home-hero-protocol-relay.png)' }}
          aria-hidden="true"
        />
        <div className="ambient-field" aria-hidden="true" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,2,3,0.96)_0%,rgba(2,2,3,0.82)_45%,rgba(2,2,3,0.35)_72%,rgba(2,2,3,0.05)_100%)]" aria-hidden="true" />
        <ProtocolRelayCanvas />
        <div className="relative mx-auto min-h-[52vh] max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <div className="section-kicker">{locale === 'zh' ? '产品路线图' : 'Product roadmap'}</div>
            <h1 className="mt-4 text-5xl font-semibold leading-tight sm:text-6xl">
              {locale === 'zh' ? '我们已经实现了什么，下一步去哪里。' : 'What is already shipped, and where OCP is heading.'}
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--text-muted)]">
              {locale === 'zh'
                ? 'OCP Catalog 已经从协议草案走到可运行的工具与真实接入。这里把已交付、进行中和规划中的工作排成一条时间线。'
                : 'OCP Catalog has moved from a draft spec to running tooling and real integrations. This timeline lays out what is shipped, in progress, and planned.'}
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              {(['done', 'in-progress', 'planned'] as RoadmapStatus[]).map((status) => (
                <span key={status} className={`roadmap-legend roadmap-legend-${status}`}>
                  <span className="roadmap-legend-dot" aria-hidden="true" />
                  {resolveLocalizedText(roadmapStatusLabels[status], locale)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="site-section">
        <div className="site-container">
          <ol className="roadmap-timeline">
            {roadmap.map((phase, phaseIndex) => {
              const Icon = statusIcon[phase.status];
              return (
                <li
                  key={phase.id}
                  className={`roadmap-phase reveal-on-scroll roadmap-phase-${phase.status}`}
                  style={{ '--reveal-delay': `${phaseIndex * 80}ms` } as CSSProperties}
                >
                  <span className="roadmap-node" aria-hidden="true">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="roadmap-phase-body">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`roadmap-status-chip roadmap-status-chip-${phase.status}`}>
                        {resolveLocalizedText(roadmapStatusLabels[phase.status], locale)}
                      </span>
                      <span className="text-sm font-semibold uppercase tracking-wide text-[var(--text-faint)]">
                        {resolveLocalizedText(phase.period, locale)}
                      </span>
                    </div>
                    <h2 className="mt-3 text-3xl font-semibold leading-tight">
                      {resolveLocalizedText(phase.title, locale)}
                    </h2>
                    <p className="mt-3 max-w-3xl text-lg leading-8 text-[var(--text-muted)]">
                      {resolveLocalizedText(phase.summary, locale)}
                    </p>
                    <div className="mt-6 grid gap-3 md:grid-cols-2">
                      {phase.items.map((item) => (
                        <div key={item.title.en} className="roadmap-item">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="text-base font-semibold leading-6">
                              {resolveLocalizedText(item.title, locale)}
                            </h3>
                            {item.tag && (
                              <span className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] px-2 py-0.5 text-[0.7rem] font-semibold uppercase text-[var(--text-faint)]">
                                {item.tag}
                              </span>
                            )}
                          </div>
                          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
                            {resolveLocalizedText(item.body, locale)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <section className="site-section glass-card border-t border-[var(--border-soft)]">
        <div className="site-container flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase text-[var(--ocp-gold)]">
              {locale === 'zh' ? '想一起建设？' : 'Want to build with us?'}
            </div>
            <h2 className="mt-3 max-w-2xl text-3xl font-semibold">
              {locale === 'zh' ? '从文档和工具链开始接入 OCP Catalog。' : 'Start with the docs and the tooling.'}
            </h2>
            <p className="mt-3 max-w-2xl text-white/62">
              {locale === 'zh'
                ? '协议契约、接入示例，以及已发布的 CLI 与 Skill，都可以在文档中找到入口。'
                : 'Protocol contracts, integration examples, and the published CLI and skill all have an entry point in the docs.'}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              to={localizePath('/docs/cli-and-skill')}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-white px-5 py-3 text-sm font-semibold text-[#050608] transition-transform hover:-translate-y-0.5"
            >
              {locale === 'zh' ? 'CLI 与 Skill' : 'CLI & skill'}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to={localizePath('/updates')}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-white/25 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              {locale === 'zh' ? '查看最新动态' : 'Latest updates'}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
