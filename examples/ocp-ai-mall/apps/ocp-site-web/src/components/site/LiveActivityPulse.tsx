import { useMemo } from 'react';
import { Activity, Radio } from 'lucide-react';
import { useLiveActivity, type LiveActivityStatus } from '../../lib/useLiveActivity';
import { useDocsLocale } from '../../content/i18n';

const familyTone: Record<string, string> = {
  ocp: 'var(--ocp-cyan)',
  webmcp: 'var(--ocp-green)',
  agent_card: 'var(--ocp-gold)',
  feed: 'var(--ocp-vermilion)',
};

function relativeTime(value: string, locale: 'en' | 'zh') {
  const diff = Date.now() - new Date(value).getTime();
  const sec = Math.max(1, Math.floor(diff / 1000));
  if (sec < 60) return locale === 'zh' ? `${sec} 秒前` : `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return locale === 'zh' ? `${min} 分钟前` : `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return locale === 'zh' ? `${hr} 小时前` : `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return locale === 'zh' ? `${day} 天前` : `${day}d ago`;
}

function statusBadge(status: LiveActivityStatus, locale: 'en' | 'zh') {
  if (status === 'loading') return locale === 'zh' ? '连接中' : 'connecting';
  if (status === 'error') return locale === 'zh' ? '离线' : 'offline';
  return locale === 'zh' ? '实时' : 'live';
}

function statusDotColor(status: LiveActivityStatus) {
  if (status === 'ready') return 'var(--ocp-green)';
  if (status === 'error') return 'var(--ocp-vermilion)';
  return 'var(--ocp-gold)';
}

export function LiveActivityPulse() {
  const { locale } = useDocsLocale();
  const { events, rollups, status } = useLiveActivity({ limit: 6, windowHours: 24, pollMs: 12_000 });

  const familyBars = useMemo(() => {
    const entries = Object.entries(rollups?.by_protocol_family ?? {});
    if (entries.length === 0) return [];
    const max = Math.max(...entries.map(([, v]) => v));
    return entries
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, value]) => ({
        name,
        value,
        ratio: max > 0 ? value / max : 0,
        color: familyTone[name] ?? 'var(--ocp-ink)',
      }));
  }, [rollups]);

  const recent = events.slice(0, 2);

  return (
    <div className="hero-orbit-card hero-parallax-fast reveal-item relative mb-10 w-80 overflow-hidden rounded-md border border-[var(--border-soft)] bg-[var(--surface-glass)] p-5 shadow-2xl shadow-black/16 backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
          <Radio className="h-4 w-4 text-[var(--ocp-cyan)]" />
          {locale === 'zh' ? '协议实时脉冲' : 'Protocol live pulse'}
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-glass)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: statusDotColor(status),
              boxShadow: status === 'ready' ? `0 0 0 4px ${statusDotColor(status)}22` : undefined,
            }}
          />
          {statusBadge(status, locale)}
        </span>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="font-mono text-3xl font-semibold tabular-nums text-[var(--ocp-ink)]">
          {rollups?.event_count ?? (status === 'error' ? '–' : '…')}
        </span>
        <span className="text-xs font-semibold uppercase text-[var(--text-faint)]">
          {locale === 'zh' ? `24 小时事件` : '24h events'}
        </span>
      </div>

      <div className="mt-4 space-y-2">
        {familyBars.length > 0 ? (
          familyBars.map((bar) => (
            <div key={bar.name} className="text-xs">
              <div className="flex items-center justify-between text-[var(--text-muted)]">
                <span className="font-semibold uppercase tracking-wide">{bar.name}</span>
                <span className="font-mono tabular-nums">{bar.value}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded bg-[var(--surface-1)]">
                <div
                  className="h-full transition-all duration-700"
                  style={{ width: `${Math.max(6, bar.ratio * 100)}%`, background: bar.color }}
                />
              </div>
            </div>
          ))
        ) : (
          <p className="text-xs text-[var(--text-faint)]">
            {status === 'error'
              ? locale === 'zh'
                ? 'Activity API 离线。'
                : 'Activity API offline.'
              : locale === 'zh'
                ? '等待事件…'
                : 'Waiting for events…'}
          </p>
        )}
      </div>

      {recent.length > 0 && (
        <div className="mt-4 border-t border-[var(--border-soft)] pt-3">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
            <Activity className="h-3 w-3" />
            {locale === 'zh' ? '最近事件' : 'Recent'}
          </div>
          <ul className="space-y-1.5">
            {recent.map((event) => (
              <li key={event.public_event_id} className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: familyTone[event.protocol_family] ?? 'var(--ocp-ink)' }}
                />
                <span className="min-w-0 flex-1 truncate font-medium text-[var(--text-muted)]">{event.event_type}</span>
                <span className="shrink-0 font-mono tabular-nums text-[var(--text-faint)]">
                  {relativeTime(event.occurred_at, locale)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
