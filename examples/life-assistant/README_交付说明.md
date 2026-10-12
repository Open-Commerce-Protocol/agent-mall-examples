# 生活助手 · 完整源代码交付说明

交付日期：2026年10月11日。此包供主办方查看、复核与运行项目源码。解压后进入 `生活助手_完整源代码/`，项目根目录的 `README.md` 说明各模块与配置。

## 三种内容的运行范围

| 内容 | 入口与当前状态 |
|---|---|
| 独立静态网页 | `github-pages-release/index.html` 可双击或静态托管，展示生活服务入口、偏好和长辈模式；品牌入口可前往官方网站。真实瑞幸点单和平台登录尚未接入该静态页。 |
| 本地真实后端 | 在项目根目录运行 `python3 app.py`，打开 `http://127.0.0.1:8765/`。瑞幸功能需要使用者自己的授权连接码；查看官方报价后需确认创建订单，并在官方入口付款。包内没有真实订单、账号或支付资料。 |
| 云端部署准备 | 已含 `Dockerfile`、`.dockerignore`、`render.yaml` 与可选云模式代码。尚未连接 Render 账号、构建/上线容器或完成公网联调；当前前端还需传入云模式写请求要求的稳定 `idempotencyKey`。 |

GitHub Pages 只能托管静态页面，不能运行这里的 Python 后端。源码 ZIP 和云配置的交付不代表已经上线可用的云点单服务。

## 本地启动

需要 Python 3。macOS 可双击 `启动.command`，也可以在终端进入解压后的项目目录执行：

```sh
python3 app.py
```

Windows 可在 PowerShell 中执行：

```powershell
py -3 app.py
```

保持终端运行，结束时按 `Control + C` 停止服务。若端口占用，可运行 `python3 app.py --port 8766`，再打开对应地址。基础后端、瑞幸 MCP、微信 OAuth 使用 Python 标准库。支付宝 RSA2 登录需要可选依赖：

```sh
python3 -m pip install -r requirements-auth.txt
```

`.env.example` 只有空变量名。后端从进程环境读取配置，不会自动加载 `.env`。微信/支付宝真实登录还需要使用者完成平台应用审核、配置秘密与 HTTPS 回调；接入细节见 `docs/登录接入.md`。未配置时不会模拟真实登录成功。

## 云端使用前的必要接入

云模式按浏览器 Cookie 隔离瑞幸凭证和订单结果，并检查受信 HTTPS 来源。运行时读取 `CLOUD_MODE`、`HOST`、`PORT`、`PUBLIC_ORIGIN`；Render 可使用 `RENDER_EXTERNAL_URL`。当前部署配置是单实例，凭证、会话和幂等记录都在内存中，休眠或重启会丢失。再次连接后应先核查官方订单，避免重复提交。

尚需完成云账号部署、HTTPS 站点、前端稳定请求标识接入、微信/支付宝平台配置，以及真实瑞幸订单和支付流程的线上联调。本次交付不包含这些账号凭证或授权。

## 包内文件与排除范围

包内包含后端 `app.py`、`auth.py`、`ocp_catalog.py`，完整 `static/` 页面源码与品牌素材、`tests/`、可选依赖、空环境示例、macOS 启动入口、项目 README、容器与 Render 配置、Git 忽略规则、独立静态前端及两份公开技术/素材来源文档。

包内已排除 `static/current-order.json`、真实订单和付款截图、`references/` 本地参考归档、演示视频和采集资料、真实账号配置、备份、缓存、日志与系统元数据。品牌素材来源与校验值见 `docs/品牌素材来源.json`。

## 复核方式

后端测试在项目根目录运行：

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
```

推荐模块测试需要 Node.js：

```sh
node --test tests/recommendations.test.js
```

测试使用模拟响应、临时密钥和临时数据，不创建真实订单或付款。交付目录中的 `源码包校验记录.json` 和 `.sha256` 文件记录最终 ZIP 的 SHA-256、大小、文件清单和本次解压测试结果。
