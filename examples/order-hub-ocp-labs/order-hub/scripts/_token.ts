/**
 * 取瑞幸 token 的统一入口——**不写死任何个人目录**，这样别人 clone 后也能跑。
 *
 * 优先级：
 *   1. 环境变量 `LUCKIN_TOKEN`（最直接，适合 CI）
 *   2. 环境变量 `LUCKIN_TOKEN_FILE` 指向的文件里找 `Authorization: Bearer <token>`
 *   3. 默认 DSH 配置路径（`~/.dsh/profiles/desktop/cordis.patch.yml`）
 *
 * 验收脚本只在需要真实菜单的用例里用它；没有 token 时会给出清楚的三种提供方式，
 * 而不是抛一个看不懂的 ENOENT。
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function luckinToken(): string {
  const inline = process.env.LUCKIN_TOKEN;
  if (inline !== undefined && inline.trim() !== '') return inline.trim();

  const file = process.env.LUCKIN_TOKEN_FILE ?? join(homedir(), '.dsh', 'profiles', 'desktop', 'cordis.patch.yml');
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    throw new Error(
      '没有可用的瑞幸 token。请任选一种方式提供：\n' +
        '  1) export LUCKIN_TOKEN=<你的 token>\n' +
        '  2) export LUCKIN_TOKEN_FILE=<含 "Authorization: Bearer <token>" 的文件>\n' +
        `  3) 把 token 写进 ${file}\n` +
        `（当前尝试读取的是：${file}）`,
    );
  }

  const match = /Authorization:\s*Bearer\s+(\S+)/.exec(raw) ?? /^\s*token:\s*(\S+)/m.exec(raw);
  if (match === null) throw new Error(`${file} 里没找到 "Authorization: Bearer <token>"`);
  return match[1] as string;
}
