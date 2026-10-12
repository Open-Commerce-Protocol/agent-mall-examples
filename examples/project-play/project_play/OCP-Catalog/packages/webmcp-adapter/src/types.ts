export type WebMcpToolHandler<TInput = unknown, TResult = unknown> = (input: TInput) => TResult | Promise<TResult>;

export type WebMcpTool<TInput = unknown, TResult = unknown> = {
  name: string;
  description: string;
  inputSchema?: unknown;
  handler: WebMcpToolHandler<TInput, TResult>;
};

export type WebMcpToolRegistration = {
  unregister: () => void;
};

export type WebMcpRuntime = {
  readonly isAvailable: boolean;
  registerTool: <TInput = unknown, TResult = unknown>(
    tool: WebMcpTool<TInput, TResult>,
  ) => WebMcpToolRegistration;
  registerTools: (tools: readonly WebMcpTool[]) => WebMcpToolRegistration;
  cleanup: () => void;
};

export type WebMcpHost = {
  registerTool?: unknown;
  unregisterTool?: unknown;
};

export type WebMcpRuntimeOptions = {
  host?: WebMcpHost | null;
};
