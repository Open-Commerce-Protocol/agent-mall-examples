import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Braces, Compass, FileCode2, Route, Terminal } from 'lucide-react';
import { navigation } from '../content/navigation';
import { resolveLocalizedText, useDocsLocale } from '../content/i18n';

const entryCards = [
  {
    icon: Compass,
    href: '/docs/overview',
    title: { en: '5 minute overview', zh: '5 分钟总览' },
    body: { en: 'Understand roles, object flow, and the Search / Resolve / Action split.', zh: '理解角色、对象流转，以及 Search / Resolve / Action 的分层。' },
  },
  {
    icon: FileCode2,
    href: '/docs/examples/minimal-catalog',
    title: { en: 'Minimal catalog', zh: '最小 Catalog' },
    body: { en: 'Build the smallest catalog shape that can publish searchable commercial entries.', zh: '构建能够发布可搜索商业对象的最小 Catalog。' },
  },
  {
    icon: Route,
    href: '/docs/protocols/registration-v1/discovery',
    title: { en: 'Registration discovery', zh: '注册发现' },
    body: { en: 'Learn how agents find catalogs and route into the right protocol surface.', zh: '了解 Agent 如何发现 Catalog 并路由到正确协议面。' },
  },
  {
    icon: Braces,
    href: '/docs/protocols/handshake-v1/catalog-manifest',
    title: { en: 'Schema reference', zh: 'Schema 参考' },
    body: { en: 'Inspect schema-backed pages with endpoint examples and implementation references.', zh: '查看带 schema、接口示例和实现引用的页面。' },
  },
  {
    icon: Terminal,
    href: '/docs/cli-and-skill',
    title: { en: 'CLI & Skill', zh: 'CLI 与 Skill' },
    body: { en: 'Drive the OCP workflow from the CLI and agent skill, with manifest-based request validation.', zh: '用 CLI 和 Agent skill 驱动 OCP 工作流，并带 manifest 请求校验。' },
  },
];

export function DocsLandingPage() {
  const { locale, localizePath } = useDocsLocale();

  return (
    <main className="site-band">
      <section className="site-section">
        <div className="site-container">
          <div className="grid gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-end">
            <div>
              <div className="section-kicker">{locale === 'zh' ? '协议文档' : 'Protocol docs'}</div>
              <h1 className="mt-4 text-5xl font-semibold leading-tight">{locale === 'zh' ? '按任务进入，而不是按文件迷路。' : 'Task-led docs for the protocol surface.'}</h1>
              <p className="mt-5 text-lg leading-8 text-black/65">
                {locale === 'zh'
                  ? '从概念、接入示例、协议契约到 schema 参考，都可以按当前任务直接进入。'
                  : 'Move directly from concepts to integration examples, protocol contracts, and schema references based on the task at hand.'}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {entryCards.map((card) => {
                const Icon = card.icon;
                return (
                  <Link key={card.href} to={localizePath(card.href)} className="rounded-md border border-black/10 bg-white p-5 shadow-sm transition-transform hover:-translate-y-1">
                    <Icon className="h-6 w-6 text-[var(--ocp-cyan)]" />
                    <h2 className="mt-5 text-lg font-semibold">{resolveLocalizedText(card.title, locale)}</h2>
                    <p className="mt-3 text-sm leading-6 text-black/62">{resolveLocalizedText(card.body, locale)}</p>
                    <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold">
                      {locale === 'zh' ? '打开' : 'Open'}
                      <ArrowRight className="h-4 w-4" />
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="site-section border-t border-black/10 bg-white">
        <div className="site-container">
          <div className="mb-8 flex items-center gap-3">
            <BookOpen className="h-6 w-6 text-[var(--ocp-vermilion)]" />
            <h2 className="text-3xl font-semibold">{locale === 'zh' ? '文档地图' : 'Documentation map'}</h2>
          </div>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {navigation.map((group) => (
              <section key={group.title.en} className="rounded-md border border-black/10 bg-[var(--ocp-paper)] p-5">
                <h3 className="font-semibold">{resolveLocalizedText(group.title, locale)}</h3>
                <ul className="mt-4 space-y-2">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link to={localizePath(link.href)} className="inline-flex items-start gap-2 text-sm text-black/66 hover:text-black">
                        <ArrowRight className="mt-0.5 h-3.5 w-3.5 flex-none text-[var(--ocp-cyan)]" />
                        {resolveLocalizedText(link.title, locale)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
