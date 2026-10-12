import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

// The docs site is the only app that stays in the protocol repo, so it must not
// depend on @ocp-catalog/config (a heavy package that lives in the instances
// repo). This inlines the tiny .env + process.env merge it needs.
export type LoadEnvOptions = {
  includeDotEnv?: boolean;
};

function findUp(filename: string, startDir: string): string | null {
  let current = resolve(startDir);
  while (true) {
    const candidate = resolve(current, filename);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readDotEnv(startDir = process.cwd()): Record<string, string> {
  const file = findUp('.env', startDir);
  if (!file) return {};
  const values: Record<string, string> = {};
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const sep = line.indexOf('=');
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim();
    let value = line.slice(sep + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function loadEnv(
  env: Record<string, string | undefined> = process.env,
  options: LoadEnvOptions = {},
): Record<string, string | undefined> {
  return {
    ...(options.includeDotEnv === false ? {} : readDotEnv()),
    ...env,
  };
}

export const siteWebConfigSchema = z.object({
  OCP_SITE_PORT: z.coerce.number().int().min(1).max(65535).default(5173),
});

export type SiteWebConfig = z.infer<typeof siteWebConfigSchema>;

export function loadSiteWebConfig(
  env: Record<string, string | undefined> = process.env,
  options: LoadEnvOptions = {},
): SiteWebConfig {
  return siteWebConfigSchema.parse(loadEnv(env, options));
}
