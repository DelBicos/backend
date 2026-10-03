#!/usr/bin/env node
// Generates every agent instruction file from .agents/rules/*.md.
//
//   node scripts/rules/sync.mjs                    write generated files, remove orphans
//   node scripts/rules/sync.mjs --check            fail if generated files differ from the source
//   node scripts/rules/sync.mjs --enforce          sync, then quarantine local instruction files (git hooks)
//   node scripts/rules/sync.mjs --check-added REF  fail if the diff REF...HEAD adds instruction files
//                                                  outside the rules system, plan documents or logs
//
// Node 18+, built-in modules only, so it runs the same on Windows, macOS and Linux.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_DIR = '.agents/rules';
const MANAGED_DIRS = ['.claude/rules', '.cursor/rules', '.github/instructions'];

// Claude Code and Copilot have no "model decision" trigger, so the overlay is
// scoped to the source tree there.
const MODEL_DECISION_GLOBS = ['src/**'];

const SIZE_LIMITS = { '00': 6144, '01': 8192 };
const LAYER_SIZE_LIMIT = 3072;
const ALLOWED_KEYS = new Set(['description', 'trigger', 'globs', 'alwaysApply']);

const DENY_EDIT = [
  '/.agents/**',
  '/AGENTS.md',
  '/CLAUDE.md',
  '/.claude/rules/**',
  '/.claude/settings.json',
  '/.cursor/rules/**',
  '/.github/copilot-instructions.md',
  '/.github/instructions/**',
  '/.github/CODEOWNERS',
  '/.github/workflows/rules.yml',
  '/.husky/**',
  '/scripts/rules/**',
  '/src/__tests__/codeQuality.test.ts',
];
const DENY_EDIT_IF_PRESENT = ['/eslint.config.js'];

const INSTRUCTION_FILE_NAMES = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'AGENTS.override.md',
  'CLAUDE.local.md',
  'GEMINI.md',
  '.cursorrules',
  '.windsurfrules',
  '.clinerules',
  'copilot-instructions.md',
]);
const ROOT_LOCAL_INSTRUCTION_FILES = [
  'CLAUDE.local.md',
  'AGENTS.override.md',
  'GEMINI.md',
  '.cursorrules',
  '.windsurfrules',
  '.clinerules',
];
const AGENT_CONFIG_DIRS = [
  '.agents/',
  '.claude/',
  '.cursor/',
  '.github/instructions/',
  '.github/prompts/',
  '.clinerules/',
  '.windsurf/',
  '.codex/',
];
const WALK_SKIP = new Set([
  'node_modules',
  '.git',
  'ios',
  'android',
  'dist',
  'build',
  'coverage',
  '.expo',
  'web-build',
]);
const PLAN_NAME = /(^|[^a-z])(plan|plano|planos|continuar|handoff|hand-off)([^a-z]|$)/i;

const toPosix = (p) => p.split(path.sep).join('/');
const abs = (rel) => path.join(ROOT, ...rel.split('/'));
const normalize = (text) => text.replace(/\r\n/g, '\n');

class RulesError extends Error {}

function readSources() {
  const dir = abs(SOURCE_DIR);
  if (!fs.existsSync(dir)) throw new RulesError(`${SOURCE_DIR}/ not found`);

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const nested = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  if (nested.length) {
    throw new RulesError(
      `${SOURCE_DIR}/ must not contain folders (Antigravity ignores them): ${nested.join(', ')}`,
    );
  }

  const files = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
  const others = files.filter((f) => !f.endsWith('.md'));
  if (others.length) throw new RulesError(`only .md files belong in ${SOURCE_DIR}/: ${others.join(', ')}`);

  const sources = files.map((file) => parseSource(file, fs.readFileSync(path.join(dir, file), 'utf8')));
  validateSet(sources);
  return sources;
}

