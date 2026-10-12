/**
 * MCP 工具结果的解包。
 *
 * 各品牌都把业务数据包成 `{code, msg, data}` 塞在 content[0].text 里
 * （瑞幸已实测；麦当劳官方文档未说明，故这里对两种形状都兼容）。
 */
export type McpToolResult = {
  content?: { type: string; text?: string }[];
  isError?: boolean;
};

export function unwrapData<T>(result: unknown): T {
  const typed = result as McpToolResult;
  const first = typed?.content?.[0];
  const text = first?.type === 'text' ? (first.text ?? '') : JSON.stringify(first ?? {});
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`品牌接口返回了无法解析的内容：${text.slice(0, 240)}`);
  }
  if (parsed !== null && typeof parsed === 'object' && 'code' in parsed && parsed.code !== 0) {
    throw new Error(`品牌接口业务失败 code=${parsed.code} msg=${parsed.msg ?? ''}`);
  }
  return (parsed?.data ?? parsed) as T;
}
