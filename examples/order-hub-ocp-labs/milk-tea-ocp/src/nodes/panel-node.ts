/**
 * 演示面板的静态服务（4600）。
 *
 * 只服务 demo/index.html 一个文件，且每次请求都重新读盘——
 * 这样改面板刷新一下就能看到，不用重启节点。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { html, startServer } from '../lib/http.ts';

export const PANEL_PORT = 4600;
const PANEL_FILE = fileURLToPath(new URL('../../demo/index.html', import.meta.url));

export async function startPanelNode(): Promise<number> {
  await startServer(
    [
      {
        method: 'GET',
        path: '/',
        handler: () => html(readFileSync(PANEL_FILE, 'utf8')),
      },
    ],
    PANEL_PORT,
    'panel',
  );
  return PANEL_PORT;
}
