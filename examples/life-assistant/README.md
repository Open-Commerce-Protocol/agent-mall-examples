# 一念 One · 生活服务助手

一个中文生活服务原型，把咖啡、出行和购物入口放在同一页面。网页提供文字与浏览器语音输入、常用偏好、长辈模式，以及由本机 Python 服务连接的瑞幸官方 MCP 点单流程。其他品牌提供前往官方服务的入口。

这个仓库发布源码。完整的瑞幸连接、报价、订单查询和 OAuth 登录需要运行 Python 后端；将文件上传到 GitHub 本身不会启动服务。

## 本地运行

需要 Python 3。基础服务、瑞幸 MCP 和微信 OAuth 使用 Python 标准库；支付宝 RSA2 登录另需安装 `requirements-auth.txt` 中的可选依赖。

下载或克隆仓库后，在项目目录运行：

```sh
python3 app.py
```

Windows 可使用：

```powershell
py -3 app.py
```

浏览器打开 [http://127.0.0.1:8765/](http://127.0.0.1:8765/)。macOS 也可双击 `启动.command`。保持终端运行，结束时按 `Control + C` 停止服务。端口被占用时，可运行 `python3 app.py --port 8766`，再打开对应地址。

## GitHub 与 GitHub Pages

| 方式 | 能力 |
|---|---|
| GitHub 源码仓库 | 浏览、下载和版本管理源码；下载后在自己的电脑启动服务 |
| GitHub Pages | 托管 HTML、CSS、JavaScript 等静态文件，可用于页面展示 |
| 运行 `app.py` 的环境 | 提供本项目 `/api/*`、OCP/MCP 接口和 OAuth 回调等后端能力 |

GitHub Pages 是静态网站托管服务，不能常驻运行 `app.py`，也不会提供 Python 瑞幸后端。页面中的 `/api/connect`、`/api/tool`、`/api/auth/*` 和 `/ocp/*` 调用都依赖这个后端。直接把 `static/` 复制到 Pages，不会自动获得真实点单或登录功能；项目站点还需要适配资源的子路径。静态预览的可用范围应以其页面说明为准。[GitHub 官方 Pages 说明](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)。

默认本地模式绑定 `127.0.0.1`，瑞幸连接保存在该运行进程的共享状态中，适合单机使用。仓库另有可选云模式，为每个浏览器会话隔离瑞幸连接、工具列表和订单结果，并检查 HTTPS 来源；它尚未完成线上部署和真实账号联调。微信或支付宝登录仍需通过平台审核并登记对应回调域名。

## 云端准备状态

`Dockerfile`、`.dockerignore` 和 `render.yaml` 提供容器与 Render 单实例配置。云模式通过 `--cloud` 或 `CLOUD_MODE=1` 启用，读取 `HOST`、`PORT`、`PUBLIC_ORIGIN`；Render 环境可读取 `RENDER_EXTERNAL_URL`。`/healthz` 提供健康检查。

这些文件是部署准备，尚未连接 Render 账号、构建或上线容器，也没有可验证的公网后端地址。当前前端尚未接入云模式写请求所需的稳定 `idempotencyKey`，因此不能把云准备配置认定为已经可用的云端点单系统。云模式的确认写请求必须携带稳定标识；同一标识和参数重复提交会返回原结果，避免在本实例中重复创建订单。

云模式的浏览器会话、瑞幸凭证和幂等记录均只保存在单进程内存。实例休眠或重启后记录会消失，需要重新连接，并先通过官方渠道核查已有订单，再决定是否重新提交。真实部署还需完成 HTTPS 站点、平台回调配置、前端接口接入与完整联调。

## 瑞幸点单流程

1. 点击「连接瑞幸」，输入自己已获授权的瑞幸账号连接码。
2. 连接成功后查询官方饮品与可选规格，并核对当前自取门店。
3. 查看官方报价，确认门店、规格、数量和金额。
4. 点击确认创建订单，再到瑞幸返回的官方支付入口完成付款。
5. 返回页面查询官方订单状态和取餐信息。

商品、库存、优惠、价格、订单及取餐信息以官方返回为准。创建订单需由用户确认，项目不会代替用户付款。浏览器未提供定位或定位未成功时，不能把预设门店当成用户真实位置；下单前应核对门店。品牌聚合入口不表示已经接入该品牌的真实查询、下单或支付能力。

瑞幸连接码只用于当前后端进程的连接，点击断开或停止后端后需重新连接。不要将连接码、支付链接、真实订单缓存或取餐信息加入提交、截图或共享文件。

## 登录、偏好与语音

微信、支付宝按钮通过 Python 后端进行 OAuth 授权；配置未完成时显示未开通状态。仅有按钮和模拟测试通过，不代表平台审核或真实账号登录已完成。接入变量、回调、会话和验证范围见 [登录接入说明](docs/登录接入.md)。

`.env.example` 是空配置模板。应用从进程环境读取配置，不会自动加载 `.env`。需要支付宝登录时安装可选依赖：

```sh
python3 -m pip install -r requirements-auth.txt
```

饮品偏好、预算和长辈模式保存在当前浏览器的本地存储中，可在页面修改或清除。语音输入取决于浏览器语音识别支持和麦克风授权，文字输入也可使用。仓库中的 `location.js`、`coordinates.js` 和 `recommendations.js` 提供定位、坐标转换和偏好排序模块；具体页面是否启用这些模块，以当前前端接入为准。

## 源码结构

```text
agent-mall-one/
├── app.py                       本机 HTTP 服务和瑞幸 MCP 连接
├── auth.py                      微信、支付宝 OAuth 与会话
├── ocp_catalog.py               本地 OCP 服务目录
├── requirements-auth.txt       支付宝登录的可选依赖
├── Dockerfile                  云模式容器构建说明
├── render.yaml                 Render 单实例配置
├── .dockerignore               容器构建范围
├── .env.example                空环境配置模板
├── 启动.command                macOS 启动入口
├── github-pages-release/       可展示的独立静态前端
├── static/
│   ├── index.html              页面结构
│   ├── style.css               页面样式
│   ├── app.js                  主交互与点单流程
│   ├── auth-ui.js              登录界面
│   ├── location.js             会话定位与附近门店模块
│   ├── coordinates.js          WGS84 到 GCJ-02 转换
│   ├── recommendations.js      基于偏好和本机行为的排序模块
│   └── assets/brands/          页面使用的品牌素材
├── tests/                      Python 与 JavaScript 测试
└── docs/
    ├── 登录接入.md             登录配置与验证边界
    └── 品牌素材来源.json       品牌素材来源与校验值
```

本地 OCP 目录是手工定义的演示服务入口目录，商品、库存和价格仍通过授权后的瑞幸官方 MCP 实时查询。

## 验证

在项目目录运行后端测试：

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
```

已安装 Node.js 时，可运行推荐模块测试：

```sh
node --test tests/recommendations.test.js
```

这些测试使用模拟响应和临时数据。测试通过验证相应代码行为，不能替代瑞幸、微信、支付宝真实账号及支付流程的联调。

## 发布内容与素材来源

提交源码前请检查暂存文件。`.gitignore` 排除了 `static/current-order.json`、真实订单和付款目录、`references/` 本地归档、`demo-video-*/` 采集素材，以及未纳入公开范围的本地文档和截图；保留的两份 `docs/` 文件已经按可复用技术说明及素材来源整理。忽略规则不会清除已经进入 Git 历史的内容，也不会保护通过浏览器手动上传的文件，因此应始终按公开文件范围上传。

品牌名称、商标与图标归对应权利人所有，素材来源见 [品牌素材来源记录](docs/品牌素材来源.json)。页面中的品牌入口用于识别相应官方服务。
