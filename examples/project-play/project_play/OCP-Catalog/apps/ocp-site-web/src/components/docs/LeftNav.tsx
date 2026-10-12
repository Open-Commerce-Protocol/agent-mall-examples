import { NavLink } from 'react-router-dom';
import { navigation } from '../../content/navigation';
import { resolveLocalizedText, useDocsLocale } from '../../content/i18n';

export function LeftNav() {
  const { locale, localizePath } = useDocsLocale();

  return (
    <nav className="space-y-7">
      {navigation.map((group, idx) => (
        <div key={idx} className="pb-2">
          <h4 className="mb-3 inline-block border-b-2 border-[var(--ocp-cyan)] px-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ocp-ink)]">
            {resolveLocalizedText(group.title, locale)}
          </h4>
          <ul className="space-y-1 pl-1">
            {group.links.map((link, j) => (
              <li key={j}>
                <NavLink
                  to={localizePath(link.href)}
                  className={({ isActive }) =>
                    `block rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-200
                    ${isActive
                      ? 'border-l-2 border-[var(--ocp-vermilion)] bg-[rgba(0,167,165,0.10)] text-[var(--ocp-ink)] shadow-sm'
                      : 'border-l-2 border-transparent text-[rgba(20,20,20,0.66)] hover:bg-black/[0.04] hover:text-[var(--ocp-ink)]'
                    }`
                  }
                >
                  {resolveLocalizedText(link.title, locale)}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
