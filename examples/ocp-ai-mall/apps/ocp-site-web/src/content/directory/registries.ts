import type { LocalizedText } from '../i18n';

export type KnownRegistry = {
  id: string;
  name: LocalizedText;
  endpoint: string;
  operator: LocalizedText;
  region: string;
  intro: LocalizedText;
  homepage?: string;
};

/**
 * Manually curated list of known OCP registration nodes.
 * Update this file when new public registration nodes come online.
 *
 * `endpoint` must be the origin that serves /.well-known/ocp-registration.
 * The actual API base (catalog search etc.) is read from the discovery document
 * at runtime, so registries that mount their API under a sub-path (e.g.
 * `/registry/ocp/catalogs/search`) work automatically.
 */
export const knownRegistries: KnownRegistry[] = [
  {
    id: 'ocp-public',
    name: {
      en: 'Open Commerce Protocol Registry',
      zh: 'OCP 公共注册中心',
    },
    endpoint: 'https://ocp.deeplumen.io',
    homepage: 'https://ocp.deeplumen.io',
    operator: {
      en: 'DeepLumen',
      zh: 'DeepLumen',
    },
    region: 'global',
    intro: {
      en: 'Reference public registration node operated by DeepLumen. Indexes catalogs that opt in to the open OCP discovery surface.',
      zh: 'DeepLumen 运营的公共参考注册节点，索引主动接入 OCP 公共发现层的 catalog。',
    },
  },
];
