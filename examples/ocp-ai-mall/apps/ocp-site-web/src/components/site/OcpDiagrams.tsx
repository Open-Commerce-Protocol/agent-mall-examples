import { ArrowRight, DatabaseZap, FileCheck2, GitBranch, LockKeyhole, Search, Waypoints } from 'lucide-react';
import { resolveLocalizedText, type DocsLocale, type LocalizedText } from '../../content/i18n';

type DiagramNode = {
  title: LocalizedText;
  body: LocalizedText;
  tone: 'cyan' | 'gold' | 'green' | 'vermilion' | 'ink';
};

const architectureNodes: DiagramNode[] = [
  {
    title: { en: 'Merchant source', zh: '商家数据源' },
    body: { en: 'The place where products, prices, and inventory already live.', zh: '商品、价格和库存原本所在的系统。' },
    tone: 'ink',
  },
  {
    title: { en: 'Provider app', zh: '接入应用' },
    body: { en: 'Translates merchant data into OCP-ready commerce objects.', zh: '把商家数据翻译成 OCP 可识别的商业对象。' },
    tone: 'green',
  },
  {
    title: { en: 'Catalog node', zh: 'Catalog 索引' },
    body: { en: 'Makes objects searchable and returns a safe way to inspect them.', zh: '让对象可以被查找，并提供安全查看方式。' },
    tone: 'cyan',
  },
  {
    title: { en: 'Discovery network', zh: '发现网络' },
    body: { en: 'Helps agents find the right catalogs for a request.', zh: '帮助 Agent 找到适合当前请求的 Catalog。' },
    tone: 'gold',
  },
  {
    title: { en: 'User agent', zh: '用户 Agent' },
    body: { en: 'Compares options and asks the user before any action.', zh: '比较选项，并在任何动作前请求用户确认。' },
    tone: 'vermilion',
  },
];

const actionSteps: DiagramNode[] = [
  {
    title: { en: 'Search', zh: 'Search' },
    body: { en: 'Find relevant options across participating catalogs.', zh: '在已接入的 Catalog 中找到相关选项。' },
    tone: 'cyan',
  },
  {
    title: { en: 'Resolve', zh: 'Resolve' },
    body: { en: 'Open the selected option with the details the user needs.', zh: '展开被选中的对象，让用户看到决策所需信息。' },
    tone: 'gold',
  },
  {
    title: { en: 'Action binding', zh: 'Action binding' },
    body: { en: 'Continue to checkout, quote, booking, or another merchant action.', zh: '继续到结账、报价、预订或其他商家动作。' },
    tone: 'vermilion',
  },
];

const trustSteps: DiagramNode[] = [
  {
    title: { en: 'Capability', zh: '能力声明' },
    body: { en: 'What this catalog can offer.', zh: '说明这个 Catalog 能提供什么。' },
    tone: 'gold',
  },
  {
    title: { en: 'Object shape', zh: '对象形状' },
    body: { en: 'How results are described.', zh: '说明结果如何被描述。' },
    tone: 'cyan',
  },
  {
    title: { en: 'Verification', zh: 'Verification' },
    body: { en: 'Keeps sources fresh and trustworthy.', zh: '保持来源新鲜且可信。' },
    tone: 'green',
  },
  {
    title: { en: 'Permission', zh: '用户确认' },
    body: { en: 'No action runs silently.', zh: '任何动作都不会静默执行。' },
    tone: 'vermilion',
  },
];

const toneClasses: Record<DiagramNode['tone'], string> = {
  cyan: 'border-[rgba(46,230,224,0.44)] text-[var(--ocp-cyan)]',
  gold: 'border-[rgba(197,154,50,0.42)] text-[var(--ocp-gold)]',
  green: 'border-[rgba(46,125,87,0.48)] text-[#7fd6a6]',
  vermilion: 'border-[rgba(217,84,54,0.48)] text-[#ff8a70]',
  ink: 'border-white/18 text-white',
};

function text(value: LocalizedText, locale: DocsLocale) {
  return resolveLocalizedText(value, locale);
}

function DiagramCard({ node, locale }: { node: DiagramNode; locale: DocsLocale }) {
  return (
    <div className={`h-full border-t pt-5 ${toneClasses[node.tone]}`}>
      <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] opacity-80">
        {node.tone}
      </div>
      <div className="mt-4 text-lg font-semibold text-white">{text(node.title, locale)}</div>
      <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">{text(node.body, locale)}</p>
    </div>
  );
}