function parseSource(file, raw) {
  const where = `${SOURCE_DIR}/${file}`;
  const text = normalize(raw);
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new RulesError(`${where}: missing frontmatter`);

  const meta = {};
  for (const line of match[1].split('\n')) {
    if (!line.trim()) continue;
    const kv = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (!kv) throw new RulesError(`${where}: invalid frontmatter line "${line}"`);
    if (!ALLOWED_KEYS.has(kv[1])) throw new RulesError(`${where}: unknown frontmatter key "${kv[1]}"`);
    let value = kv[2].trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    meta[kv[1]] = value;
  }

  const name = file.replace(/\.md$/, '');
  const tier = name.slice(0, 2);
  const body = match[2].replace(/^\n+/, '').replace(/\s+$/, '') + '\n';
  const globs = (meta.globs || '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);
  const source = { file, name, tier, meta, body, globs, bytes: Buffer.byteLength(text) };
  validateSource(source, where);
  return source;
}

function validateSource(s, where) {
  if (!/^0[0-4]-[a-z0-9]+(-[a-z0-9]+)*$/.test(s.name)) {
    throw new RulesError(`${where}: name must match 0N-name.md (N from 0 to 4, lowercase, hyphens)`);
  }
  if (!s.meta.description) throw new RulesError(`${where}: description is required`);
  if (s.meta.alwaysApply !== 'false') throw new RulesError(`${where}: alwaysApply must be false`);
  if (!s.body.trim()) throw new RulesError(`${where}: body is empty`);

  if (s.tier === '00') {
    if (s.name !== '00-core') throw new RulesError(`${where}: the only tier 00 file is 00-core.md`);
    if (s.meta.trigger !== 'manual') throw new RulesError(`${where}: trigger must be manual`);
  } else if (s.tier === '01') {
    if (s.name !== '01-overlay') throw new RulesError(`${where}: the only tier 01 file is 01-overlay.md`);
    if (s.meta.trigger !== 'model_decision') throw new RulesError(`${where}: trigger must be model_decision`);
  } else if (s.meta.trigger !== 'glob') {
    throw new RulesError(`${where}: trigger must be glob`);
  }

  if (s.tier === '00' || s.tier === '01') {
    if (s.globs.length) throw new RulesError(`${where}: globs are only for tiers 02 to 04`);
  } else if (!s.globs.length) {
    throw new RulesError(`${where}: globs is required`);
  }

  const limit = SIZE_LIMITS[s.tier] ?? LAYER_SIZE_LIMIT;
  if (s.bytes > limit) throw new RulesError(`${where}: ${s.bytes} bytes, limit is ${limit}`);
}

function validateSet(sources) {
  if (!sources.some((s) => s.name === '00-core')) throw new RulesError(`${SOURCE_DIR}/00-core.md is required`);
  if (!sources.some((s) => s.name === '01-overlay')) throw new RulesError(`${SOURCE_DIR}/01-overlay.md is required`);
}

const generatedHeader = (s) =>
  `<!-- GENERATED from ${SOURCE_DIR}/${s.file} by scripts/rules/sync.mjs. Do not edit. -->`;

function scopedGlobs(s) {
  return s.tier === '01' ? MODEL_DECISION_GLOBS : s.globs;
}

function build(sources) {
  const out = new Map();
  const core = sources.find((s) => s.name === '00-core');
  const scoped = sources.filter((s) => s.tier !== '00');

  out.set(
    'AGENTS.md',
    [
      generatedHeader(core),
      '',
      core.body.trimEnd(),
      '',
      '---',
      '',
      'Path-scoped rules live in `.agents/rules/` and are delivered by your tool when you work on matching files.',
      'Generated instruction files are never edited by hand: humans change `.agents/rules/` and run `npm run rules:sync`.',
      '',
    ].join('\n'),
  );
  out.set('CLAUDE.md', `${generatedHeader(core)}\n@AGENTS.md\n`);
  out.set('.github/copilot-instructions.md', `${generatedHeader(core)}\n\n${core.body}`);

  for (const s of scoped) {
    const globs = scopedGlobs(s);

    out.set(
      `.claude/rules/${s.name}.md`,
      ['---', 'paths:', ...globs.map((g) => `  - "${g}"`), '---', generatedHeader(s), '', s.body].join('\n'),
    );

    out.set(
      `.cursor/rules/${s.name}.mdc`,
      [
        '---',
        `description: ${s.meta.description}`,
        `globs: ${s.tier === '01' ? '' : s.globs.join(', ')}`.trimEnd(),
        'alwaysApply: false',
        '---',
        generatedHeader(s),
        '',
        s.body,
      ].join('\n'),
    );

    out.set(
      `.github/instructions/${s.name}.instructions.md`,
      ['---', `applyTo: "${globs.join(',')}"`, '---', generatedHeader(s), '', s.body].join('\n'),
    );
  }

  const deny = [...DENY_EDIT, ...DENY_EDIT_IF_PRESENT.filter((p) => fs.existsSync(abs(p.slice(1))))];
  out.set(
    '.claude/settings.json',
    JSON.stringify({ permissions: { deny: deny.map((p) => `Edit(${p})`) } }, null, 2) + '\n',
  );

  return out;
}

function listFiles(relDir) {
  const dir = abs(relDir);
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...listFiles(rel));
    else found.push(rel);
  }
  return found;
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function trackedFiles() {
  const output = git(['ls-files', '-z']);
  return new Set(output ? output.split('\0').filter(Boolean) : []);
}

function createQuarantine() {
  const gitDir = git(['rev-parse', '--absolute-git-dir']);
  if (!gitDir) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(gitDir.trim(), 'rules-quarantine', stamp);
  const moved = [];
  return {
    moved,
    target,
    move(rel) {
      const destination = path.join(target, ...rel.split('/'));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.renameSync(abs(rel), destination);
      moved.push(rel);
    },
  };
}

function writeOutputs(expected, tracked, quarantine) {
  const written = [];
  for (const [rel, content] of expected) {
    const file = abs(rel);
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (current === content) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    written.push(rel);
  }

  const removed = [];
  for (const dir of MANAGED_DIRS) {
    for (const rel of listFiles(dir)) {
      if (expected.has(rel)) continue;
      if (!tracked.has(rel) && quarantine) {
        quarantine.move(rel);
      } else {
        fs.rmSync(abs(rel));
        removed.push(rel);
      }
    }
  }
  return { written, removed };
}

