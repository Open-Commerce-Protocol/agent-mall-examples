import { fileURLToPath } from 'node:url';
import { createSpaStaticSiteHandler } from '@ocp-catalog/shared';
import { Elysia } from 'elysia';
import { loadSiteWebConfig } from './config';

const config = loadSiteWebConfig();
const ocpSite = createSpaStaticSiteHandler(fileURLToPath(new URL('../dist', import.meta.url)));

const app = new Elysia()
  .get('/health', () => ({
    ok: true,
    service: 'ocp-site-web',
  }))
  .get('/', () => serveSite('/'))
  .get('/*', async ({ request }) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/health') {
      return new Response('Not Found', { status: 404 });
    }

    return serveSite(pathname);
  })
  .listen(config.OCP_SITE_PORT);

console.log(`OCP site host listening on http://localhost:${app.server?.port}`);
if (!await ocpSite('/')) {
  console.log('OCP site host started without build output. Run `bun run --cwd apps/ocp-site-web build` first.');
}

async function serveSite(pathname: string) {
  const response = await ocpSite(pathname);
  return response ?? new Response('Not Found', { status: 404 });
}
