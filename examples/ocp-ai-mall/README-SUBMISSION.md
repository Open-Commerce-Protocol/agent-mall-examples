# 逛逛 AI Mall — OCP 二次开发源码提交包

打包日期：2026-10-11。本包包含当前工作区源码（含尚未提交的新增模块和修改），不是仅导出上一次 Git 提交。评审请优先阅读本说明；仓库中的旧咖啡演示文档描述的是 legacy 模式。

## 作品与 OCP 的关系

基于 Open Commerce Protocol (OCP) Catalog 开发个人 AI 购物助手。上游协议、schema、client、CLI 和教学示例保留原有署名和 MIT LICENSE。应用扩展集中在：

- apps/shopping-agent-web：AI 对话、API 配置、商品规格、订单预览与明确确认、支付二维码和订单查询。
- apps/shopping-agent-api：本机 API、模型配置、会话与瑞幸服务编排。
- packages/agent-runtime：多模型适配、受约束的导购与工具调用。
- packages/luckin-adapter、packages/luckin-integration：MCP 映射、OCP 查询与 Resolve 边界、订单持久化及未决结果保护。
- packages/shopping-contracts、packages/merchant-core、apps/coffee-merchant-api：共享契约与保留的本地演示。
- tests：合成 MCP / 模型替身的自动化与浏览器验证。

当前 UI 只有对话与 API 配置两个主要页面，旧入口 /demo 会跳转到对话；API 配置保存后直接返回对话。两页使用浅色与淡紫色配色。

## 安装与启动

需要 Bun 1.3.13（与 packageManager 一致）。依赖和编译产物不在本包中，安装时需要联网获取依赖。

~~~powershell
bun install --frozen-lockfile
bun run shopping:demo
~~~

对话：http://127.0.0.1:4310/ 。API 配置：http://127.0.0.1:4310/settings 。模型 API 密钥由评审使用自己的凭据在配置页输入；支持 OpenAI 兼容、Anthropic、Gemini。保存后沿用本机配置。

无瑞幸授权也可启动页面；商品查询和真实交易需自行配置授权，不会继承提交者的账户。初次运行生成签名、数据库、配置等本地文件，均位于忽略的 .codex-tmp 目录。

## 瑞幸 MCP 配置（使用评审自己的账户）

推荐使用环境变量，避免把真实令牌写进文件。下面字符串是明确的占位符，必须替换；请勿以空格充当授权令牌。

~~~powershell
$env:LUCKIN_MCP_TOKEN = 'YOUR_OWN_LUCKIN_MCP_TOKEN'
$env:LUCKIN_NEW_ORDERS = 'disabled'
bun run shopping:demo
~~~

LUCKIN_NEW_ORDERS=disabled 可先只检查对话和商品查询。真实购买需要本人授权，确认按钮会调用真实创建订单；扫码支付由用户完成。

若需要 MCP 配置文件，将 config/luckin-mcp.example.toml 复制为 .codex/config.toml。模板仅含公开接口地址及 bearer_token_env_var 环境变量名，完全未复用提交者的配置文件、令牌或其他 MCP 服务。仍需设置自己的 LUCKIN_MCP_TOKEN。应用也可只使用环境变量，无需复制模板。

可选 .env.example 的 LUCKIN_MCP_TOKEN 值为空；空值表示未配置。复制成 .env 后只在本机填写，切勿重新上传该文件。

## 无个人凭据的验证

~~~powershell
bun run luckin:test
bun run shopping:test
bun run shopping:check
bun run luckin:check
~~~

上述测试使用合成数据和本地模型/MCP 替身，不需要提交者的账号。浏览器检查另需本机已有 Chrome/Chromium：bun run luckin:browser 。

离线合成瑞幸服务：bun run luckin:fixture ，入口为 http://127.0.0.1:8790 。此入口是独立测试环境，不是聊天页的真实 MCP 授权替代。原咖啡模拟应用：bun run shopping:demo --legacy 。

## 数据与打包范围

保留重建和评审需要的源码、静态资产、锁文件、协议资料、公开工具 schema、合成测试数据、开源许可证。

排除 .git 历史、.codex/.agents 等个人工具配置、真实 .env、真实模型设置、令牌、私钥、订单/支付/会话数据库、日志、截图、报告、依赖目录、dist、缓存及生成的浏览器 contracts.js；运行命令会重新生成所需构建文件。

fixtures/shopping/keys/agent_a_test.public.pem 是公开的合成测试公钥；测试私钥不在包中，测试程序可由公开固定测试种子重新生成。测试中的 synthetic-token、合成订单号、价格与二维码属于虚构测试样本，不是提交者的真实订单或凭据。固定坐标是应用预设演示位置，不采集设备定位。

为避免传出原精确预设位置，提交包将相关源码、界面说明和测试中的坐标统一替换为示例经度 120.15、纬度 30.25；这些是提交包的示例值，不表示提交者位置。当前工作区的运行配置没有改变。

SUBMISSION-MANIFEST.json 列出包内文件的 SHA-256（不含清单本身）。SUBMISSION-SECURITY.json 记录排除策略及扫描结果。此包不会携带或使用提交者的瑞幸 MCP 配置。