function walkInstructionFiles(relDir = '') {
  const dir = relDir ? abs(relDir) : ROOT;
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (WALK_SKIP.has(entry.name)) continue;
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === '.clinerules') found.push(rel);
      else found.push(...walkInstructionFiles(rel));
    } else if (relDir && INSTRUCTION_FILE_NAMES.has(entry.name)) {
      found.push(rel);
    }
  }
  return found;
}

function quarantineUntrackedSources(tracked, quarantine) {
  for (const rel of listFiles('.agents').sort()) {
    if (!tracked.has(rel)) quarantine.move(rel);
  }
}

function quarantineLocalInstructions(expected, tracked, quarantine) {
  const candidates = new Set();
  for (const name of ROOT_LOCAL_INSTRUCTION_FILES) {
    if (fs.existsSync(abs(name)) && !tracked.has(name)) candidates.add(name);
  }
  for (const rel of walkInstructionFiles()) {
    if (!expected.has(rel) && !tracked.has(rel)) candidates.add(rel);
  }
  for (const rel of [...candidates].sort()) quarantine.move(rel);
}

function runSync({ enforce }) {
  const tracked = trackedFiles();
  const quarantine = createQuarantine();
  if (enforce && quarantine) quarantineUntrackedSources(tracked, quarantine);

  const expected = build(readSources());
  const { written, removed } = writeOutputs(expected, tracked, quarantine);
  if (enforce && quarantine) quarantineLocalInstructions(expected, tracked, quarantine);

  for (const rel of written) console.log(`rules: wrote ${rel}`);
  for (const rel of removed) console.log(`rules: removed ${rel}`);
  if (quarantine?.moved.length) {
    console.log(`rules: moved ${quarantine.moved.length} local instruction file(s) to ${quarantine.target}`);
    for (const rel of quarantine.moved) console.log(`  - ${rel}`);
  }
  if (!enforce && !written.length && !removed.length) console.log('rules: generated files are up to date');
}

function runCheck() {
  const expected = build(readSources());
  const problems = [];
  for (const [rel, content] of expected) {
    const file = abs(rel);
    if (!fs.existsSync(file)) problems.push(`missing: ${rel}`);
    else if (normalize(fs.readFileSync(file, 'utf8')) !== content) problems.push(`out of date: ${rel}`);
  }
  for (const dir of MANAGED_DIRS) {
    for (const rel of listFiles(dir)) {
      if (!expected.has(rel)) problems.push(`not generated from ${SOURCE_DIR}/: ${rel}`);
    }
  }
  if (problems.length) {
    for (const p of problems) console.error(`rules: ${p}`);
    console.error('rules: edit only .agents/rules/ and run `npm run rules:sync`.');
    process.exit(1);
  }
  console.log('rules: generated files match the source');
}

function forbiddenReason(rel, expected) {
  if (expected.has(rel)) return null;
  if (/^\.agents\/rules\/0[0-4]-[^/]+\.md$/.test(rel)) return null;
  const name = path.posix.basename(rel);
  if (INSTRUCTION_FILE_NAMES.has(name)) return 'agent instruction file outside the rules system';
  if (name.endsWith('.mdc')) return '.mdc rule outside the generated .cursor/rules/';
  if (AGENT_CONFIG_DIRS.some((dir) => rel.startsWith(dir))) return 'agent configuration outside the rules system';
  if (/\.log$/i.test(name)) return 'log file';
  if (/\.md$/i.test(name) && PLAN_NAME.test(name.replace(/\.md$/i, ''))) return 'plan or hand-off document';
  return null;
}

function runCheckAdded(ref) {
  if (!ref) throw new RulesError('--check-added needs a base ref, for example origin/stag');
  const output = git(['diff', '--name-only', '-z', '--diff-filter=AR', `${ref}...HEAD`]);
  if (output === null) throw new RulesError(`could not diff ${ref}...HEAD (fetch the base branch first)`);

  const expected = build(readSources());
  const violations = output
    .split('\0')
    .filter(Boolean)
    .map((rel) => [rel, forbiddenReason(rel, expected)])
    .filter(([, reason]) => reason);

  if (violations.length) {
    for (const [rel, reason] of violations) console.error(`rules: ${rel}: ${reason}`);
    console.error('rules: instructions for agents live only in .agents/rules/; plans and logs stay out of the repository.');
    process.exit(1);
  }
  console.log(`rules: no instruction files, plans or logs added since ${ref}`);
}

const args = process.argv.slice(2);
try {
  if (args[0] === '--check' && args.length === 1) runCheck();
  else if (args[0] === '--check-added' && args.length === 2) runCheckAdded(args[1]);
  else if (args[0] === '--enforce' && args.length === 1) runSync({ enforce: true });
  else if (args.length === 0) runSync({ enforce: false });
  else throw new RulesError('usage: sync.mjs [--check | --enforce | --check-added <ref>]');
} catch (error) {
  if (!(error instanceof RulesError)) throw error;
  console.error(`rules: ${error.message}`);
  // Git hooks must never block a pull or checkout; the CI check is the gate.
  process.exit(args[0] === '--enforce' ? 0 : 1);
}
