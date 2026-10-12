# 构建一个最小 Provider

这一页演示的是，在当前以 push 为主的 OCP handshake 下，怎样实现一个最小但可参与协议的 provider。

如果你想看更接近真实商家平台的例子，可以在读完这一页后看 [Shopify Provider 示例](/examples/shopify-provider)。

目标同样被故意收得很窄：

- 选择一个目标 catalog
- 构造一份 `ProviderRegistration`
- 同步一个对象
- 不需要自己对外提供公网 API

## 这个最小 Provider 假设什么

这里假设目标 catalog 支持：

- `POST /ocp/providers/register`
- `POST /ocp/objects/sync`
- sync capability `ocp.push.batch`

在这个模型下，provider 不需要为了 agent 而常驻。它只需要在注册和同步的时候运行即可。

## 最小 Provider Registration

```ts
await fetch('https://catalog.example.com/ocp/providers/register', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    ocp_version: '1.0',
    kind: 'ProviderRegistration',
    id: 'reg_hello_provider_v1',
    catalog_id: 'hello_catalog',
    registration_version: 1,
    updated_at: new Date().toISOString(),
    provider: {
      provider_id: 'hello_provider',
      entity_type: 'merchant',
      display_name: 'Hello Provider',
    },
    object_declarations: [
      {
        guaranteed_fields: [
          'hello.example.object.v1#/message',
        ],
        optional_fields: [],
        sync: {
          preferred_capabilities: ['ocp.push.batch'],
          avoid_capabilities_unless_necessary: [],
          provider_endpoints: {},
        },
      },
    ],
  }),
});
```

## 最小 Object Sync

当 registration 成为 active 之后，provider 就可以推送一个对象：

```ts
await fetch('https://catalog.example.com/ocp/objects/sync', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': '<catalog-object-sync-key>',
  },
  body: JSON.stringify({
    ocp_version: '1.0',
    kind: 'ObjectSyncRequest',
    catalog_id: 'hello_catalog',
    provider_id: 'hello_provider',
    registration_version: 1,
    batch_id: 'batch_hello_001',
    objects: [
      {
        ocp_version: '1.0',
        kind: 'CommercialObject',
        id: 'obj_hello_001',
        object_id: 'hello_object',
        object_type: 'example',
        provider_id: 'hello_provider',
        title: 'hello world object',
        status: 'active',
        descriptors: [
          {
            pack_id: 'hello.example.object.v1',
            data: {
              message: 'hello world from provider',
            },
          },
        ],
      },
    ],
  }),
});
```

## 最小 Provider 脚本

```ts
const catalogBaseUrl = 'https://catalog.example.com';
const objectSyncKey = '<catalog-object-sync-key>';

async function publishHelloProvider() {
  await fetch(`${catalogBaseUrl}/ocp/providers/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ocp_version: '1.0',
      kind: 'ProviderRegistration',
      id: 'reg_hello_provider_v1',
      catalog_id: 'hello_catalog',
      registration_version: 1,
      updated_at: new Date().toISOString(),
      provider: {
        provider_id: 'hello_provider',
        entity_type: 'merchant',
        display_name: 'Hello Provider',
      },
      object_declarations: [
        {
          guaranteed_fields: ['hello.example.object.v1#/message'],
          optional_fields: [],
          sync: {
            preferred_capabilities: ['ocp.push.batch'],
            avoid_capabilities_unless_necessary: [],
            provider_endpoints: {},
          },
        },
      ],
    }),
  });

  await fetch(`${catalogBaseUrl}/ocp/objects/sync`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': objectSyncKey,
    },
    body: JSON.stringify({
      ocp_version: '1.0',
      kind: 'ObjectSyncRequest',
      catalog_id: 'hello_catalog',
      provider_id: 'hello_provider',
      registration_version: 1,
      batch_id: 'batch_hello_001',
      objects: [
        {
          ocp_version: '1.0',
          kind: 'CommercialObject',
          id: 'obj_hello_001',
          object_id: 'hello_object',
          object_type: 'example',
          provider_id: 'hello_provider',
          title: 'hello world object',
          status: 'active',
          descriptors: [
            {
              pack_id: 'hello.example.object.v1',
              data: {
                message: 'hello world from provider',
              },
            },
          ],
        },
      ],
    }),
  });
}
```

## 生命周期

```text
provider 进程启动
-> 提交 ProviderRegistration
-> catalog 接受并激活一个 registration version
-> provider 提交 ObjectSyncRequest
-> catalog 索引 provider 对象
-> 下游 query / resolve 开始可以使用它
```

## 实践说明

- 在当前 push 模型下，provider 不需要自己的公网域名。
- provider 也不需要常驻，除非所选 sync capability 需要 provider-hosted endpoint。
- 在这个示例里，Provider registration 不需要 catalog 的 object-sync API key。
- 但 provider 需要可确定地管理 `registration_version`。
- sync 通常还必须和当前 active 的 `registration_version` 对齐。

## 相关页面

- [快速接入](/getting-started)
- [ProviderRegistration](/handshake/provider-registration)
- [CommercialObject](/handshake/commercial-object)
- [提供方流程](/examples/provider-flow)
- [Shopify Provider 示例](/examples/shopify-provider)
