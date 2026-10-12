import { ShieldCheck, Sparkles } from 'lucide-react';
import type { CatalogWithSources } from '../../lib/useDirectory';
import type { DocsLocale } from '../../content/i18n';

type Props = {
  catalog: CatalogWithSources;
  locale: DocsLocale;
  onOpen: (catalogId: string) => void;
};

const TRUST_ORDER = ['none', 'declared', 'verified_domain', 'authority'] as const;

function trustIndex(tier: string | undefined) {
  // Treat the legacy spec name `claimed` as equivalent to the implementation's `declared`.
  const normalized = tier === 'claimed' ? 'declared' : tier ?? 'none';
  const i = TRUST_ORDER.indexOf(normalized as (typeof TRUST_ORDER)[number]);
  return i < 0 ? 0 : i;
}

function trustLabel(tier: string | undefined, locale: DocsLocale) {
  switch (tier) {
    case 'authority':
      return locale === 'zh' ? '权威' : 'authority';
    case 'verified_domain':
      return locale === 'zh' ? '域已验证' : 'verified domain';
    case 'declared':
    case 'claimed':
      return locale === 'zh' ? '已声明' : 'declared';
    default:
      return locale === 'zh' ? '未验证' : 'unverified';
  }
}

function healthTone(status: string | undefined) {
  if (status === 'healthy') return 'var(--ocp-green)';
  if (status === 'degraded') return 'var(--ocp-gold)';
  if (status === 'unhealthy' || status === 'stale') return 'var(--ocp-vermilion)';
  return 'var(--border-soft)';
}

export function CatalogCard({ catalog, locale, onOpen }: Props) {
  const trust = trustIndex(catalog.trust_tier);
  const isVerified = catalog.verification_status === 'verified';
  const isNotRequired = catalog.verification_status === 'not_required';
  const queryPacks = catalog.supported_query_packs?.slice(0, 3) ?? [];
  const queryModes = catalog.supported_query_modes?.slice(0, 3) ?? [];

  return (
    <button
      type="button"
      onClick={() => onOpen(catalog.catalog_id)}
      className="catalog-card group block w-full text-left"
    >
      <div className="catalog-card-frame">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                {catalog.catalog_id}
              </span>
              {isVerified && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-full bg-[var(--ocp-cyan)]/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--ocp-cyan)]"
                  title="verified"
                >
                  <ShieldCheck className="h-2.5 w-2.5" />
                  verified
                </span>
              )}
              {isNotRequired && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-full bg-[var(--surface-1)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--text-faint)]"
                  title="verification not required by this registry"
                >
                  no-check
                </span>
              )}
            </div>
            <h3 className="mt-1 truncate text-base font-semibold text-[var(--ocp-ink)]">
              {catalog.catalog_name ?? catalog.catalog_id}
            </h3>
          </div>
          <span
            className="catalog-health-dot"
            style={{ background: healthTone(catalog.health_status) }}
            title={catalog.health_status ?? 'unknown'}
          />
        </header>

        <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--text-muted)]">
          {catalog.description ?? (locale === 'zh' ? '（暂无描述）' : '(no description)')}
        </p>

        <div className="mt-3 space-y-2 border-t border-[var(--border-soft)] pt-3 text-[11px]">
          <Row label={locale === 'zh' ? 'modes' : 'modes'}>
            {queryModes.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {queryModes.map((mode) => (
                  <code key={mode} className="rounded bg-[var(--surface-1)] px-1.5 py-0.5 text-[10px] text-[var(--text-strong)]">
                    {mode}
                  </code>
                ))}
              </div>
            ) : (
              <span className="text-[var(--text-faint)]">—</span>
            )}
          </Row>

          <Row label={locale === 'zh' ? 'packs' : 'packs'}>
            {queryPacks.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {queryPacks.map((pack) => (
                  <code key={pack} className="truncate rounded bg-[var(--surface-1)] px-1.5 py-0.5 text-[10px] text-[var(--text-strong)]">
                    {pack}
                  </code>
                ))}
              </div>
            ) : (
              <span className="text-[var(--text-faint)]">—</span>
            )}
          </Row>

          <Row label={locale === 'zh' ? 'trust' : 'trust'}>
            <div className="flex items-center gap-1.5">
              <div className="flex gap-0.5">
                {TRUST_ORDER.map((_, i) => (
                  <span
                    key={i}
                    className="catalog-trust-cell"
                    style={{ background: i <= trust ? 'var(--ocp-cyan)' : 'var(--border-soft)' }}
                  />
                ))}
              </div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                {trustLabel(catalog.trust_tier, locale)}
              </span>
            </div>
          </Row>
        </div>

        <footer className="mt-3 flex items-center justify-between border-t border-[var(--border-soft)] pt-2 text-[10px] text-[var(--text-faint)]">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-[var(--ocp-gold)]" />
            <span className="font-mono uppercase tracking-wider">
              {catalog._source_registries.length}{' '}
              {locale === 'zh' ? '注册节点' : catalog._source_registries.length === 1 ? 'registry' : 'registries'}
            </span>
          </div>
          {typeof catalog.score === 'number' && (
            <span className="font-mono tabular-nums text-[var(--text-faint)]">score {catalog.score.toFixed(2)}</span>
          )}
        </footer>
      </div>
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-12 shrink-0 font-mono uppercase tracking-wider text-[var(--text-faint)]">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
