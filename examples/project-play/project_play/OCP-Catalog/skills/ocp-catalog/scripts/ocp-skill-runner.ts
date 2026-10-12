#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Candidate = {
  label: string;
  command: string;
  args: string[];
  shell?: boolean;
};

const args = process.argv.slice(2);
const skillRoot = fileURLToPath(new URL('..', import.meta.url));
const bundledCli = fileURLToPath(new URL('../assets/ocp-cli/index.js', import.meta.url));
const isWindows = process.platform === 'win32';

const commandExists = (command: string): boolean => {
  const probe = isWindows
    ? spawnSync('where.exe', [command], { stdio: 'ignore' })
    : spawnSync('sh', ['-c', `command -v ${JSON.stringify(command)}`], { stdio: 'ignore' });
  return probe.status === 0;
};

const candidates: Candidate[] = [];

if (process.env.OCP_CLI_COMMAND) {
  candidates.push({
    label: 'OCP_CLI_COMMAND',
    command: process.env.OCP_CLI_COMMAND,
    args,
    shell: true,
  });
}

if (process.env.OCP_CLI_BIN) {
  candidates.push({
    label: 'OCP_CLI_BIN',
    command: process.env.OCP_CLI_BIN,
    args,
    shell: isWindows,
  });
}

if (existsSync(bundledCli) && commandExists('bun')) {
  candidates.push({
    label: 'bundled skill CLI',
    command: 'bun',
    args: [bundledCli, ...args],
    shell: isWindows,
  });
}

if (commandExists('ocp')) {
  candidates.push({
    label: 'ocp from PATH',
    command: 'ocp',
    args,
    shell: isWindows,
  });
}

if (commandExists('bunx')) {
  candidates.push({
    label: 'bunx @ocp-catalog/ocp-cli',
    command: 'bunx',
    args: ['@ocp-catalog/ocp-cli', ...args],
    shell: isWindows,
  });
}

if (commandExists('npx')) {
  candidates.push({
    label: 'npx @ocp-catalog/ocp-cli',
    command: 'npx',
    args: ['-y', '@ocp-catalog/ocp-cli', ...args],
    shell: isWindows,
  });
}

if (candidates.length === 0) {
  console.error(
    [
      'No OCP CLI was found for this standalone skill.',
      `Skill root: ${skillRoot}`,
      'Install ocp on PATH, export the skill with its bundled CLI, or set OCP_CLI_COMMAND/OCP_CLI_BIN.',
    ].join('\n'),
  );
  process.exit(1);
}

const result = spawnSync(candidates[0].command, candidates[0].args, {
  stdio: 'inherit',
  shell: candidates[0].shell,
});

if (result.error) {
  console.error(`Failed to run OCP CLI via ${candidates[0].label}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
