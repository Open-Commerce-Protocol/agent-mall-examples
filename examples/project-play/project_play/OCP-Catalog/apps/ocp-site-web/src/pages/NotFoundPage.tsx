import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useDocsLocale } from '../content/i18n';

export function NotFoundPage() {
  const { locale, localizePath } = useDocsLocale();

  return (
    <main className="site-section">
      <div className="site-container">
        <h1 className="text-5xl font-semibold">{locale === 'zh' ? '页面不存在' : 'Page not found'}</h1>
        <p className="mt-4 max-w-2xl text-black/62">
          {locale === 'zh'
            ? '这个链接没有对应页面。你可以回到首页，或从文档入口和项目进展重新进入。'
            : 'This link does not point to an active page. Start again from the homepage, docs, or project updates.'}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to={localizePath('/')} className="inline-flex items-center gap-2 rounded-md bg-[var(--ocp-ink)] px-5 py-3 text-sm font-semibold text-[var(--ocp-paper)]">
            <ArrowLeft className="h-4 w-4" />
            {locale === 'zh' ? '回到首页' : 'Back home'}
          </Link>
          <Link to={localizePath('/docs')} className="inline-flex items-center rounded-md border border-black/10 bg-white px-5 py-3 text-sm font-semibold">
            {locale === 'zh' ? '打开文档' : 'Open docs'}
          </Link>
        </div>
      </div>
    </main>
  );
}
