import { Search, X } from 'lucide-react';
import type { DocsLocale } from '../../content/i18n';

export type DirectoryFilterState = {
  query: string;
  registryIds: Set<string>;
  verification: Set<string>;
  trust: Set<string>;
  health: Set<string>;
};

type Props = {
  state: DirectoryFilterState;
  setState: (next: DirectoryFilterState) => void;
  allRegistries: { id: string; label: string }[];
  totalShown: number;
  totalAvailable: number;
  locale: DocsLocale;
};

const VERIFICATION_OPTIONS = ['verified', 'pending', 'not_required', 'unverified'] as const;
const TRUST_OPTIONS = ['authority', 'verified_domain', 'declared', 'none'] as const;
const HEALTH_OPTIONS = ['healthy', 'degraded', 'unhealthy', 'stale', 'unknown'] as const;

function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function DirectoryFilters({
  state,
  setState,
  allRegistries,
  totalShown,
  totalAvailable,
  locale,
}: Props) {
  const hasAny =
    state.query.length > 0 ||
    state.registryIds.size > 0 ||
    state.verification.size > 0 ||
    state.trust.size > 0 ||
    state.health.size > 0;

  return (
    <div className="directory-filters">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-faint)]" />
          <input
            type="search"
            value={state.query}
            onChange={(event) => setState({ ...state, query: event.target.value })}
            placeholder={locale === 'zh' ? '搜索 catalog 名称、描述、标签…' : 'Search catalog name, description, tags…'}
            className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] py-2.5 pl-9 pr-3 text-sm text-[var(--ocp-ink)] outline-none transition-colors placeholder:text-[var(--text-faint)] focus:border-[var(--ocp-cyan)] focus:ring-2 focus:ring-[var(--ocp-cyan)]/20"
          />
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
          <span className="font-mono tabular-nums">
            {totalShown} / {totalAvailable} {locale === 'zh' ? '个 catalog' : 'catalogs'}
          </span>
          {hasAny && (
            <button
              type="button"
              onClick={() =>
                setState({
                  query: '',
                  registryIds: new Set(),
                  verification: new Set(),
                  trust: new Set(),
                  health: new Set(),
                })
              }
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] px-2 py-1 text-[11px] font-semibold text-[var(--text-muted)] hover:bg-[var(--surface-glass)]"
            >
              <X className="h-3 w-3" />
              {locale === 'zh' ? '清除' : 'Clear'}
            </button>
          )}
        </div>
      </div>

      {allRegistries.length > 1 && (
        <FilterRow label={locale === 'zh' ? '来源注册节点' : 'Registry'}>
          {allRegistries.map((reg) => (
            <Chip
              key={reg.id}
              active={state.registryIds.has(reg.id)}
              onClick={() => setState({ ...state, registryIds: toggle(state.registryIds, reg.id) })}
            >
              {reg.label}
            </Chip>
          ))}
        </FilterRow>
      )}

      <FilterRow label={locale === 'zh' ? '验证' : 'Verification'}>
        {VERIFICATION_OPTIONS.map((option) => (
          <Chip
            key={option}
            active={state.verification.has(option)}
            onClick={() => setState({ ...state, verification: toggle(state.verification, option) })}
          >
            {option}
          </Chip>
        ))}
      </FilterRow>

      <FilterRow label={locale === 'zh' ? '信任' : 'Trust'}>
        {TRUST_OPTIONS.map((option) => (
          <Chip
            key={option}
            active={state.trust.has(option)}
            onClick={() => setState({ ...state, trust: toggle(state.trust, option) })}
          >
            {option}
          </Chip>
        ))}
      </FilterRow>

      <FilterRow label={locale === 'zh' ? '健康' : 'Health'}>
        {HEALTH_OPTIONS.map((option) => (
          <Chip
            key={option}
            active={state.health.has(option)}
            onClick={() => setState({ ...state, health: toggle(state.health, option) })}
          >
            {option}
          </Chip>
        ))}
      </FilterRow>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">{label}</span>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`directory-chip ${active ? 'is-active' : ''}`}
    >
      {children}
    </button>
  );
}
