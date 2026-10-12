import type { LocalizedText } from './i18n';

export type RoadmapStatus = 'done' | 'in-progress' | 'planned';

export type RoadmapItem = {
  title: LocalizedText;
  body: LocalizedText;
  tag?: string;
};

export type RoadmapPhase = {
  id: string;
  status: RoadmapStatus;
  period: LocalizedText;
  title: LocalizedText;
  summary: LocalizedText;
  items: RoadmapItem[];
};

export const roadmapStatusLabels: Record<RoadmapStatus, LocalizedText> = {
  done: { en: 'Shipped', zh: '已交付' },
  'in-progress': { en: 'In progress', zh: '进行中' },
  planned: { en: 'Planned', zh: '规划中' },
};

export const roadmap: RoadmapPhase[] = [
  {
    id: 'foundation',
    status: 'done',
    period: { en: 'Foundation · Shipped', zh: '基础阶段 · 已交付' },
    title: {
      en: 'A working protocol, real connectors, and the first registry',
      zh: '协议落地、真实连接器，以及第一个注册中心',
    },
    summary: {
      en: 'OCP Catalog moved from specification to running tooling: the first protocol version is frozen, merchant platforms can connect in one step, and the first public registry is live.',
      zh: 'OCP Catalog 从规范走向可运行的工具：协议第一版定稿，商家平台可以一键接入，第一个公共注册中心也已上线。',
    },
    items: [
      {
        title: { en: 'OCP Catalog protocol v1 finalized', zh: 'OCP Catalog 协议第一版定稿' },
        body: {
          en: 'Handshake v1 and Registration v1 contracts are finalized as the first stable protocol version, covering discovery, manifests, query, resolve, and action binding.',
          zh: 'Handshake v1 与 Registration v1 契约作为第一个稳定协议版本定稿，覆盖发现、清单、查询、解析与动作绑定。',
        },
        tag: 'protocol',
      },
      {
        title: { en: 'Shopify & WooCommerce connectors', zh: 'Shopify 与 WooCommerce 第三方插件' },
        body: {
          en: 'Shopify and WooCommerce provider apps turn an existing store into an OCP Provider, sync products into a catalog, and keep checkout on the merchant storefront — making one-step onboarding real.',
          zh: 'Shopify 与 WooCommerce Provider 应用把已有店铺变成 OCP Provider，将商品同步进 Catalog，并把结账保留在商家店铺，让一键接入成为现实。',
        },
        tag: 'connectors',
      },
      {
        title: { en: 'First registry online', zh: '第一个注册中心建立' },
        body: {
          en: 'The first public registration node (operated by DeepLumen) indexes catalogs that opt into the open OCP discovery surface, so agents have a real place to start.',
          zh: '第一个公共注册节点（由 DeepLumen 运营）索引主动接入 OCP 公共发现层的 Catalog，让 Agent 有了真实的起点。',
        },
        tag: 'registry',
      },
      {
        title: { en: 'CLI & skill toolchain', zh: 'CLI 与 Skill 工具链' },
        body: {
          en: 'A CLI and an agent skill ship the standard OCP workflow with structured JSON help and manifest-based request validation, so agents call the protocol correctly.',
          zh: 'CLI 与 Agent skill 提供标准 OCP 工作流，带结构化 JSON help 和基于 manifest 的请求校验，让 Agent 正确地调用协议。',
        },
        tag: 'tooling',
      },
    ],
  },
  {
    id: 'reach',
    status: 'in-progress',
    period: { en: 'Reach · In progress', zh: '扩展阶段 · 进行中' },
    title: {
      en: 'Reaching the agent platforms and opening the tooling',
      zh: '触达智能体平台，并开放工具链',
    },
    summary: {
      en: 'Work now in flight focuses on getting OCP Catalog in front of more agents and making the tooling easy to adopt.',
      zh: '当前进行中的工作聚焦于让更多 Agent 触达 OCP Catalog，并让工具链更易于采用。',
    },
    items: [
      {
        title: { en: 'Agent platform integrations', zh: '智能体平台接入' },
        body: {
          en: 'The OCP Catalog plugin is being integrated and adapted across agent platforms such as Coze and QClaw, so their agents can discover catalog objects while the final deal returns to the merchant.',
          zh: 'OCP Catalog 插件正在接入、适配 Coze、QClaw 等智能体平台，让平台上的 Agent 可以发现 Catalog 对象，而最终成交仍回到商家侧。',
        },
        tag: 'integrations',
      },
      {
        title: { en: 'CLI & skill public release', zh: 'CLI 与 Skill 公开发布' },
        body: {
          en: 'The CLI and agent skill are published on npm, so teams can install them without a monorepo checkout. Current work focuses on agent-platform integration and documentation polish.',
          zh: 'CLI 与 Agent skill 已发布到 npm，团队无需克隆 monorepo 即可安装。当前工作聚焦于智能体平台接入和文档打磨。',
        },
        tag: 'tooling',
      },
    ],
  },
  {
    id: 'commerce',
    status: 'planned',
    period: { en: 'Commerce layer · Planned', zh: '交易层 · 规划中' },
    title: {
      en: 'From discovery to trusted, settled transactions',
      zh: '从发现走向可信、可结算的交易',
    },
    summary: {
      en: 'The next direction is to extend the protocol beyond discovery so value can move safely, with payments, settlement, and verifiable trails.',
      zh: '下一步方向是把协议从发现延伸出去，让价值可以安全流动：支付、结算与可验证的交易记录。',
    },
    items: [
      {
        title: { en: 'Payment agent integration', zh: '支付 Agent 结合' },
        body: {
          en: 'Explore pairing OCP Catalog with payment agents such as Visa, so a confirmed action can continue into a trusted payment flow.',
          zh: '探索把 OCP Catalog 与 Visa 等支付 Agent 结合，让确认后的动作可以延续到可信的支付流程。',
        },
        tag: 'payments',
      },
      {
        title: { en: 'Native OCP payment protocol', zh: 'OCP 自有支付协议' },
        body: {
          en: 'Define a native OCP payment protocol so catalogs and providers share one consistent contract for initiating and confirming transactions.',
          zh: '定义 OCP 原生支付协议，让 Catalog 与 Provider 在发起和确认交易时共享一致的契约。',
        },
        tag: 'payments',
      },
      {
        title: { en: 'Commission & revenue sharing', zh: '分佣分账机制' },
        body: {
          en: 'Add a commission and revenue-sharing mechanism so the parties that route and resolve commerce can be fairly attributed and settled.',
          zh: '增加分佣与收益分账机制，让参与路由和解析交易的各方能被公平归因和结算。',
        },
        tag: 'settlement',
      },
    ],
  },
  {
    id: 'trust',
    status: 'planned',
    period: { en: 'Trust & network · Planned', zh: '信任与网络 · 规划中' },
    title: {
      en: 'Stronger trust guarantees and a wider OCP network',
      zh: '更强的信任保障，以及更广的 OCP 网络',
    },
    summary: {
      en: 'Longer-term goals harden the trust model and grow the network so OCP becomes a dependable commerce fabric for agents.',
      zh: '更长期的目标是强化信任模型并扩大网络，让 OCP 成为面向 Agent 的可靠商业基础设施。',
    },
    items: [
      {
        title: { en: 'On-chain transaction traceability', zh: '交易行为上链追溯' },
        body: {
          en: 'On-chain traceability for commercial transaction behavior, so important commerce actions have a verifiable, auditable trail.',
          zh: '商业交易行为上链追溯，让关键交易动作拥有可验证、可审计的记录。',
        },
        tag: 'trust',
      },
      {
        title: { en: 'Stronger encryption & security', zh: '更强的加密与安全' },
        body: {
          en: 'Stronger encryption and security across the protocol surface, protecting requests, payloads, and identity end to end.',
          zh: '协议层面更强的加密与安全，端到端保护请求、载荷与身份。',
        },
        tag: 'security',
      },
      {
        title: { en: 'Expand the OCP network', zh: '扩展 OCP 网络' },
        body: {
          en: 'Grow the OCP network with more registration nodes and a broader provider and catalog ecosystem.',
          zh: '通过更多注册节点和更广的 Provider、Catalog 生态扩大 OCP 网络。',
        },
        tag: 'network',
      },
    ],
  },
];
