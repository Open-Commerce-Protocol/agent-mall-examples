import { describe, expect, test } from 'bun:test';
import { formatCompactCount, formatFullCount } from './formatScale';

describe('formatCompactCount', () => {
  test('returns plain number below 1000', () => {
    expect(formatCompactCount(0)).toBe('0');
    expect(formatCompactCount(42)).toBe('42');
    expect(formatCompactCount(999)).toBe('999');
  });

  test('formats thousands with K', () => {
    expect(formatCompactCount(1000)).toBe('1K');
    expect(formatCompactCount(9500)).toBe('9.5K');
    expect(formatCompactCount(12_300)).toBe('12.3K');
  });

  test('formats millions with M', () => {
    expect(formatCompactCount(1_000_000)).toBe('1M');
    expect(formatCompactCount(12_480_000)).toBe('12.5M');
    expect(formatCompactCount(999_000_000)).toBe('999M');
  });

  test('formats billions with B', () => {
    expect(formatCompactCount(1_000_000_000)).toBe('1B');
    expect(formatCompactCount(2_500_000_000)).toBe('2.5B');
  });

  test('drops trailing .0', () => {
    expect(formatCompactCount(2_000_000)).toBe('2M');
  });

  test('guards against negatives and non-finite', () => {
    expect(formatCompactCount(-5)).toBe('0');
    expect(formatCompactCount(Number.NaN)).toBe('0');
  });
});

describe('formatFullCount', () => {
  test('groups the full number with separators', () => {
    expect(formatFullCount(12_008_514)).toBe('12,008,514');
    expect(formatFullCount(1000)).toBe('1,000');
    expect(formatFullCount(42)).toBe('42');
  });

  test('guards against negatives and non-finite', () => {
    expect(formatFullCount(0)).toBe('0');
    expect(formatFullCount(-5)).toBe('0');
    expect(formatFullCount(Number.NaN)).toBe('0');
  });
});
