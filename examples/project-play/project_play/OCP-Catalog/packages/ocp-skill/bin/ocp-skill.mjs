#!/usr/bin/env node
// Standalone installer for the OCP Catalog agent skill.
//
// This runs under a bare `npx` with no dependencies and no Bun, so it cannot
// reuse packages/ocp-cli/src/skill-installer.ts (Bun/TypeScript). It
// deliberately mirrors that module's semantics: atomic replace via a temp
// directory, backup + rollback on failure, a sha256 content hash, and a
// managed-install marker so we never clobber a skill we did not write.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_NAME = 'ocp-catalog';
const MARKER = '.ocp-skill-install.json';
const PACKAGE_NAME = '@ocp-catalog/skill';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `
${PACKAGE_NAME} — install the OCP Catalog agent skill

Usage
  npx ${PACKAGE_NAME} [command] [options]

Commands
  install     Install the skill (default)
  update      Alias for install; replaces an existing managed install
  uninstall   Remove a managed install
  doctor      Report where the skill is installed

Options
  --agent <claude|codex|agents|all>   Which agent's skills directory to target
  --target <same as --agent, or a path>
  --scope <user|project>              user = home directory (default), project = ./
  --dir <path>                        Explicit skills directory; overrides the above
  --force                             Replace/remove even an unmanaged skill
  --dry-run                           Print the plan without touching the disk
  --json                              Machine-readable output
  -h, --help                          Show this help

Examples
  npx ${PACKAGE_NAME}                          # auto-detect and install
  npx ${PACKAGE_NAME} --agent claude           # ~/.claude/skills
  npx ${PACKAGE_NAME} --agent all              # every known agent
  npx ${PACKAGE_NAME} --scope project          # ./.claude/skills in this repo
  npx ${PACKAGE_NAME} doctor
`.trimStart();

function homeDir() {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

function claudeSkillsDir() {
  return process.env.CLAUDE_CONFIG_DIR
    ? path.join(process.env.CLAUDE_CONFIG_DIR, 'skills')
    : path.join(homeDir(), '.claude', 'skills');
}

function codexSkillsDir() {
  return process.env.CODEX_HOME
    ? path.join(process.env.CODEX_HOME, 'skills')
    : path.join(homeDir(), '.codex', 'skills');
}

function agentsSkillsDir() {
  return path.join(homeDir(), '.agents', 'skills');
}

function parseArgs(argv) {
  const options = { command: 'install', flags: {} };
  const commands = new Set(['install', 'update', 'uninstall', 'doctor']);
  const rest = [...argv];

  if (rest[0] && !rest[0].startsWith('-')) {
    const candidate = rest.shift();
    if (!commands.has(candidate)) {
      throw new Error(`Unknown command: ${candidate}. Expected one of ${[...commands].join(', ')}.`);
    }
    options.command = candidate;
  }

  const valueFlags = new Set(['agent', 'target', 'scope', 'dir']);
  const boolFlags = new Set(['force', 'dry-run', 'json', 'help']);

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (arg === '-h') {
      options.flags.help = true;
      continue;
    }

    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const [rawName, inlineValue] = arg.slice(2).split(/=(.*)/s);

    if (boolFlags.has(rawName)) {
      options.flags[rawName] = true;
      continue;
    }

    if (!valueFlags.has(rawName)) {
      throw new Error(`Unknown option: --${rawName}`);
    }

    const value = inlineValue ?? rest[++index];
    if (!value) {
      throw new Error(`--${rawName} requires a value`);
    }
    options.flags[rawName] = value;
  }

  return options;
}

// Resolution order matches packages/ocp-cli: --dir wins, then --target, then
// the --scope/--agent compatibility pair, then auto-detection.
function resolveSkillsDirs(flags) {
  if (flags.dir) return [path.resolve(flags.dir)];

  const named = {
    claude: claudeSkillsDir,
    codex: codexSkillsDir,
    agents: agentsSkillsDir,
  };

  const selector = flags.target ?? flags.agent;

  if (flags.scope === 'project') {
    const dirName = selector === 'claude' || selector === undefined ? '.claude' : '.agents';
    return [path.join(process.cwd(), dirName, 'skills')];
  }

  if (selector === 'all') {
    return unique([claudeSkillsDir(), codexSkillsDir(), agentsSkillsDir()]);
  }

  if (selector && named[selector]) return [named[selector]()];

  // An explicit --target that is not a known name is treated as a path.
  if (flags.target) return [path.resolve(flags.target)];
  if (flags.agent) throw new Error(`Unknown --agent: ${flags.agent}. Expected claude, codex, agents, or all.`);

  return [autoDetectSkillsDir()];
}

