import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { LeftNav } from './LeftNav';
import { RightToc } from './RightToc';

export type TocHeading = {
  id: string;
  level: number;
  text: string;
};

export function DocsLayout() {
  const [headings, setHeadings] = useState<TocHeading[]>([]);
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="site-band min-h-screen border-t border-black/10">
      <div className="mx-auto flex w-full max-w-[92rem]">
        <aside className="hidden w-72 flex-shrink-0 border-r border-black/10 bg-[rgba(246,247,242,0.76)] md:block">
          <div className="sticky top-20 h-[calc(100vh-5rem)] overflow-y-auto px-4 py-8">
            <LeftNav />
          </div>
        </aside>
        
        <main className="min-w-0 flex-1 bg-white px-4 py-8 shadow-[0_0_0_1px_rgba(20,20,20,0.08)] md:px-12">
          <div className="mx-auto max-w-3xl">
            <Outlet context={{ setHeadings }} />
          </div>
        </main>
        
        <aside className="hidden w-64 flex-shrink-0 xl:block">
          <div className="sticky top-20 h-[calc(100vh-5rem)] overflow-y-auto px-6 py-8">
            <RightToc headings={headings} />
          </div>
        </aside>
      </div>
    </div>
  );
}
