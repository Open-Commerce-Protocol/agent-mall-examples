# OCP Commerce Lab

这是一个基于 Open Commerce Protocol（OCP 1.0）的可运行商户端二次开发示例。项目不依赖第三方 Python 包，使用 Python 标准库即可启动。

## 运行

环境要求：Python 3.7 或更高版本。

```powershell
cd C:\Users\asus\Desktop\OCP
python run.py
```

也可以双击 `start.bat`。浏览器会自动打开：

```text
http://127.0.0.1:8760
```

停止服务：在终端按 `Ctrl+C`。

## 已实现功能

- OCP Catalog 服务发现：`GET /.well-known/ocp-catalog`
- Catalog Manifest、Health 与 Object Contracts
- OCP Catalog `POST /ocp/query` 与 `POST /ocp/resolve`
- 多公司 Provider 注册与统一 Catalog 网关
- 跨公司扇出查询和按来源 Provider 路由解析
- 网站内商户接入页面、连接测试和外部 Provider 移除
- 单地址 OCP-Catalog 自动发现和一键接入
- 中国内地知名商户按名称搜索和接口接入
- 瑞幸、KFC 和麦当劳门店定位、附近门店搜索与门店选择
- 已接入商户商品在主页面聚合展示、按品类和商户筛选并支持加购
- 自然语言智能选购、用户确认加购和微信沙箱付款二维码
- 商户能力声明：`GET /ocp/v1/capabilities`
- 商品搜索与单商品查询
- 购物车创建、加购、改数量、移除
- 服务端定价、税费、配送方式与结算会话
- 支付令牌校验、库存扣减、订单确认
- 未发货订单取消、自动退款与库存恢复
- 幂等键与结构化协议错误
- 买家代理自动完成完整购买流程
- 实时控制台、协议轨迹和 JSON 详情查看
- 简体中文与 English 即时切换，并记住用户选择
- 端到端协议测试

## 测试

```powershell
cd C:\Users\asus\Desktop\OCP
python -m unittest discover -s tests -v
```

测试会启动随机本地端口，并验证目录、购物车、结算、支付、订单、库存、幂等和代理流程。

## 目录结构

```text
OCP/
├─ ocp/
│  ├─ agent.py          # 买家代理
│  ├─ errors.py         # OCP 错误模型
│  ├─ models.py         # 商品、购物车、结算、支付、订单状态机
│  └─ server.py         # OCP HTTP 服务与路由
├─ web/
│  ├─ app.js
│  ├─ index.html
│  ├─ styles.css
│  └─ assets/           # 本地商品视觉资源
├─ docs/
│  └─ OCP-1.0-profile.md
├─ tests/
│  └─ test_e2e.py
├─ run.py
└─ start.bat
```

## 协议调用示例

创建购物车：

```powershell
curl.exe -X POST "http://127.0.0.1:8760/ocp/v1/carts" `
  -H "Content-Type: application/json" `
  -H "X-OCP-Version: 1.0" `
  -H "Idempotency-Key: demo-cart-001" `
  -d "{\"buyerId\":\"buyer_demo\"}"
```

运行买家代理：

```powershell
curl.exe -X POST "http://127.0.0.1:8760/api/agent/run" `
  -H "Content-Type: application/json" `
  -d "{\"query\":\"portable\"}"
```

完整字段、错误码和状态转换见 [docs/OCP-1.0-profile.md](docs/OCP-1.0-profile.md)。
Catalog 扩展说明见 [docs/OCP-CATALOG-1.0.md](docs/OCP-CATALOG-1.0.md)。
多公司接入说明见 [docs/OCP-CATALOG-GATEWAY.md](docs/OCP-CATALOG-GATEWAY.md)。
智能选购与支付说明见 [docs/ASSISTANT-PAYMENT.md](docs/ASSISTANT-PAYMENT.md)。

## 二次开发入口

- 替换商品与商户信息：修改 `ocp/models.py` 中的 `PRODUCTS` 和 `capabilities()`。
- 接入真实库存或数据库：替换 `CommerceStore` 中的数据访问方法。
- 接入支付服务：替换 `pay_checkout()` 中的 `tok_` 演示校验。
- 接入真实退款服务：替换 `cancel_order()` 中生成演示退款记录的逻辑。
- 接入真实物流：扩展订单的 `fulfillment` 状态。
- 更换外部商户：保留 `OCPAgent` 请求结构，并在商户端实现相同 OCP 路由。
- 扩展语言：在 `web/i18n.js` 中增加语言资源，并在商品 `translations` 字段补充对应内容。
- 扩展 Catalog 对象：修改 `ocp/catalog.py` 中的 Object Contract 与字段引用。
- 接入外部公司：通过 `POST /ocp/gateway/providers` 注册其 OCP-Catalog 根地址。

本演示将商户端状态保存在内存中，重启后恢复到初始商品和库存。
