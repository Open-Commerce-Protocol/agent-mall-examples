#!/usr/bin/env bun
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dir, '..');
const cliRoot = path.join(repoRoot, 'packages', 'ocp-cli');
const skillName = 'ocp-catalog';

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

const run = async (command: string[]): Promise<void> => {
  const child = Bun.spawn(command, {
    cwd: repoRoot,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${command.join(' ')} failed with exit code ${exitCode}`);
  }
};

await rm(path.join(cliRoot, 'dist'), { recursive: true, force: true });
await run([
  process.execPath,
  'build',
  path.join(cliRoot, 'src', 'index.ts'),
  '--outfile',
  path.join(cliRoot, 'dist', 'index.js'),
  '--target',
  'bun',
]);
await copyDirectory(
  path.join(repoRoot, 'skills', skillName),
  path.join(cliRoot, 'dist', 'skills', skillName),
);

console.log(`Built @ocp-catalog/ocp-cli with bundled ${skillName} skill`);
