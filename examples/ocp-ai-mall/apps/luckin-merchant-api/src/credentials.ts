import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { LUCKIN_MCP_ENDPOINT } from '@ocp-catalog/luckin-adapter';

/** Server-only credential import. Do not log the parsed config or validation error. */
export async function loadLuckinCredential(configPath?: string): Promise<string> {
  if (!configPath) {
    const token = process.env.LUCKIN_MCP_TOKEN;
    if (!token) throw new Error('Set LUCKIN_MCP_TOKEN or --config <project config path>');
    return token;
  }
  try {
    const config = z.object({ mcp_servers: z.record(z.string(), z.object({
      url: z.string().optional(), enabled: z.boolean().optional(), bearer_token_env_var: z.string().optional(),
      http_headers: z.record(z.string(), z.string()).optional(),
    }).passthrough()) }).parse(Bun.TOML.parse(await readFile(configPath, 'utf8')));
    const server = config.mcp_servers['my-coffee'];
    if (!server || server.url !== LUCKIN_MCP_ENDPOINT || server.enabled === false) throw new Error();
    const token = server.bearer_token_env_var ? process.env[server.bearer_token_env_var]
      : (server.http_headers?.Authorization ?? server.http_headers?.authorization)?.replace(/^Bearer\s+/i, '');
    if (!token || /[\r\n]/.test(token)) throw new Error();
    return token;
  } catch { throw new Error('Unable to load my-coffee credential binding; config contents withheld'); }
}
