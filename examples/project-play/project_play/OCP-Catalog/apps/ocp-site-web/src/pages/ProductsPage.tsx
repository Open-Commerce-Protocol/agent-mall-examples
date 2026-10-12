import { useEffect, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Boxes,
  GitFork,
  Plug,
  Server,
  ShoppingBag,
  Sparkles,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { resolveLocalizedText, useDocsLocale } from '../content/i18n';
import { products, productStatusLabels, type Product, type ProductStatus } from '../content/products';
import { PageTheme } from '../theme/ThemeContext';

const GITHUB_URL = 'https://github.com/Open-Commerce-Protocol/OCP-Catalog';

const productIcons: Record<string, LucideIcon> = {
  catalog: Boxes,
  cli: Terminal,
  skill: Sparkles,
  mcp: Server,
  webmcp: Plug,
  shopify: ShoppingBag,
  woocommerce: ShoppingBag,
};

const statusToneClass: Record<ProductStatus, string> = {
  stable: 'product-status-stable',
  'in-progress': 'product-status-in-progress',
  'coming-soon': 'product-status-coming-soon',
};

export function ProductsPage() {
  const { locale, localizePath } = useDocsLocale();

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
    <main className="site-band">
      <PageTheme theme="dark" />
      <section className="site-section">
        <div className="site-container">
          <div className="reveal-on-scroll max-w-3xl">
            <div className="section-kicker">{locale === 'zh' ? '产品矩阵' : 'Product matrix'}</div>
            <h1 className="mt-4 text-5xl font-semibold leading-tight sm:text-6xl">
              {locale === 'zh' ? 'OCP 的全部开放组件。' : 'Every open piece of OCP.'}
            </h1>
            <p className="mt-5 text-lg leading-8 text-[var(--text-muted)]">
              {locale === 'zh'
                ? '从协议本体到 CLI、Agent skill、MCP 服务器和电商连接器——都是开源的，任何人都可以使用。'
                : 'From the protocol itself to a CLI, an agent skill, an MCP server, and commerce connectors — all open source, free for anyone to use.'}
            </p>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-flex items-center gap-2 rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] px-4 py-2 text-sm font-semibold text-[var(--text-strong)] transition-colors hover:bg-[var(--surface-glass)]"
            >
              <GitFork className="h-4 w-4" />
              {locale === 'zh' ? '在 GitHub 上查看源码' : 'Open source on GitHub'}
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {products.map((product, index) => (
              <ProductCard
                key={product.id}
                product={product}
                index={index}
                locale={locale}
                localizePath={localizePath}
              />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function ProductCard({
  product,
  index,
  locale,
  localizePath,
}: {
  product: Product;
  index: number;
  locale: 'en' | 'zh';
  localizePath: (path: string) => string;
}) {
  const Icon = productIcons[product.icon] ?? Boxes;
  const cta = product.external
    ? locale === 'zh'
      ? '查看'
      : 'View'
    : locale === 'zh'
      ? '打开'
      : 'Open';

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-md bg-[var(--ocp-ink)] text-[var(--ocp-paper)]">
          <Icon className="h-5 w-5" />
        </span>
        <span className={`product-status-chip ${statusToneClass[product.status]}`}>
          {resolveLocalizedText(productStatusLabels[product.status], locale)}
        </span>
      </div>
      <h2 className="mt-5 text-xl font-semibold">{resolveLocalizedText(product.name, locale)}</h2>
      <p className="mt-1 text-sm font-semibold text-[var(--ocp-cyan)]">
        {resolveLocalizedText(product.tagline, locale)}
      </p>
      <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
        {resolveLocalizedText(product.description, locale)}
      </p>
      {product.tags && product.tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {product.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] px-2 py-0.5 text-[0.7rem] font-semibold uppercase text-[var(--text-faint)]"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)] group-hover:text-[var(--text-strong)]">
        {cta}
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
      </span>
    </>
  );

  const className =
    'builder-card glass-card reveal-on-scroll group flex flex-col rounded-md p-5';
  const style = { '--reveal-delay': `${index * 70}ms` } as CSSProperties;

  if (product.external) {
    return (
      <a href={product.href} target="_blank" rel="noreferrer" className={className} style={style}>
        {inner}
      </a>
    );
  }

  return (
    <Link to={localizePath(product.href)} className={className} style={style}>
      {inner}
    </Link>
  );
}
