/**
 * 起节点的辅助：端口被占用时视为"已有实例在跑"，直接复用。
 *
 * 这样验收脚本（probe / selfcheck）不必先关掉 npm start 起的全栈，
 * 也不会因为 EADDRINUSE 报出与规范无关的失败。
 */
import { startServer, type Route } from './http.ts';

export type StartOutcome = { reused: boolean };

export async function startOrReuse(routes: Route[], port: number, label: string): Promise<StartOutcome> {
  try {
    await startServer(routes, port, label);
    return { reused: false };
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'EADDRINUSE') {
      console.log(`[reuse] ${label} :${port} 已在运行，复用现有实例。`);
      return { reused: true };
    }
    throw error;
  }
}