export function CatalogArchitectureDiagram({ locale }: { locale: DocsLocale }) {
  return (
    <div className="border-y border-white/10 py-8">
      <div className="mb-8 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-white/48">
        <Waypoints className="h-4 w-4 text-[var(--ocp-cyan)]" />
        {locale === 'zh' ? '从商家到用户的完整路径' : 'From merchant data to user action'}
      </div>
      <div className="flex flex-col gap-8 lg:flex-row lg:items-stretch">
        {architectureNodes.map((node, index) => (
          <div key={node.title.en} className="flex min-w-0 flex-1 gap-5">
            <div className="min-w-0 flex-1">
              <DiagramCard node={node} locale={locale} />
            </div>
            {index < architectureNodes.length - 1 && (
              <div className="hidden items-start justify-center pt-7 text-white/24 lg:flex">
                <ArrowRight className="h-5 w-5" />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-10 grid gap-8 border-t border-white/10 pt-8 sm:grid-cols-3">
        <div className="flex items-start gap-3 text-sm leading-6 text-[var(--text-muted)]">
          <FileCheck2 className="mt-0.5 h-4 w-4 flex-none text-[var(--ocp-gold)]" />
          {locale === 'zh' ? '商家只公开可被发现的能力，不需要暴露私有系统。' : 'Merchants expose discoverable capabilities without exposing private systems.'}
        </div>
        <div className="flex items-start gap-3 text-sm leading-6 text-[var(--text-muted)]">
          <DatabaseZap className="mt-0.5 h-4 w-4 flex-none text-[var(--ocp-cyan)]" />
          {locale === 'zh' ? 'Catalog 负责搜索和详情查看，不接管交易履约。' : 'Catalogs handle search and detail lookup without taking over fulfillment.'}
        </div>
        <div className="flex items-start gap-3 text-sm leading-6 text-[var(--text-muted)]">
          <LockKeyhole className="mt-0.5 h-4 w-4 flex-none text-[var(--ocp-vermilion)]" />
          {locale === 'zh' ? '购买、预约、报价等动作仍回到商家确认后的执行入口。' : 'Checkout, booking, and quote actions continue through merchant-owned entry points.'}
        </div>
      </div>
    </div>
  );
}

export function SearchResolveActionDiagram({ locale }: { locale: DocsLocale }) {
  return (
    <div className="border-b border-white/10 pb-8 text-[var(--text-strong)]">
      <div className="mb-6 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-white/48">
        <Search className="h-4 w-4 text-[var(--ocp-cyan)]" />
        {locale === 'zh' ? '从发现到行动，分三步保持可控' : 'Three steps from discovery to action'}
      </div>
      <div className="grid gap-8 md:grid-cols-3">
        {actionSteps.map((step, index) => (
          <div key={step.title.en} className="relative border-t border-white/12 pt-5">
            <div className="font-mono text-4xl font-semibold tabular-nums text-white/16">
              {String(index + 1).padStart(2, '0')}
            </div>
            <div className="mt-4 text-2xl font-semibold">{text(step.title, locale)}</div>
            <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">{text(step.body, locale)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TrustBoundaryDiagram({ locale }: { locale: DocsLocale }) {
  return (
    <div className="border-b border-white/10 pb-8">
      <div className="mb-6 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-white/48">
        <GitBranch className="h-4 w-4 text-[var(--ocp-green)]" />
        {locale === 'zh' ? '关键安全边界' : 'Key safety boundaries'}
      </div>
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {trustSteps.map((step) => (
          <DiagramCard key={step.title.en} node={step} locale={locale} />
        ))}
      </div>
    </div>
  );
}

export function OnboardingScenePanel({ locale }: { locale: DocsLocale }) {
  return (
    <div className="grid gap-10 border-y border-white/10 py-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
      <img
        src="/images/site/provider-onboarding-scene.png"
        alt=""
        className="aspect-[16/9] w-full object-cover opacity-90 shadow-2xl shadow-black/30"
      />
      <div>
        <div className="mono-kicker">{locale === 'zh' ? '商家如何接入' : 'How merchants connect'}</div>
        <h2 className="mt-4 text-[clamp(2rem,4vw,4rem)] font-semibold leading-[1.04] tracking-[-0.02em]">
          {locale === 'zh' ? '已有商品系统可以接入 OCP，而不是推倒重建。' : 'Existing commerce systems can join OCP without being rebuilt.'}
        </h2>
        <p className="mt-5 text-lg leading-8 text-[var(--text-muted)]">
          {locale === 'zh'
            ? '接入应用负责翻译商品数据，Catalog 负责让它们可被查找，发现网络负责让 Agent 找到正确入口。每一层都可以独立演进。'
            : 'Connector apps translate commerce data, Catalogs make it searchable, and the discovery network helps agents find the right entry point. Each layer can evolve independently.'}
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-sm text-white/55">
          {['Provider', 'Catalog', 'Registration', 'Action'].map((item, index) => (
            <span key={item} className="inline-flex items-center gap-2">
              {index > 0 && <span className="text-[var(--ocp-cyan)]">.</span>}
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
