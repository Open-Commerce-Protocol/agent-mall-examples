---
title: Catalog 架构
description: OCP Catalog 由 Discovery、Catalog、Provider Integration、Object Semantics、Action 五层组成，承载 Agent 调用与 Provider 接入两条主链路。
category: architecture
order: 1
---

# Catalog 架构

> 这是 OCP Catalog 的"系统总览"页。把读到的零散概念串成一张图，让你能定位每个对象在哪一层、与谁交互、由谁负责。

## 一句话解释

OCP Catalog 把自己拆成 **五个协议层**——Discovery、Catalog、Provider Integration、Object Semantics、Action——每一层只回答它该回答的一类问题；之上跑两条主链路：**Agent 调用链**与 **Provider 接入链**。

## 解决的问题

如果不分层，三件事会很快互相纠缠：

1. **角色边界混淆**：发现 Catalog、查询对象、接入数据源、解析详情、执行动作如果挤在同一个协议面里，权限、缓存、信任、责任会一起塌掉。
2. **行业差异污染核心**：商品、服务、职位、RFQ、招商机会各自有专有字段，如果直接进入对象模型，协议主体会被某个行业绑架。
3. **跨层越权**：Agent 容易直接构造商家私有 URL、跳过 resolve、发明字段，或者把"找到"和"下单"塞进一个调用里。

五层架构把这些风险拆给五个不同的契约面，让每一段都可以独立演进、独立缓存、独立审计。

## 它不是什么

- 不是网络分层（如 OSI）——这是**协议责任分层**，不是字节流分层。
- 不是部署架构——一个进程可以同时承载多层；多家公司也可以分担同一层。
- 不是某个参考实现的技术栈——OCP 不指定数据库、索引引擎、消息队列。
- 不是把检索 / 订单 / 支付强制划进不同服务——分层约束的是**协议面**，不是组织架构。

## 核心内容

### 五层架构

| 层 | 作用 | 典型对象 | 读者应如何理解 |
| --- | --- | --- | --- |
| **Discovery Layer** | 发现 Catalog、验证 Catalog、返回可缓存的路由摘要 | RegistrationDiscovery、RegistrationManifest、CatalogProfileSnapshot、CatalogRouteHint | "我应该去找哪个 Catalog"的回答层。注意它**不**搜索商品 |
| **Catalog Layer** | 声明 Catalog 能力、承载对象索引、执行 query / resolve | CatalogManifest、ObjectContract、QueryPackBinding、CatalogEntry | Catalog 自己的对外门面，决定可被以什么方式查询 |
| **Provider Integration Layer** | Provider 接入 Catalog，协商对象契约与同步能力 | ProviderRegistration、ProviderDeclaration、SyncCapability、RegistrationResult | "对象**怎么进入** Catalog"的协商层。注册建契约，同步才搬数据 |
| **Object Semantics Layer** | 定义通用对象包络与行业语义扩展 | CommercialObject、DescriptorPack、DescriptorInstance、DescriptorContract | 让一个 Catalog 同时承载商品、服务、人才、RFQ 的语义底座 |
| **Action Layer** | 把已解析对象连接到后续可执行动作 | ResolvableReference、ActionBinding、ActionInvocationContract | "对象 → 行动"的桥，但**不是**行动执行系统本身 |

五层之间通过明确的对象互相衔接：Discovery 返回 RouteHint 指向 Catalog Layer 的 Manifest；Catalog Layer 通过 Provider Integration 接受 Provider 的对象；对象按 Object Semantics 的 Descriptor Pack 组织；Action Layer 在 Resolve 时把对象连到外部动作入口。

### 典型 Agent 调用链

```
Agent/User
  -> local catalog profile cache
  -> Registration Node search
  -> CatalogRouteHint / CatalogManifest
  -> Catalog Node query
  -> CatalogEntry candidates
  -> Catalog Node resolve
  -> ResolvableReference + ActionBinding
  -> Action Provider / Merchant / Workflow
```

Agent 先查本地 profile cache，命中失败再向 Registration Node 搜索；拿到 RouteHint 或 Manifest 后，**切换**到目标 Catalog Node 执行 query；从候选 CatalogEntry 中选定对象后调用 resolve，拿到带权限约束的 ResolvableReference 与 ActionBinding；动作的真正执行在 Action Provider / 商家 / 业务工作流里完成。整条链路体现的是 [Search / Resolve / Action 三步法](/resolve-actions)：发现、解析、执行各走一阶。

### 典型 Provider 接入链路

```
Provider
  -> Catalog discovery document
  -> CatalogManifest
  -> ObjectContract inspection
  -> ProviderRegistration
  -> RegistrationResult
  -> Object sync channel
  -> CatalogEntry projection
```

Provider 先读 discovery document 和 Manifest，理解目标 Catalog 接受哪些对象类型与字段；按 ObjectContract 检视自身能保证的字段后提交 ProviderRegistration；Catalog 返回 RegistrationResult，明确选定的 SyncCapability（feed / pull / push / streaming / delta / snapshot）；之后对象通过同步通道源源进入 Catalog，被投影成 CatalogEntry。**注册只建契约，同步才搬数据**——两件事不混在一次调用里。

### 生产级存储边界

OCP 不规定具体数据库，但商品规模的生产 Catalog 应拆开对象事实库、检索投影和向量索引。

| 平面 | 职责 |
| --- | --- |
| 事实库，通常是 RDS / PostgreSQL | 持久化 `CommercialObject` payload、结构化过滤、事务、导入审计、去重状态、全文检索、resolve 引用 |
| CatalogEntry 投影 | 可搜索摘要、可选预览 `image_url`、排序信号、可见性投影、新鲜度、来源摘要、`object_ref` |
| 专用向量索引 | 大规模语义召回，以 `entry_id` / `object_ref` 为 key，并把索引版本和水位记录回事实库 |

不要把单个 RDS 表加 pgvector 当作千万级商品 embedding 召回的默认主路径。RDS 可以继续作为事实库和结构化/全文检索平面；向量召回应放在专用索引里，再通过稳定对象引用回表。

### 必须再次强调的边界

- **Registration Node 只发现 Catalog，不搜索商品**。它的查询对象是 Catalog metadata，不是任何商业对象本体。
- **Catalog Node 查询和解析商业对象，但不执行订单**。Catalog 暴露的是入口与摘要，不是订单状态机。
- **Provider 是对象来源方，不等于 Catalog**。同一个 Provider 可以接入多个 Catalog；同一个 Catalog 可以聚合多个 Provider。
- **ActionBinding 暴露动作入口，但不等于动作已经执行**。从 Resolve 拿到 ActionBinding 之后，还需要用户确认、参数校验、幂等控制、必要时支付信任层加签，动作才真正发生在 Action Provider 一侧。
- **WebMCP、REST、Webhook、A2A 属于适配层 / 绑定层，不是 OCP Catalog 的唯一形态**。它们映射核心语义，不替代核心模型。

## 相关页面

- [OCP 是什么](/what-is-ocp)
- [Catalog 是什么](/what-is-catalog)
- [OCP 角色模型](/roles)
- [Search / Resolve / Action 三步法](/resolve-actions)

