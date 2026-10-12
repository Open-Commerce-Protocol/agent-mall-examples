import { useEffect, useState } from 'react';

export type CatalogManifestEndpoint = {
  url?: string;
  method?: string;
};

export type CatalogQueryPack = {
  pack_id?: string;
  description?: string;
  query_modes?: string[];
};

export type CatalogQueryCapability = {
  capability_id?: string;
  name?: string;
  description?: string;
  query_packs?: CatalogQueryPack[];
  supports_explain?: boolean;
  supports_resolve?: boolean;
  metadata?: Record<string, unknown>;
};

export type CatalogDataProfile = {
  catalog_entry_count?: number;
  object_counts?: Array<{
    object_type?: string;
    count?: number;
  }>;
  counted_at?: string;
};

export type CatalogManifest = {
  ocp_version?: string;
  kind?: string;
  id?: string;
  catalog_id?: string;
  catalog_name?: string;
  description?: string;
  registry_visibility?: string;
  endpoints?: Record<string, CatalogManifestEndpoint>;
  query_capabilities?: CatalogQueryCapability[];
  data_profile?: CatalogDataProfile;
  object_contracts?: unknown[];
  auth_requirements?: Record<string, unknown>;
  [key: string]: unknown;
};

export type CatalogManifestStatus = 'idle' | 'loading' | 'ready' | 'error';

export type ManifestFetchEntry =
  | { status: 'ready'; manifest: CatalogManifest }
  | { status: 'error'; error: string };

const cache = new Map<string, ManifestFetchEntry>();
const inflight = new Map<string, Promise<ManifestFetchEntry>>();

export function fetchManifestOnce(url: string): Promise<ManifestFetchEntry> {
  const cached = cache.get(url);
  if (cached) return Promise.resolve(cached);
  const existing = inflight.get(url);
  if (existing) return existing;

  const promise = fetch(url, { headers: { accept: 'application/json' } })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = (await response.json()) as CatalogManifest;
      const entry: ManifestFetchEntry = { status: 'ready', manifest: json };
      cache.set(url, entry);
      return entry;
    })
    .catch((err): ManifestFetchEntry => {
      const entry: ManifestFetchEntry = {
        status: 'error',
        error: err instanceof Error ? err.message : 'fetch failed',
      };
      cache.set(url, entry);
      return entry;
    })
    .finally(() => {
      inflight.delete(url);
    });

  inflight.set(url, promise);
  return promise;
}

export type UseCatalogManifestResult = {
  status: CatalogManifestStatus;
  manifest: CatalogManifest | null;
  error: string | null;
};

export function useCatalogManifest(manifestUrl: string | null | undefined): UseCatalogManifestResult {
  // bumpKey forces re-render once the cache entry is populated by the effect.
  const [, bump] = useState(0);

  useEffect(() => {
    if (!manifestUrl) return;
    if (cache.has(manifestUrl)) return;
    let cancelled = false;
    void fetchManifestOnce(manifestUrl).then(() => {
      if (!cancelled) bump((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [manifestUrl]);

  if (!manifestUrl) return { status: 'idle', manifest: null, error: null };
  const entry = cache.get(manifestUrl);
  if (!entry) return { status: 'loading', manifest: null, error: null };
  if (entry.status === 'error') return { status: 'error', manifest: null, error: entry.error };
  return { status: 'ready', manifest: entry.manifest, error: null };
}

/**
 * Build a minimal example query body that demonstrates how to call the
 * catalog's /ocp/query endpoint, based on the first declared query pack.
 */
export function buildSampleQueryBody(manifest: CatalogManifest | null): Record<string, unknown> | null {
  if (!manifest) return null;
  const cap = manifest.query_capabilities?.[0];
  const pack = cap?.query_packs?.[0];
  if (!cap || !pack) return null;
  const mode = pack.query_modes?.[0] ?? 'keyword';
  return {
    ocp_version: '1.0',
    kind: 'CatalogQueryRequest',
    catalog_id: manifest.catalog_id,
    query: {
      mode,
      query_pack: pack.pack_id,
      text: 'wireless headphones',
    },
    limit: 10,
  };
}
