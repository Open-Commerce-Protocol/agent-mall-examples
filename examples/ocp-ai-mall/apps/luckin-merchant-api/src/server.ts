import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { FixtureLuckinPort, LuckinLiveRead, LuckinMcpProbe } from '@ocp-catalog/luckin-adapter';
import { LuckinWorkflow } from '@ocp-catalog/luckin-integration';
import { createLuckinHandler } from './service';
import { loadLuckinCredential } from './credentials';

const args = process.argv.slice(2);
const value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const mode = value('--mode') ?? 'fixture';
if (!['fixture', 'readonly'].includes(mode)) throw new Error('Only fixture and readonly modes are supported');
const port = Number(value('--port') ?? '8790');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port');
const root = resolve(import.meta.dir, '../../..');
let fixture: { workflow: LuckinWorkflow; port: FixtureLuckinPort } | undefined;
let live: LuckinLiveRead | undefined;
if (mode === 'fixture') {
  const directory = resolve(root, '.codex-tmp/luckin-fixture');
  await mkdir(directory, { recursive: true });
  const upstream = new FixtureLuckinPort(resolve(directory, 'upstream.sqlite'));
  const workflow = new LuckinWorkflow(resolve(directory, 'workflow.sqlite'), upstream);
  workflow.newOrdersEnabled = process.env.LUCKIN_NEW_ORDERS !== 'disabled';
  fixture = { workflow, port: upstream };
} else {
  const token = await loadLuckinCredential(value('--config'));
  const probe = new LuckinMcpProbe(async () => token);
  await probe.inspect();
  live = new LuckinLiveRead(probe);
}
const origin = `http://127.0.0.1:${port}`;
const handler = createLuckinHandler({ origin, session: randomBytes(32).toString('hex'), csrf: randomBytes(32).toString('hex'),
  page: await readFile(resolve(import.meta.dir, '../public/index.html'), 'utf8'), script: await readFile(resolve(import.meta.dir, '../public/app.js'), 'utf8'), fixture, live });
const server = Bun.serve({ hostname: '127.0.0.1', port, fetch: handler });
console.log(`Luckin ${mode}: ${origin} — real order creation disabled`);
const stop = () => { server.stop(true); fixture?.workflow.close(); fixture?.port.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
