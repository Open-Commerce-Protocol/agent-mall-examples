/**
 * Compact, locale-independent count label: 12_480_000 -> "12.5M".
 * One decimal place, trailing ".0" dropped. Non-finite/negative -> "0".
 */
export function formatCompactCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';

  const units: Array<{ threshold: number; suffix: string }> = [
    { threshold: 1_000_000_000, suffix: 'B' },
    { threshold: 1_000_000, suffix: 'M' },
    { threshold: 1_000, suffix: 'K' },
  ];

  for (const { threshold, suffix } of units) {
    if (value >= threshold) {
      const scaled = value / threshold;
      const rounded = Math.round(scaled * 10) / 10;
      const text = rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1);
      return `${text}${suffix}`;
    }
  }

  return String(Math.round(value));
}

/**
 * Full grouped count: 12008514 -> "12,008,514". Non-finite/negative -> "0".
 */
export function formatFullCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return Math.round(value).toLocaleString('en-US');
}