// Prefer a directory the user already has. Claude Code comes first because
// that is the common case for this package; fall back to creating ~/.claude.
function autoDetectSkillsDir() {
  if (process.env.CLAUDE_CONFIG_DIR) return claudeSkillsDir();
  if (process.env.CODEX_HOME) return codexSkillsDir();

  for (const candidate of [claudeSkillsDir(), agentsSkillsDir(), codexSkillsDir()]) {
    if (existsSync(candidate)) return candidate;
  }

  for (const parent of [path.join(homeDir(), '.claude'), path.join(homeDir(), '.codex')]) {
    if (existsSync(parent)) return path.join(parent, 'skills');
  }

  return claudeSkillsDir();
}

function unique(items) {
  return [...new Set(items.map((item) => path.resolve(item)))];
}

function installDirFor(skillsDir) {
  const resolved = path.resolve(skillsDir);
  return path.basename(resolved) === SKILL_NAME ? resolved : path.join(resolved, SKILL_NAME);
}

function classify(skillsDir) {
  const normalized = skillsDir.replaceAll('\\', '/');
  if (normalized.endsWith('/.claude/skills')) return 'claude';
  if (normalized.endsWith('/.codex/skills')) return 'codex';
  if (normalized.endsWith('/.agents/skills')) return 'agents';
  return 'custom';
}

function skillSourceDir() {
  const source = path.join(packageRoot, 'skill');
  if (!existsSync(path.join(source, 'SKILL.md'))) {
    throw new Error(
      `This ${PACKAGE_NAME} install is missing its skill payload (expected ${path.join(source, 'SKILL.md')}).`,
    );
  }
  return source;
}

async function copyDirectory(source, target) {
  await mkdir(target, { recursive: true });

  for (const entry of await readdir(source)) {
    if (entry === MARKER) continue;

    const sourcePath = path.join(source, entry);
    const targetPath = path.join(target, entry);
    const entryStat = await stat(sourcePath);

    if (entryStat.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
    } else if (entryStat.isFile()) {
      await copyFile(sourcePath, targetPath);
    }
  }
}

