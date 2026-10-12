import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, Boxes, Milestone } from 'lucide-react';
import { useDocsLocale } from '../content/i18n';
import { DirectoryExplorer } from '../components/directory/DirectoryExplorer';
import { PageTheme } from '../theme/ThemeContext';

export function ProductOcpCatalogPage() {
  const { locale, localizePath } = useDocsLocale();

  return (
    <main className="bg-[var(--ocp-paper)]">
      <PageTheme theme="dark" />
      <section className="relative isolate overflow-hidden border-b border-[var(--border-soft)] site-band">
        <div className="site-section">
          <div className="site-container">
            <Link
              to={localizePath('/products')}
              className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--text-strong)]"
            >
              <ArrowLeft className="h-4 w-4" />
              {locale === 'zh' ? '产品' : 'Products'}
            </Link>
            <div className="mt-6 max-w-3xl">
              <div className="section-kicker inline-flex items-center gap-2">
                <Boxes className="h-3.5 w-3.5 text-[var(--ocp-cyan)]" />
                {locale === 'zh' ? '核心协议' : 'Core protocol'}
              </div>
              <h1 className="mt-4 text-5xl font-semibold leading-tight sm:text-6xl">OCP Catalog</h1>
              <p className="mt-5 text-lg leading-8 text-[var(--text-muted)]">
                {locale === 'zh'
                  ? 'OCP Catalog 把商品、服务和可执行动作变成开放的协议对象：Agent 可以发现、查询、解析它们，并在用户确认后继续到商家的真实交易入口。下面是当前网络的实时拓扑。'
                  : 'OCP Catalog turns products, services, and action entry points into open protocol objects: agents discover, query, and resolve them, then continue to merchant-owned execution after user confirmation. Below is the live topology of the network today.'}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  to={localizePath('/docs')}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--ocp-ink)] px-5 py-3 text-sm font-semibold text-[var(--ocp-paper)] transition-transform hover:-translate-y-0.5"
                >
                  <BookOpen className="h-4 w-4" />
                  {locale === 'zh' ? '阅读协议文档' : 'Read the protocol docs'}
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  to={localizePath('/roadmap')}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] px-5 py-3 text-sm font-semibold text-[var(--text-strong)] transition-colors hover:bg-[var(--surface-glass)]"
                >
                  <Milestone className="h-4 w-4" />
                  {locale === 'zh' ? '查看路线图' : 'View the roadmap'}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <DirectoryExplorer showHeader={false} />
    </main>
  );
}
