# OCP Agent X-Ray 演示包

本包包含 X-Ray 完整源码、构建好的前端、所需 OCP SDK/Schema 源码及构建产物、最小示例 Catalog 和测试。源码来自本地提交 `4b0a801`，保留 MIT 许可证。根 package.json 为独立演示包整理，原仓库未修改。

## 启动

需要 Bun。解压后在本目录执行：

```sh
bun install
bun start
```

打开 http://127.0.0.1:4410。前端已构建，不必先重新构建。首次安装依赖需要网络，安装完成后的 Demo 可离线运行。包内不含 node_modules、环境配置、认证数据或本地诊断记录。

## 30 秒演示

1. 点击 Run scenario，查看 USD 199 的耳机和四步协议调用，点击节点切换 Request / Response。
2. 选择 missing data 故障样例并重新运行，看到价格与动作入口两个问题。
3. 点击 Generate Fix for Coding Agent，复制修复任务或下载 report.json。
4. 点击 Apply fixture repair & rerun，查看失败项从 2 降为 0。此操作只移除本地 Fixture 故障并完整复测，不会修改远端 Catalog。

## Live

另开终端在本目录运行 `bun run catalog:start`。选择 Live，Manifest 使用 `http://localhost:4400/ocp/manifest`。其他 Catalog 需要通过 `X_RAY_CATALOG_ORIGINS` 明确允许对应来源，详见 `apps/agent-x-ray/README.md`。

## 开发与验证

```sh
bun run typecheck
bun test
bun run xray:build
```

界面开发可在服务启动后另开终端执行 `bun run xray:ui`，访问 http://127.0.0.1:5174。

当前规划器为明确标注的确定性规则，没有接入 LLM；Discovery 是直接读取 Manifest，没有执行 Registration 搜索。完整协议说明、能力边界和原仓库验证记录位于 `apps/agent-x-ray/README.md` 和 `VALIDATION.md`。
