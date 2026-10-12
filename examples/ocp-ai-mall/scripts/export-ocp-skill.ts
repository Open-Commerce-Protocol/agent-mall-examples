#!/usr/bin/env bun
import { copyFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dir, '..');
const skillName = 'ocp-catalog';

type Options = {
  outDir: string;
  bundleCli: boolean;
};

const parseOptions = (): Options => {
  const args = process.argv.slice(2);
  const options: Options = {
    outDir: path.join(repoRoot, 'dist', 'skills'),
    bundleCli: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--out') {
      const next = args[index + 1];
      if (!next) {
        throw new Error('--out requires a directory path');
      }
      options.outDir = path.resolve(repoRoot, next);
      index += 1;
      continue;
    }

    if (arg === '--no-cli') {
      options.bundleCli = false;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: bun scripts/export-ocp-skill.ts [--out <directory>] [--no-cli]',
          '',
          'Exports skills/ocp-catalog as a standalone skill folder.',
          'By default it also bundles packages/ocp-cli into assets/ocp-cli/index.js.',
        ].join('\n'),
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
};

const copyDirectory = async (source: string, target: string): Promise<void> => {
  await mkdir(target, { recursive: true });
  const entries = await readdir(source);

  for (const entry of entries) {
    const sourcePath = path.join(source, entry);
    const targetPath = path.join(target, entry);
    const entryStat = await stat(sourcePath);

    if (entryStat.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
      continue;
    }

    if (entryStat.isFile()) {
      await copyFile(sourcePath, targetPath);
    }
  }
};

const buildBundledCli = async (targetSkillDir: string): Promise<void> => {
  const bundledCliPath = path.join(targetSkillDir, 'assets', 'ocp-cli', 'index.js');
  await mkdir(path.dirname(bundledCliPath), { recursive: true });

  const build = Bun.spawn(
    [
      process.execPath,
      'build',
      path.join(repoRoot, 'packages', 'ocp-cli', 'src', 'index.ts'),
      '--outfile',
      bundledCliPath,
      '--target',
      'bun',
    ],
    {
      cwd: repoRoot,
      stdout: 'inherit',
      stderr: 'inherit',
    },
  );

  const exitCode = await build.exited;
  if (exitCode !== 0) {
    throw new Error(`Failed to bundle OCP CLI, exit code ${exitCode}`);
  }
};

const assertStandaloneSkill = async (targetSkillDir: string): Promise<void> => {
  const forbiddenPatterns = [/packages\/ocp-cli/, /packages\\ocp-cli/, /bun packages\/ocp-cli/];
  const textExtensions = new Set(['.md', '.ts', '.yaml', '.yml', '.json']);
  const violations: string[] = [];

  const walk = async (currentDir: string): Promise<void> => {
    const entries = await readdir(currentDir);

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry);
      const relativePath = path.relative(targetSkillDir, fullPath);
      const entryStat = await stat(fullPath);

      if (relativePath.startsWith(`assets${path.sep}ocp-cli${path.sep}`)) {
        continue;
      }

      if (entryStat.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!textExtensions.has(path.extname(entry))) {
        continue;
      }

      const content = await readFile(fullPath, 'utf8');
      if (forbiddenPatterns.some((pattern) => pattern.test(content))) {
        violations.push(relativePath);
      }
    }
  };

  await walk(targetSkillDir);

  if (violations.length > 0) {
    throw new Error(
      [
        'Exported skill still references monorepo-local CLI paths:',
        ...violations.map((file) => `- ${file}`),
      ].join('\n'),
    );
  }
};

const main = async (): Promise<void> => {
  const options = parseOptions();
  const sourceSkillDir = path.join(repoRoot, 'skills', skillName);
  const targetSkillDir = path.join(options.outDir, skillName);

  await rm(targetSkillDir, { recursive: true, force: true });
  await copyDirectory(sourceSkillDir, targetSkillDir);

  if (options.bundleCli) {
    await buildBundledCli(targetSkillDir);
  }

  await assertStandaloneSkill(targetSkillDir);

  console.log(`Exported ${skillName} skill to ${targetSkillDir}`);
  console.log('Copy that folder into a Codex skills directory, or publish it as a release artifact.');
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
