import { describe, expect, test } from 'bun:test';
import { aggregateCatalogScale, type ManifestProbe } from './catalogScale';

describe('aggregateCatalogScale', () => {
  test('sums catalog_entry_count for stored catalogs', () => {
    const probes: ManifestProbe[] = [
      { status: 'ready', dataProfileCount: 1000 },
      { status: 'ready', dataProfileCount: 500 },
    ];
    const result = aggregateCatalogScale(probes);
    expect(result.storedTotal).toBe(1500);
    expect(result.storedCatalogCount).toBe(2);
    expect(result.streamedCatalogCount).toBe(0);
  });

  test('treats a zero entry count as a valid stored catalog, not missing', () => {
    const result = aggregateCatalogScale([
      { status: 'ready', dataProfileCount: 0 },
    ]);
    expect(result.storedTotal).toBe(0);
    expect(result.storedCatalogCount).toBe(1);
    expect(result.streamedCatalogCount).toBe(0);
  });

  test('counts manifests without a data profile as streamed', () => {
    const probes: ManifestProbe[] = [
      { status: 'ready', dataProfileCount: 2000 },
      { status: 'ready', dataProfileCount: null },
      { status: 'ready', dataProfileCount: null },
    ];
    const result = aggregateCatalogScale(probes);
    expect(result.storedTotal).toBe(2000);
    expect(result.storedCatalogCount).toBe(1);
    expect(result.streamedCatalogCount).toBe(2);
  });

  test('ignores errored and pending probes in totals', () => {
    const probes: ManifestProbe[] = [
      { status: 'ready', dataProfileCount: 100 },
      { status: 'error', dataProfileCount: null },
      { status: 'pending', dataProfileCount: null },
    ];
    const result = aggregateCatalogScale(probes);
    expect(result.storedTotal).toBe(100);
    expect(result.storedCatalogCount).toBe(1);
    expect(result.streamedCatalogCount).toBe(0);
  });

  test('status is unavailable when no probe ever succeeded', () => {
    expect(aggregateCatalogScale([]).status).toBe('unavailable');
    expect(
      aggregateCatalogScale([{ status: 'error', dataProfileCount: null }]).status,
    ).toBe('unavailable');
  });

  test('status is loading while probes are still pending and none failed-to-empty', () => {
    const result = aggregateCatalogScale([
      { status: 'ready', dataProfileCount: 100 },
      { status: 'pending', dataProfileCount: null },
    ]);
    expect(result.status).toBe('loading');
  });

  test('status is ready when all probes settled and at least one reported a count', () => {
    const result = aggregateCatalogScale([
      { status: 'ready', dataProfileCount: 100 },
      { status: 'error', dataProfileCount: null },
    ]);
    expect(result.status).toBe('ready');
  });

  test('status is unavailable when catalogs are ready but none reported a count', () => {
    // Don't surface a misleading "0" when no catalog exposes catalog_entry_count.
    const result = aggregateCatalogScale([
      { status: 'ready', dataProfileCount: null },
      { status: 'ready', dataProfileCount: null },
    ]);
    expect(result.status).toBe('unavailable');
    expect(result.streamedCatalogCount).toBe(2);
    expect(result.storedCatalogCount).toBe(0);
  });
});
