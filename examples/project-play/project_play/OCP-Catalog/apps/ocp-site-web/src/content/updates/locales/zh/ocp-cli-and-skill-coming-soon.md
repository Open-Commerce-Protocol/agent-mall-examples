CLI 把标准 OCP 工作流变成命令——发现、搜索、查看、查询、resolve——并且 help 和结果都返回结构化 JSON，因此 Agent 无需解析终端文本即可基于输出行动。

最有用的能力是基于 manifest 的请求校验：在查询发送前，CLI 会用 Catalog manifest 校验请求，拒绝不支持的 query pack、未知 filter 字段、非法分页或缺失的查询文本——让 Agent 传参更规范，把错误前移。

它现在已经作为 `@ocp-catalog/ocp-cli` 发布到 npm。可以用 `npm install -g @ocp-catalog/ocp-cli` 安装，也可以用 `npx @ocp-catalog/ocp-cli@latest` 直接运行，并把内置独立 skill 安装到你的 Agent。完整引导见文档「CLI 与 Skill」页面（/docs/cli-and-skill）。
