# FAQ

这一页集中回答新接入者最常问的一些简单问题。

## Catalog 注册到 Registration node，一定需要域名吗？

在当前仓库的本地开发环境里，不一定。demo Registration node 不要求额外的域名 verification challenge。

但如果你要参与更公开或更接近生产的网络，通常还是需要：

- 稳定域名
- HTTPS
- 域名控制权验证

所以简短回答是：

- 本地 demo：不一定需要
- 公开网络参与：通常要准备

## Provider 一定要暴露自己的公网接口吗？

不一定。

在当前仓库的主示例里，协商出来的 sync capability 是 `ocp.push.batch`，所以 provider 只需要把 registration 和 object 主动推送到 catalog 提供的接口。

只有当选中的 capability 需要 provider-hosted endpoint 时，你才需要暴露自己的接口，例如：

- provider-hosted feed pull
- provider-hosted API pull
- streaming / webhook 型能力

## Provider 一定要常驻运行吗？

不一定。

在当前 push-based 示例下：

- provider 不需要为了“保持注册状态”而长期对外提供服务
- 它只需要在发 registration 或做 object sync 的时候可运行

但如果你使用 pull 或 stream 模型，答案就会改变：

- provider-hosted feed / API 需要长期可访问
- streaming provider 往往也需要更持续的运行时

## Catalog 一定要常驻运行吗？

通常是的，如果你希望 agent 真正查询它。

Catalog 是 query-serving node。如果它离线：

- Registration node 可能仍然保留 route hint
- 但真实的 query / resolve 请求会失败
- health check 也可能把它标记为 unhealthy

所以 catalog 一般会是一个长期运行的服务。

## Provider 需要自己管理 registration version 吗？

需要，或者至少要可确定地管理它。

registration 之所以版本化，不是为了好看，而是因为：

- catalog 会用版本决定哪份 declaration 是 active 的
- 旧版本不应该静默覆盖新版本
- sync 请求往往还必须与 active registration version 严格匹配

也就是说，registration version 不只是元数据，它本身就是运行时 contract boundary 的一部分。

## 不使用某个官方 Registration node，也能参与 OCP 吗？

可以。

OCP 不是围绕一个强制性的全局 Registration node 设计的：

- 任何人都可以运行 OCP Catalog Registration node
- catalog 可以注册到一个 Registration node、多个 Registration node，或者私有 Registration node
- agent 也可以自己决定信任哪个或哪些 Registration node

即使有一个公开 Registration node，它也只是发现入口之一，不会让协议本身变成中心化协议。

## 我可以运行私有 Registration node 吗？

可以。

私有 Registration node 很适合：

- 企业内部路由
- 垂直领域 catalog discovery
- 自定义 trust policy
- staging / partner integration

协议本身并不要求 Registration node 一定公开。

## 我能构建的最小可用 Catalog 是什么样？

一个很小的 catalog 只要能做到这些，就已经有价值：

- 暴露 discovery
- 暴露 manifest
- 回答 query 请求
- 可选地支持 resolve

如果它还想支持 provider 接入，那就进一步支持 provider registration 和 object sync。

这份文档里已经补了一个最小可实现例子，见 [快速接入](/getting-started) 里的 `hello_catalog`：

- 只有一个布尔字段 `example_filed`
- query 总是返回一个确定性的固定对象
- 然后再用一条 catalog registration 请求把它注册到 Registration node

## 我能构建的最小可用 Provider 是什么样？

一个很小的 provider 只要能做到这些，就已经能参与：

- 构造合法的 `ProviderRegistration`
- 把这份 registration 发给 catalog
- 把自己的源数据映射成合法的 `CommercialObject`
- 使用某条 catalog 支持的 capability 完成 sync

它不需要在第一天就覆盖所有 optional field。

## 注册之后会发生什么？

### Catalog -> Registration node

典型生命周期：

```text
register
-> fetch discovery/manifest
-> verify
-> index
-> 持续 refresh
```

### Provider -> Catalog

典型生命周期：

```text
register
-> registration 成为 active
-> sync objects
-> catalog 把对象投影成 entries
-> 下游 agent 的 query / resolve 开始真正可用
```

## 如果我现在就想动手，应该先看哪里？

建议从这里开始：

- [快速接入](/getting-started)
- [最小 Catalog](/examples/minimal-catalog)
- [最小 Provider](/examples/minimal-provider)
- [角色](/roles)
- [提供方流程](/examples/provider-flow)
- [注册流程](/examples/registration-flow)