async function hashDirectory(sourceDir) {
  const hash = createHash('sha256');

  const walk = async (currentDir) => {
    for (const entry of (await readdir(currentDir)).sort()) {
      if (entry === MARKER) continue;

      const fullPath = path.join(currentDir, entry);
      const entryStat = await stat(fullPath);

      if (entryStat.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (entryStat.isFile()) {
        hash.update(path.relative(sourceDir, fullPath).replaceAll('\\', '/'));
        hash.update('\0');
        hash.update(await readFile(fullPath));
        hash.update('\0');
      }
    }
  };

  await walk(sourceDir);
  return hash.digest('hex');
}

async function readMarker(installDir) {
  try {
    return JSON.parse(await readFile(path.join(installDir, MARKER), 'utf8'));
  } catch {
    return undefined;
  }
}

// Refuse to touch a directory we did not create, unless forced. A skill hand
// written by the user must never be silently overwritten.
async function assertManaged(installDir, force, action) {
  if (force || !existsSync(installDir)) return;

  const marker = await readMarker(installDir);
  if (!marker || marker.skill_name !== SKILL_NAME) {
    throw new Error(`Refusing to ${action} unmanaged skill at ${installDir}. Re-run with --force if this is intentional.`);
  }
}

async function replaceDirectory(sourceDir, installDir) {
  const parentDir = path.dirname(installDir);
  await mkdir(parentDir, { recursive: true });

  const tempDir = await mkdtemp(path.join(parentDir, `.${SKILL_NAME}-new-`));
  const backupDir = `${installDir}.backup-${Date.now()}`;
  let hasBackup = false;

  try {
    await copyDirectory(sourceDir, tempDir);
    if (existsSync(installDir)) {
      await rename(installDir, backupDir);
      hasBackup = true;
    }
    await rename(tempDir, installDir);
    if (hasBackup) await rm(backupDir, { recursive: true, force: true });
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    if (hasBackup && !existsSync(installDir)) {
      await rename(backupDir, installDir);
    }
    throw error;
  }
}

async function packageVersion() {
  try {
    const pkg = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function install(skillsDirs, flags) {
  const sourceDir = skillSourceDir();
  const installDirs = skillsDirs.map(installDirFor);

  if (flags['dry-run']) {
    return { ok: true, action: 'install', dry_run: true, planned_install_dirs: installDirs };
  }

  const contentHash = await hashDirectory(sourceDir);
  const version = await packageVersion();
  const installed = [];

  for (const installDir of installDirs) {
    await assertManaged(installDir, flags.force, 'overwrite');
    await replaceDirectory(sourceDir, installDir);
    await writeFile(
      path.join(installDir, MARKER),
      `${JSON.stringify(
        {
          package_name: PACKAGE_NAME,
          package_version: version,
          skill_name: SKILL_NAME,
          content_hash: contentHash,
          installed_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    installed.push(installDir);
  }

  return { ok: true, action: 'install', dry_run: false, installed_dirs: installed };
}

async function uninstall(skillsDirs, flags) {
  const installDirs = skillsDirs.map(installDirFor);

  if (flags['dry-run']) {
    return { ok: true, action: 'uninstall', dry_run: true, planned_removals: installDirs };
  }

  const removed = [];
  for (const installDir of installDirs) {
    if (!existsSync(installDir)) continue;
    await assertManaged(installDir, flags.force, 'uninstall');
    await rm(installDir, { recursive: true, force: true });
    removed.push(installDir);
  }

  return { ok: true, action: 'uninstall', dry_run: false, removed_dirs: removed };
}

async function doctor(skillsDirs) {
  const targets = [];

  for (const skillsDir of skillsDirs) {
    const installDir = installDirFor(skillsDir);
    const marker = await readMarker(installDir);
    const installed = existsSync(installDir);

    targets.push({
      kind: classify(path.dirname(installDir)),
      skills_dir: path.dirname(installDir),
      install_dir: installDir,
      installed,
      valid: installed && existsSync(path.join(installDir, 'SKILL.md')),
      managed: Boolean(marker),
      ...(marker ? { marker } : {}),
    });
  }

  return { ok: true, action: 'doctor', skill_name: SKILL_NAME, targets };
}

function reportHuman(result) {
  if (result.action === 'doctor') {
    console.log(`OCP Catalog skill (${SKILL_NAME})`);
    for (const target of result.targets) {
      const state = target.valid
        ? `installed${target.managed ? '' : ' (unmanaged)'}`
        : target.installed
          ? 'present but missing SKILL.md'
          : 'not installed';
      console.log(`  [${target.kind}] ${target.install_dir} — ${state}`);
    }
    return;
  }

  if (result.dry_run) {
    const dirs = result.planned_install_dirs ?? result.planned_removals ?? [];
    console.log(`Dry run — would ${result.action}:`);
    for (const dir of dirs) console.log(`  ${dir}`);
    return;
  }

  if (result.action === 'uninstall') {
    if (result.removed_dirs.length === 0) {
      console.log('Nothing to remove.');
      return;
    }
    for (const dir of result.removed_dirs) console.log(`Removed ${dir}`);
    return;
  }

  for (const dir of result.installed_dirs) {
    console.log(`Installed the OCP Catalog skill to ${dir}`);
  }
  console.log('\nRestart your agent (or start a new session) to pick it up.');
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (flags.help) {
    console.log(USAGE);
    return;
  }

  const skillsDirs = resolveSkillsDirs(flags);

  const result =
    command === 'doctor'
      ? await doctor(skillsDirs)
      : command === 'uninstall'
        ? await uninstall(skillsDirs, flags)
        : await install(skillsDirs, flags);

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    reportHuman(result);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
