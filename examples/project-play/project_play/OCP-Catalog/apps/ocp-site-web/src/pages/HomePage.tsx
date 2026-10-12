import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, GitFork, Unlock } from 'lucide-react';
import {
  CatalogArchitectureDiagram,
  OnboardingScenePanel,
  SearchResolveActionDiagram,
  TrustBoundaryDiagram,
} from '../components/site/OcpDiagrams';
import { LiveActivitySection } from '../components/site/LiveActivitySection';
import { PageTheme } from '../theme/ThemeContext';
import { resolveLocalizedText, useDocsLocale, type LocalizedText } from '../content/i18n';
import { updates } from '../content/updates';
import { useCatalogScale } from '../lib/useCatalogScale';
import { formatFullCount } from '../lib/formatScale';
import { useCountUp } from '../lib/useCountUp';

const flowSteps = [
  { label: { en: 'Connect', zh: '接入' }, body: { en: 'Merchants expose products and services through an OCP connector.', zh: '商家通过 OCP 接入应用开放商品与服务。' } },
  { label: { en: 'Index', zh: '索引' }, body: { en: 'Catalogs make those objects searchable without owning fulfillment.', zh: 'Catalog 让对象可被查找，但不接管履约。' } },
  { label: { en: 'Discover', zh: '发现' }, body: { en: 'Agents find the right catalog for the user intent.', zh: 'Agent 根据用户意图找到合适的 Catalog。' } },
  { label: { en: 'Inspect', zh: '查看' }, body: { en: 'Resolve opens the selected option with the details needed to decide.', zh: 'Resolve 展开候选项，呈现用户决策所需信息。' } },
  { label: { en: 'Act', zh: '行动' }, body: { en: 'Checkout, booking, or quote requests continue only after confirmation.', zh: '结账、预订或报价等动作只在确认后继续。' } },
];

const builderPaths = [
  { title: { en: 'For catalog builders', zh: 'Catalog 构建者' }, href: '/docs/examples/minimal-catalog', body: { en: 'Learn how searchable commerce objects are published and resolved.', zh: '了解商业对象如何被发布、搜索和展开。' } },
  { title: { en: 'For merchants', zh: '商家与服务方' }, href: '/docs/examples/minimal-provider', body: { en: 'Connect existing product, inventory, quote, or booking systems.', zh: '接入已有商品、库存、报价或预订系统。' } },
  { title: { en: 'For agent teams', zh: 'Agent 团队' }, href: '/docs/examples/user-agent-flow', body: { en: 'Discover catalogs, compare candidates, and keep action consent explicit.', zh: '发现 Catalog、比较候选，并保持动作确认清晰。' } },
  { title: { en: 'For protocol readers', zh: '协议读者' }, href: '/docs/protocols/handshake-v1/catalog-manifest', body: { en: 'Read the contracts behind discovery, query, resolve, and action binding.', zh: '阅读发现、查询、解析和动作绑定背后的契约。' } },
  { title: { en: 'For tool builders', zh: '工具构建者' }, href: '/docs/cli-and-skill', body: { en: 'Install the CLI and skill from npm, then validate requests against manifests before they leave the machine.', zh: '从 npm 安装 CLI 和 skill，并在请求离开本机前用 manifest 校验。' } },
];

const layers = [
  { name: 'Handshake', tone: 'cyan' },
  { name: 'Registration', tone: 'gold' },
  { name: 'Query', tone: 'green' },
  { name: 'Resolve', tone: 'vermilion' },
  { name: 'Action Binding', tone: 'ink' },
];

const sectionIds = ['hero', 'flow', 'live', 'glance', 'why', 'open', 'onboarding', 'paths'] as const;
type SectionId = (typeof sectionIds)[number];

const sectionLabels: Record<SectionId, LocalizedText> = {
  hero: { en: 'Intro', zh: '简介' },
  flow: { en: 'How', zh: '流程' },
  live: { en: 'Live', zh: '实时' },
  glance: { en: 'At a glance', zh: '一眼看懂' },
  why: { en: 'Why', zh: '为什么' },
  open: { en: 'Open', zh: '开源' },
  onboarding: { en: 'Onboarding', zh: '接入' },
  paths: { en: 'Next', zh: '下一步' },
};

const GITHUB_URL = 'https://github.com/Open-Commerce-Protocol/OCP-Catalog';

function label(text: LocalizedText, locale: 'en' | 'zh') {
  return resolveLocalizedText(text, locale);
}

