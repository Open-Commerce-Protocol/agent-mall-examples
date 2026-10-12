import { useEffect, useMemo, useState } from 'react';
import { knownRegistries, type KnownRegistry } from '../content/directory/registries';

export type RegistrationDiscovery = {
  ocp_version?: string;
  kind?: string;
  registration_id?: string;
  registration_name?: string;
  registration_protocol?: string;
  registration_protocol_version?: string;
  manifest_url?: string;
  catalog_registration_url?: string;
  catalog_search_url?: string;
};

export type CatalogDataProfile = {
  catalog_entry_count?: number;
  object_counts?: Array<{ object_type?: string; count?: number }>;
  counted_at?: string;
};

export type CatalogRouteHintPreview = {
  catalog_id?: string;
  manifest_url?: string;
  query_url?: string;
  resolve_url?: string;
  supported_query_packs?: string[];
  cache_ttl_seconds?: number;
  metadata?: {
    data_profile?: CatalogDataProfile;
    [key: string]: unknown;
  };
};

export type CatalogSearchResultItem = {
  catalog_id: string;
  catalog_name?: string;
  description?: string;
  homepage?: string;
  manifest_url?: string;
  well_known_url?: string;
  supported_query_modes?: string[];
  supported_query_packs?: string[];
  supports_resolve?: boolean;
  tags?: string[];
  domains?: string[];
  verification_status?: string;
  trust_tier?: string;
  health_status?: string;
  score?: number;
  matched_query_packs?: string[];
  route_hint?: CatalogRouteHintPreview;
  explain?: string[];
  [key: string]: unknown;
};

export type RegistryStatus = 'loading' | 'live' | 'unreachable';

export type RegistryRuntime = {
  seed: KnownRegistry;
  status: RegistryStatus;
  discovery: RegistrationDiscovery | null;
  catalogCount: number;
  verifiedCount: number;
  healthyCount: number;
  lastChecked: number | null;
  error?: string;
};

export type CatalogWithSources = CatalogSearchResultItem & {
  _source_registries: string[];
};

export type DirectorySnapshot = {
  registries: RegistryRuntime[];
  catalogs: CatalogWithSources[];
  stats: {
    registriesTotal: number;
    registriesLive: number;
    catalogsTotal: number;
    verifiedCount: number;
    healthyCount: number;
    verifiedRatio: number;
    healthyRatio: number;
  };
  lastUpdated: number | null;
  isLoading: boolean;
};

type Options = {
  pollMs?: number;
  searchLimit?: number;
};

async function fetchDiscovery(endpoint: string): Promise<RegistrationDiscovery> {
  const url = `${endpoint.replace(/\/+$/, '')}/.well-known/ocp-registration`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`discovery ${response.status}`);
  return (await response.json()) as RegistrationDiscovery;
}

async function fetchCatalogs(searchUrl: string, limit: number): Promise<CatalogSearchResultItem[]> {
  const response = await fetch(searchUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      ocp_version: '1.0',
      kind: 'CatalogSearchRequest',
      query: '',
      limit,
    }),
  });
  if (!response.ok) throw new Error(`search ${response.status}`);
  const payload = await response.json();
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items as CatalogSearchResultItem[];
}

function resolveSearchUrl(endpoint: string, discovery: RegistrationDiscovery): string {
  if (discovery.catalog_search_url) return discovery.catalog_search_url;
  return `${endpoint.replace(/\/+$/, '')}/ocp/catalogs/search`;
}

function summarize(item: CatalogSearchResultItem) {
  const verified = item.verification_status === 'verified';
  const healthy = item.health_status === 'healthy';
  return { verified, healthy };
}

export function useDirectory({ pollMs = 30_000, searchLimit = 50 }: Options = {}): DirectorySnapshot {
  const [registries, setRegistries] = useState<RegistryRuntime[]>(() =>
    knownRegistries.map((seed) => ({
      seed,
      status: 'loading' as RegistryStatus,
      discovery: null,
      catalogCount: 0,
      verifiedCount: 0,
      healthyCount: 0,
      lastChecked: null,
    })),
  );
  const [catalogsByRegistry, setCatalogsByRegistry] = useState<Record<string, CatalogSearchResultItem[]>>({});
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadOne(seed: KnownRegistry): Promise<{
      runtime: RegistryRuntime;
      catalogs: CatalogSearchResultItem[];
    }> {
      const now = Date.now();
      try {
        const discovery = await fetchDiscovery(seed.endpoint);
        const searchUrl = resolveSearchUrl(seed.endpoint, discovery);
        const catalogs = await fetchCatalogs(searchUrl, searchLimit).catch(
          () => [] as CatalogSearchResultItem[],
        );
        let verifiedCount = 0;
        let healthyCount = 0;
        for (const item of catalogs) {
          const { verified, healthy } = summarize(item);
          if (verified) verifiedCount += 1;
          if (healthy) healthyCount += 1;
        }
        return {
          runtime: {
            seed,
            status: 'live',
            discovery,
            catalogCount: catalogs.length,
            verifiedCount,
            healthyCount,
            lastChecked: now,
          },
          catalogs,
        };
      } catch (error) {
        return {
          runtime: {
            seed,
            status: 'unreachable',
            discovery: null,
            catalogCount: 0,
            verifiedCount: 0,
            healthyCount: 0,
            lastChecked: now,
            error: error instanceof Error ? error.message : 'unknown',
          },
          catalogs: [],
        };
      }
    }

    async function loadAll() {
      const results = await Promise.all(knownRegistries.map(loadOne));
      if (cancelled) return;
      setRegistries(results.map((r) => r.runtime));
      const byRegistry: Record<string, CatalogSearchResultItem[]> = {};
      for (let i = 0; i < knownRegistries.length; i += 1) {
        byRegistry[knownRegistries[i].id] = results[i].catalogs;
      }
      setCatalogsByRegistry(byRegistry);
      setLastUpdated(Date.now());
      setIsLoading(false);
    }

    void loadAll();
    const timer = setInterval(loadAll, pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pollMs, searchLimit]);

  const catalogs = useMemo<CatalogWithSources[]>(() => {
    const map = new Map<string, CatalogWithSources>();
    for (const [registryId, items] of Object.entries(catalogsByRegistry)) {
      for (const item of items) {
        const existing = map.get(item.catalog_id);
        if (existing) {
          if (!existing._source_registries.includes(registryId)) {
            existing._source_registries.push(registryId);
          }
        } else {
          map.set(item.catalog_id, { ...item, _source_registries: [registryId] });
        }
      }
    }
    return [...map.values()].sort((a, b) => {
      const sa = a.score ?? 0;
      const sb = b.score ?? 0;
      return sb - sa;
    });
  }, [catalogsByRegistry]);

  const stats = useMemo(() => {
    const registriesTotal = registries.length;
    const registriesLive = registries.filter((r) => r.status === 'live').length;
    const catalogsTotal = catalogs.length;
    let verifiedCount = 0;
    let healthyCount = 0;
    for (const item of catalogs) {
      if (item.verification_status === 'verified') verifiedCount += 1;
      if (item.health_status === 'healthy') healthyCount += 1;
    }
    return {
      registriesTotal,
      registriesLive,
      catalogsTotal,
      verifiedCount,
      healthyCount,
      verifiedRatio: catalogsTotal > 0 ? verifiedCount / catalogsTotal : 0,
      healthyRatio: catalogsTotal > 0 ? healthyCount / catalogsTotal : 0,
    };
  }, [registries, catalogs]);

  return { registries, catalogs, stats, lastUpdated, isLoading };
}
