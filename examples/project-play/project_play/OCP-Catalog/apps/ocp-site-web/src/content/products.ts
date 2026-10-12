import type { LocalizedText } from './i18n';

export type ProductStatus = 'stable' | 'in-progress' | 'coming-soon';

export type Product = {
  id: string;
  /** Icon key, mapped to a lucide icon in ProductsPage. */
  icon: string;
  name: LocalizedText;
  tagline: LocalizedText;
  description: LocalizedText;
  status: ProductStatus;
  href: string;
  external?: boolean;
  tags?: string[];
};

export const productStatusLabels: Record<ProductStatus, LocalizedText> = {
  stable: { en: 'Available', zh: '已可用' },
  'in-progress': { en: 'In progress', zh: '进行中' },
  'coming-soon': { en: 'Coming soon', zh: '即将推出' },
};

export const products: Product[] = [
  {
    id: 'ocp-catalog',
    icon: 'catalog',
    name: { en: 'OCP Catalog', zh: 'OCP Catalog' },
    tagline: {
      en: 'The open protocol for agent-readable commerce',
      zh: '面向 Agent 的开放商业协议',
    },
    description: {
      en: 'The core protocol: discovery, query, resolve, and action binding for products, services, and action entry points — with a live federated topology of registries and catalogs.',
      zh: '核心协议：为商品、服务与可执行动作提供发现、查询、解析与动作绑定，并带有注册节点与 Catalog 的实时联邦拓扑。',
    },
    status: 'stable',
    href: '/products/ocp-catalog',
    tags: ['protocol', 'topology'],
  },
  {
    id: 'cli',
    icon: 'cli',
    name: { en: 'OCP CLI', zh: 'OCP CLI' },
    tagline: {
      en: 'Drive the protocol from the command line',
      zh: '用命令行驱动协议',
    },
    description: {
      en: 'A published npm CLI that turns the standard OCP workflow into commands and validates requests against a Catalog manifest before they are sent.',
      zh: '已发布到 npm 的 CLI，把标准 OCP 工作流变成命令，并在请求发送前用 Catalog manifest 校验参数。',
    },
    status: 'stable',
    href: '/docs/cli-and-skill',
    tags: ['tooling', 'validation'],
  },
  {
    id: 'skill',
    icon: 'skill',
    name: { en: 'Agent Skill', zh: 'Agent Skill' },
    tagline: {
      en: 'A drop-in OCP skill for your agent',
      zh: '可直接装进 Agent 的 OCP skill',
    },
    description: {
      en: 'The ocp-catalog skill installs the CLI-first OCP workflow into an agent environment, so agents follow the protocol correctly without a monorepo checkout.',
      zh: 'ocp-catalog skill 把 CLI 优先的 OCP 工作流装进 Agent 环境，让 Agent 无需克隆仓库即可正确遵循协议。',
    },
    status: 'stable',
    href: '/docs/cli-and-skill',
    tags: ['agent', 'tooling'],
  },
  {
    id: 'mcp-server',
    icon: 'mcp',
    name: { en: 'MCP Server', zh: 'MCP Server' },
    tagline: {
      en: 'Expose OCP catalogs over the Model Context Protocol',
      zh: '通过 Model Context Protocol 暴露 OCP Catalog',
    },
    description: {
      en: 'An MCP server that lets MCP-compatible agents discover and resolve OCP catalog objects through the tools they already speak.',
      zh: '一个 MCP 服务器，让兼容 MCP 的 Agent 通过它们已有的工具发现并 resolve OCP Catalog 对象。',
    },
    status: 'stable',
    href: '/docs/mcp-server',
    tags: ['mcp', 'integration'],
  },
  {
    id: 'webmcp-adapter',
    icon: 'webmcp',
    name: { en: 'WebMCP Adapter', zh: 'WebMCP 适配器' },
    tagline: {
      en: 'Bridge OCP into in-page WebMCP surfaces',
      zh: '把 OCP 桥接到页面内的 WebMCP',
    },
    description: {
      en: 'An adapter that maps OCP discovery and resolve into WebMCP, so a website can offer agent-usable commerce tools in the browser.',
      zh: '把 OCP 的发现与 resolve 映射到 WebMCP 的适配器，让网站可以在浏览器中提供 Agent 可用的商业工具。',
    },
    status: 'stable',
    href: '/docs/examples/webmcp-demo',
    tags: ['webmcp', 'adapter'],
  },
  {
    id: 'shopify-connector',
    icon: 'shopify',
    name: { en: 'Shopify Connector', zh: 'Shopify 连接器' },
    tagline: {
      en: 'Turn a Shopify store into an OCP Provider',
      zh: '把 Shopify 店铺变成 OCP Provider',
    },
    description: {
      en: 'A provider app that registers a Shopify merchant, syncs products into a catalog, and keeps checkout on the merchant storefront.',
      zh: '一个 Provider 应用，注册 Shopify 商家、把商品同步进 Catalog，并把结账保留在商家店铺。',
    },
    status: 'stable',
    href: '/docs/examples/shopify-provider',
    tags: ['provider', 'commerce'],
  },
  {
    id: 'woocommerce-connector',
    icon: 'woocommerce',
    name: { en: 'WooCommerce Connector', zh: 'WooCommerce 连接器' },
    tagline: {
      en: 'Publish WordPress commerce through OCP',
      zh: '通过 OCP 发布 WordPress 电商',
    },
    description: {
      en: 'A provider app that brings WooCommerce inventory into OCP-compatible catalogs over the WooCommerce REST API, with sync and webhooks.',
      zh: '一个 Provider 应用，通过 WooCommerce REST API 把 WooCommerce 库存接入 OCP 兼容 Catalog，支持同步与 webhook。',
    },
    status: 'stable',
    href: '/docs/examples/woocommerce-overview',
    tags: ['provider', 'commerce'],
  },
];