/**
 * "Stored & indexed" figure: shows the real grouped count (e.g. 12,008,514),
 * ticking up from 0 once a real value is available. Shows "—" (never a fake 0)
 * while loading or when the figure is unavailable — distinguishing "don't know"
 * from a genuine zero.
 */
function StoredCount({ scale }: { scale: ReturnType<typeof useCatalogScale> }) {
  const ready = scale.status === 'ready';
  const animated = useCountUp(scale.storedTotal, ready);
  if (!ready) return <>—</>;
  return <>{formatFullCount(animated)}</>;
}

export function HomePage() {
  const { locale, localizePath } = useDocsLocale();
  const latestUpdate = updates[0];
  const scale = useCatalogScale();
  const heroRef = useRef<HTMLElement | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>('hero');

  // Hero scroll-progress parallax via rAF + CSS custom property
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    let rafId = 0;
    let ticking = false;

    const update = () => {
      ticking = false;
      const rect = hero.getBoundingClientRect();
      const total = rect.height || 1;
      const scrolled = Math.min(Math.max(-rect.top / total, 0), 1);
      hero.style.setProperty('--scroll-progress', scrolled.toFixed(4));
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      rafId = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.cancelAnimationFrame(rafId);
    };
  }, []);

  // Reveal-on-scroll using IntersectionObserver
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

  // Section-in-view tracking for the side indicator
  useEffect(() => {
    const sections = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry closest to viewport top among intersecting ones
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActiveSection(visible[0].target.id as SectionId);
        }
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: 0 },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const scrollToSection = (id: SectionId) => {
    const el = document.getElementById(id);
    if (!el) return;
    const header = 80;
    const top = el.getBoundingClientRect().top + window.scrollY - header;
    window.scrollTo({ top, behavior: 'smooth' });
  };

  const activeIndex = sectionIds.indexOf(activeSection);
  const railProgress =
    sectionIds.length > 1 ? activeIndex / (sectionIds.length - 1) : 0;

  return (
    <main className="home-story">
      <PageTheme theme="dark" />
      <nav
        className="home-section-nav"
        aria-label="Sections"
        style={{ '--rail-progress': railProgress } as CSSProperties}
      >
        {sectionIds.map((id, index) => {
          const isActive = activeSection === id;
          const isPast = index < activeIndex;
          const classes = ['', isActive ? 'is-active' : '', isPast ? 'is-past' : '']
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={id}
              type="button"
              className={classes}
              onClick={() => scrollToSection(id)}
              aria-label={label(sectionLabels[id], locale)}
              aria-current={isActive ? 'true' : undefined}
            >
              <span>{label(sectionLabels[id], locale)}</span>
            </button>
          );
        })}
      </nav>

      <div className="home-panel-track">
      <section id="hero" ref={heroRef} className="home-panel relative isolate flex min-h-[calc(100svh-5rem)] flex-col overflow-hidden">
        {/* Full-bleed cinematic ambient image (bokeh on the right, black on the left) */}
        <div
          className="hero-bg hero-parallax-slow absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: 'url(/images/hero-ambient.png)' }}
          aria-hidden="true"
        />
        {/* Darken the left two-thirds so copy reads; let the right glow breathe */}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,2,3,0.97)_0%,rgba(2,2,3,0.88)_38%,rgba(2,2,3,0.45)_66%,rgba(2,2,3,0.10)_100%)]" aria-hidden="true" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,2,3,0.6)_0%,transparent_22%,transparent_72%,rgba(2,2,3,0.85)_100%)]" aria-hidden="true" />
        {/* Faint technical grid */}
        <div className="hero-grid absolute inset-0" aria-hidden="true" />

        {/* monospace corner annotations (Collov-style lab labels) */}
        <div className="hero-annotations pointer-events-none absolute inset-0 hidden lg:block" aria-hidden="true">
          <span className="absolute right-8 top-28 font-mono text-[11px] uppercase tracking-[0.28em] text-white/40">discovery</span>
          <span className="absolute right-8 top-40 font-mono text-[11px] uppercase tracking-[0.28em] text-white/30">query · resolve</span>
          <span className="absolute bottom-44 left-8 font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--ocp-cyan)]/55">action binding</span>
        </div>

        <div className="relative mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-4 py-12 sm:px-6 lg:px-8">
          <div className="hero-copy hero-parallax-fade max-w-4xl">
            <div className="reveal-item mb-8 flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase tracking-[0.22em] text-white/50">
              <span>Open Commerce Protocol</span>
              <span className="text-white/20">/</span>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[var(--ocp-cyan)]/80 transition-colors hover:text-[var(--ocp-cyan)]">
                <Unlock className="h-3 w-3" />
                {locale === 'zh' ? '开源' : 'Open source'}
              </a>
            </div>
            <h1 className="reveal-item max-w-5xl select-none text-[clamp(2.75rem,8vw,6.5rem)] font-semibold leading-[0.98] tracking-[-0.02em] text-white">
              {locale === 'zh' ? (
                <>商业对象,<br /><span className="text-white/55">为 Agent 而生</span></>
              ) : (
                <>Commerce objects,<br /><span className="text-white/55">built for agents.</span></>
              )}
            </h1>
            <p className="reveal-item mt-8 max-w-2xl text-lg leading-8 text-[var(--text-muted)] sm:text-xl">
              {locale === 'zh'
                ? 'OCP Catalog 把商品、服务和可执行动作变成开放的协议对象。Agent 发现、比较，并在用户确认后继续到商家真实交易入口。'
                : 'OCP Catalog turns products, services, and actions into open protocol objects. Agents discover them, compare them, and continue to merchant-owned execution after user confirmation.'}
            </p>
            <div className="reveal-item mt-10 flex flex-col gap-3 sm:flex-row">
              <Link to={localizePath('/docs')} className="inline-flex items-center justify-center gap-2 rounded-md bg-white px-6 py-3.5 text-sm font-semibold text-[#050608] transition-transform hover:-translate-y-0.5">
                {locale === 'zh' ? '了解 OCP 如何工作' : 'See how OCP works'}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to={localizePath('/updates')} className="inline-flex items-center justify-center border border-white/20 px-6 py-3.5 text-sm font-semibold text-white/90 transition-colors hover:border-white/40 hover:bg-white/[0.06]">
                {locale === 'zh' ? '查看新闻' : 'Read the news'}
              </Link>
            </div>
          </div>

          <div className="reveal-item mt-12 grid max-w-xl grid-cols-2 gap-8 border-t border-white/10 pt-5 font-mono">
            <div className="border-t border-white/10 pt-3">
              <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--text-faint)]">
                {locale === 'zh' ? '存储索引' : 'Stored & indexed'}
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums text-white/86">
                <StoredCount scale={scale} />
              </div>
            </div>
            <div className="border-t border-white/10 pt-3">
              <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--text-faint)]">
                {locale === 'zh' ? '按需流转' : 'Streamed on demand'}
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums text-[var(--ocp-cyan)]">∞</div>
            </div>
          </div>
        </div>

        <div className="hero-scroll-cue hidden lg:flex" aria-hidden="true">
          <span />
        </div>
      </section>

      <section id="flow" className="home-panel site-section immersive-section py-24 lg:py-32">
        <div
          className="section-bg"
          style={{ backgroundImage: 'url(/images/discovery-field.png)', opacity: 0.3 }}
          aria-hidden="true"
        />
        <div className="section-veil" aria-hidden="true" />
        <div className="site-container">
          <div className="reveal-on-scroll">
            <span className="mono-kicker">{locale === 'zh' ? '一次请求如何完成' : 'How one request moves'}</span>
          </div>
          <div className="mt-12 grid gap-x-6 gap-y-10 lg:grid-cols-5">
            {flowSteps.map((step, index) => (
              <div
                key={step.label.en}
                className="reveal-on-scroll border-t border-white/10 pt-5"
                style={{ '--reveal-delay': `${index * 90}ms` } as CSSProperties}
              >
                <div className="font-mono text-3xl font-semibold tabular-nums text-[var(--ocp-cyan)]/60">
                  {String(index + 1).padStart(2, '0')}
                </div>
                <h2 className="mt-4 text-lg font-semibold text-white">{label(step.label, locale)}</h2>
                <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">{label(step.body, locale)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="live" className="home-panel site-section immersive-section border-y border-white/10 py-24 lg:py-32">
        <LiveActivitySection />
      </section>

      <section id="glance" className="home-panel home-diagram-panel site-section immersive-section border-y border-white/10 py-24 lg:py-32">
        <div
          className="section-bg"
          style={{ backgroundImage: 'url(/images/network-substrate.png)', opacity: 0.38 }}
          aria-hidden="true"
        />
        <div className="section-veil" aria-hidden="true" />
        <div className="site-container">
          <div className="reveal-on-scroll mb-8 max-w-3xl">
            <span className="mono-kicker">{locale === 'zh' ? '一眼看懂 OCP Catalog' : 'OCP Catalog at a glance'}</span>
            <h2 className="giant-heading mt-4 font-semibold leading-tight">
              {locale === 'zh' ? '先理解它帮谁连接了什么，再决定是否深入文档。' : 'Understand who it connects and what stays under control before diving deeper.'}
            </h2>
          </div>
          <div className="home-diagram-stack space-y-12">
            <div className="reveal-on-scroll"><CatalogArchitectureDiagram locale={locale} /></div>
            <div className="reveal-on-scroll" style={{ '--reveal-delay': '120ms' } as CSSProperties}><SearchResolveActionDiagram locale={locale} /></div>
            <div className="reveal-on-scroll" style={{ '--reveal-delay': '240ms' } as CSSProperties}><TrustBoundaryDiagram locale={locale} /></div>
          </div>
        </div>
      </section>

      <section id="why" className="home-panel site-section immersive-section border-y border-white/10 py-24 lg:py-32">
        <div className="section-bg" style={{ backgroundImage: 'url(/images/trust-boundary.png)', opacity: 0.4 }} aria-hidden="true" />
        <div className="section-veil" aria-hidden="true" />
        <div className="site-container grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div className="reveal-on-scroll">
            <span className="mono-kicker">{locale === 'zh' ? '为什么需要它' : 'Why this matters'}</span>
            <h2 className="giant-heading mt-4 font-semibold leading-tight">{locale === 'zh' ? '让 Agent 找得到、看得懂，也不会绕过商家的交易边界。' : 'Agents can find and understand commerce options without bypassing merchant boundaries.'}</h2>
            <p className="mt-5 text-lg leading-8 text-[var(--text-muted)]">
              {locale === 'zh'
                ? 'OCP 不替代店铺、库存、报价或结账系统。它只把发现、查询、详情查看和动作确认的边界标准化。'
                : 'OCP does not replace stores, inventory, quotes, or checkout. It standardizes the boundary for discovery, search, detail lookup, and confirmed action.'}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-sm text-white/55">
              {layers.map((layer, index) => (
                <span key={layer.name} className="inline-flex items-center gap-2">
                  {index > 0 && <span className="text-[var(--ocp-cyan)]">·</span>}
                  {layer.name}
                </span>
              ))}
            </div>
          </div>
          <img
            src="/images/site/home-commerce-object-stack.png"
            alt=""
            className="reveal-on-scroll aspect-[4/3] w-full rounded-md border border-white/10 object-cover shadow-2xl shadow-black/40 brightness-90"
            style={{ '--reveal-delay': '120ms' } as CSSProperties}
          />
        </div>
      </section>

      <section id="open" className="home-panel site-section immersive-section border-y border-white/10 py-24 lg:py-32">
        <div className="site-container grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div className="reveal-on-scroll">
            <div className="mono-kicker inline-flex items-center gap-2 text-[var(--ocp-gold)]">
              <Unlock className="h-4 w-4" />
              {locale === 'zh' ? '开源 · 人人免费' : 'Open source · Free for everyone'}
            </div>
            <h2 className="giant-heading mt-4 max-w-2xl font-semibold leading-tight">
              {locale === 'zh'
                ? 'OCP 是开放协议，不是封闭平台。'
                : 'OCP is an open protocol, not a closed platform.'}
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--text-muted)]">
              {locale === 'zh'
                ? '协议、参考实现、CLI、Agent skill 和连接器全部开源、对所有人免费。任何主体都可以运行自己的注册节点与 Catalog，没有守门人。'
                : 'The protocol, the reference implementations, the CLI, the agent skill, and the connectors are all open source and free for everyone. Anyone can run their own registration node and catalog — there is no gatekeeper.'}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-md bg-white px-5 py-3 text-sm font-semibold text-[#050608] transition-transform hover:-translate-y-0.5"
              >
                <GitFork className="h-4 w-4" />
                {locale === 'zh' ? '在 GitHub 上查看源码' : 'Open source on GitHub'}
                <ArrowRight className="h-4 w-4" />
              </a>
              <Link
                to={localizePath('/products')}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-white/25 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                {locale === 'zh' ? '查看全部产品' : 'See all products'}
              </Link>
            </div>
          </div>
          <div className="reveal-on-scroll flex flex-col" style={{ '--reveal-delay': '120ms' } as CSSProperties}>
            {[
              { value: locale === 'zh' ? '开源' : 'Open', label: { en: 'Source on GitHub', zh: '源码在 GitHub' } },
              { value: locale === 'zh' ? '免费' : 'Free', label: { en: 'For everyone', zh: '对所有人' } },
              { value: locale === 'zh' ? '联邦' : 'Federated', label: { en: 'Run your own node', zh: '自建注册节点' } },
            ].map((item) => (
              <div key={item.value} className="flex items-baseline justify-between gap-6 border-t border-white/10 py-5 first:border-t-0 first:pt-0">
                <div className="text-3xl font-semibold tracking-tight text-[var(--text-strong)]">{item.value}</div>
                <div className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">{label(item.label, locale)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="onboarding" className="home-panel site-section immersive-section py-24 lg:py-32">
        <div className="site-container">
          <div className="reveal-on-scroll mb-10">
            <span className="mono-kicker">{locale === 'zh' ? '接入' : 'Onboarding'}</span>
          </div>
          <div className="reveal-on-scroll">
            <OnboardingScenePanel locale={locale} />
          </div>
        </div>
      </section>

      <section id="paths" className="home-panel site-section immersive-section py-24 lg:py-32">
        <div className="section-bg" style={{ backgroundImage: 'url(/images/closing-ambient.png)', opacity: 0.45 }} aria-hidden="true" />
        <div className="section-veil" aria-hidden="true" />
        <div className="site-container">
          <div className="reveal-on-scroll flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mono-kicker">{locale === 'zh' ? '下一步阅读' : 'Where to go next'}</div>
              <h2 className="giant-heading mt-4 max-w-3xl font-semibold leading-tight">{locale === 'zh' ? '按你的身份选择入口。' : 'Choose the path that matches your role.'}</h2>
            </div>
            <Link to={localizePath('/docs')} className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ocp-cyan)]">
              {locale === 'zh' ? '完整文档入口' : 'Full docs entry'}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-14 border-y border-white/10">
            {builderPaths.map((path, index) => {
              return (
                <Link
                  key={path.href}
                  to={localizePath(path.href)}
                  className="reveal-on-scroll group grid gap-5 border-b border-white/10 px-6 py-8 transition-colors last:border-b-0 hover:border-white/20 hover:bg-white/[0.045] focus-visible:border-[var(--ocp-cyan)]/60 focus-visible:bg-white/[0.045] focus-visible:outline-none sm:px-8 lg:px-10 md:grid-cols-[5.5rem_minmax(0,1fr)_9rem] md:items-center"
                  style={{ '--reveal-delay': `${index * 80}ms` } as CSSProperties}
                >
                  <div className="font-mono text-4xl font-semibold tabular-nums text-white/18">
                    {String(index + 1).padStart(2, '0')}
                  </div>
                  <div>
                    <h3 className="text-2xl font-semibold tracking-tight text-white">{label(path.title, locale)}</h3>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">{label(path.body, locale)}</p>
                  </div>
                  <span className="inline-flex min-w-[7rem] items-center justify-between justify-self-start font-mono text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)] transition-colors group-hover:text-[var(--ocp-cyan)] md:justify-self-end">
                    {locale === 'zh' ? '进入' : 'Enter'} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {latestUpdate && (
        <section className="home-panel site-section immersive-section border-t border-white/10 py-20 lg:py-24">
          <div className="site-container reveal-on-scroll grid gap-8 border-y border-white/10 py-8 lg:grid-cols-[14rem_1fr_auto] lg:items-center">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--ocp-gold)]">
              {locale === 'zh' ? '现场笔记' : 'Field note'}
            </div>
            <div>
              <h2 className="max-w-3xl text-3xl font-semibold tracking-tight text-white">{label(latestUpdate.title, locale)}</h2>
              <p className="mt-3 max-w-2xl text-[var(--text-muted)]">{label(latestUpdate.summary, locale)}</p>
            </div>
            <Link to={localizePath(`/updates/${latestUpdate.slug}`)} className="inline-flex items-center justify-center gap-2 border border-white/20 px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-white/40 hover:bg-white/[0.06]">
              {locale === 'zh' ? '查看详情' : 'Read more'}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      )}
      </div>
    </main>
  );
}
