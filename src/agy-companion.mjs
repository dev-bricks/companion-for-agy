#!/usr/bin/env node
/**
 * companion-for-agy — Unofficial PTY-based wrapper for agy (Antigravity CLI / Gemini CLI)
 *
 * Problem: agy's TUI text-drip renderer writes to the terminal buffer, not stdout.
 *          From subprocesses (Claude Code, Codex, CI/CD), no output is capturable.
 *          Additionally, GEMINI.md triggers a "first action" that consumes the
 *          single -p turn for session initialization.
 *
 * Solution: 1. node-pty creates a virtual terminal (ConPTY on Windows, forkpty on Unix)
 *           2. Interactive mode: wait for init, THEN send the actual question
 *           3. Extract response via ANSI color ([38;2;232;234;237m = response color)
 *           4. Fallback: line-based noise filtering
 *
 * Usage:
 *   agy-companion [options] "prompt"
 *   node src/agy-companion.mjs [options] "prompt"
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import { detectLocale, getMessage } from './locales.mjs';
import updateNotifier from 'update-notifier';

// ---------- Defaults ----------

export const DEFAULT_MODEL = 'gemini-3.5-flash';
export const DEFAULT_TIMEOUT_MS = 120000;
export const RESPONSE_IDLE_MS = 10000;
export const RESPONSE_DONE_IDLE_MS = 2500;
export const NO_RESPONSE_EXIT_CODE = 4;
export const SHUTDOWN_FORCE_KILL_MS = 2000;
export const SHUTDOWN_CLEANUP_DELAY_MS = 1000;
export const DEFAULT_RESPONSE_RGB = [232, 234, 237];
export const PTY_SMOKE_TEXT = 'PTY_SMOKE_OK';
export const LIVE_SMOKE_TEXT = 'AGY_LIVE_SMOKE_OK';
export const LIVE_SMOKE_EXIT_CODE = 5;
// Minimum new bytes required to justify resetting the idle timer (guards against 1-byte trickle loops)
export const RESPONSE_MIN_PROGRESS_BYTES = 10;
// If STARTUP_DONE_PATTERNS never fire (e.g. different agy version or language), proceed anyway after this delay
export const STARTUP_FALLBACK_MS = 30000;

// Pure helper — extracted for testability
export function shouldResetIdleTimer({ newLength, lastProgressLength, minProgressBytes, responseComplete, lastResponseComplete }) {
  if (responseComplete !== lastResponseComplete) {
    return true;
  }
  if (responseComplete) {
    return false;
  }
  return (newLength - lastProgressLength) >= minProgressBytes;
}

const require = createRequire(import.meta.url);
const PACKAGE_JSON_PATH = fileURLToPath(new URL('../package.json', import.meta.url));

// ---------- Response Color ----------

export function parseResponseRgb(value) {
  if (!value || typeof value !== 'string') return null;
  const parts = value.trim().split(/[;,]/).map(p => p.trim());
  if (parts.length !== 3) return null;
  const rgb = parts.map(p => Number.parseInt(p, 10));
  if (rgb.some(v => Number.isNaN(v) || v < 0 || v > 255)) return null;
  return rgb;
}

export function responseRgbToSgrParams(rgb) {
  return `38;2;${rgb[0]};${rgb[1]};${rgb[2]}`;
}

export function getResponseSgrParams() {
  const envRgb = parseResponseRgb(process.env.AGY_COMPANION_RESPONSE_RGB);
  return responseRgbToSgrParams(envRgb || DEFAULT_RESPONSE_RGB);
}

// ---------- Auto-Detection ----------

export function findAgyPath() {
  if (process.env.AGY_COMPANION_AGY_PATH) return process.env.AGY_COMPANION_AGY_PATH;
  if (process.env.AGY_PATH) return process.env.AGY_PATH;

  const agyName = process.platform === 'win32' ? 'agy.exe' : 'agy';

  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const result = execFileSync(cmd, [agyName], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const firstLine = result.split(/\r?\n/)[0].trim();
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
  } catch (_) {}

  if (process.platform === 'win32') {
    const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const candidate = path.join(localApp, 'agy', 'bin', 'agy.exe');
    if (fs.existsSync(candidate)) return candidate;
  } else {
    for (const p of [
      path.join(os.homedir(), '.local', 'bin', 'agy'),
      '/home/linuxbrew/.linuxbrew/bin/agy',
      '/usr/local/bin/agy',
      '/usr/bin/agy',
      '/opt/homebrew/bin/agy',
    ]) {
      if (fs.existsSync(p)) return p;
    }
  }

  return null;
}

export const AGY_PATH = findAgyPath();

export function parseSemverishVersion(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  return match ? match[0] : null;
}

export function versionSupportsModelFlag(version) {
  if (!version || typeof version !== 'string') return null;
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  if (Number.isNaN(major) || Number.isNaN(minor)) return null;
  if (major > 1) return true;
  if (major < 1) return false;
  return minor >= 1;
}

export function isExecutablePath(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  if (process.platform === 'win32') return true;
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

export function findNearestPackageRoot(startPath) {
  if (!startPath) return null;
  const initial = fs.existsSync(startPath) && fs.statSync(startPath).isDirectory()
    ? startPath
    : path.dirname(startPath);
  let current = initial;
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    current = path.dirname(current);
  }
  return null;
}

export function getNodePtyFallbackCandidates() {
  const geminiPtySuffix = path.join('@google', 'gemini-cli', 'node_modules', 'node-pty');
  const candidates = [];

  if (process.platform === 'win32' && process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', geminiPtySuffix));
  }
  try {
    const globalRoot = execSync('npm root -g', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (globalRoot) {
      candidates.push(path.join(globalRoot, geminiPtySuffix));
    }
  } catch (_) {
    // npm not available
  }

  return candidates;
}

export function resolveNodePtyModule(nodePtyOverride = process.env.AGY_COMPANION_PTY_PATH) {
  if (nodePtyOverride) {
    try {
      const resolvedPath = require.resolve(nodePtyOverride);
      return {
        ok: true,
        pty: require(nodePtyOverride),
        source: 'override',
        resolvedPath,
        packageRoot: findNearestPackageRoot(resolvedPath),
      };
    } catch (error) {
      return {
        ok: false,
        source: 'override',
        resolvedPath: nodePtyOverride,
        packageRoot: findNearestPackageRoot(nodePtyOverride),
        error,
      };
    }
  }

  try {
    const resolvedPath = require.resolve('node-pty');
    return {
      ok: true,
      pty: require('node-pty'),
      source: 'dependency',
      resolvedPath,
      packageRoot: path.dirname(require.resolve('node-pty/package.json')),
    };
  } catch (directError) {
    for (const candidate of getNodePtyFallbackCandidates()) {
      try {
        return {
          ok: true,
          pty: require(candidate),
          source: 'gemini-cli-bundled',
          resolvedPath: candidate,
          packageRoot: candidate,
        };
      } catch (_) {
        // try next candidate
      }
    }
    return {
      ok: false,
      source: 'dependency',
      resolvedPath: null,
      packageRoot: null,
      error: directError,
    };
  }
}

export function inspectNodePtyArtifacts(packageRoot, platform = process.platform, arch = process.arch) {
  if (!packageRoot) {
    return {
      packageRoot: null,
      prebuildDir: null,
      nativeBinaryPath: null,
      helperPath: null,
      helperExists: false,
      helperExecutable: null,
    };
  }

  const prebuildDir = path.join(packageRoot, 'prebuilds', `${platform}-${arch}`);
  const nativeCandidates = platform === 'win32'
    ? [
        path.join(prebuildDir, 'conpty.node'),
        path.join(prebuildDir, 'pty.node'),
        path.join(packageRoot, 'build', 'Release', 'conpty.node'),
        path.join(packageRoot, 'build', 'Release', 'pty.node'),
      ]
    : [
        path.join(prebuildDir, 'pty.node'),
        path.join(packageRoot, 'build', 'Release', 'pty.node'),
      ];
  const helperPath = platform === 'win32'
    ? null
    : [
        path.join(prebuildDir, 'spawn-helper'),
        path.join(packageRoot, 'build', 'Release', 'spawn-helper'),
      ].find(candidate => fs.existsSync(candidate)) || path.join(prebuildDir, 'spawn-helper');

  const nativeBinaryPath = nativeCandidates.find(candidate => fs.existsSync(candidate)) || null;
  const helperExists = helperPath ? fs.existsSync(helperPath) : false;

  return {
    packageRoot,
    prebuildDir,
    nativeBinaryPath,
    helperPath,
    helperExists,
    helperExecutable: helperExists ? isExecutablePath(helperPath) : null,
  };
}

export function detectAgyVersion(agyPath) {
  if (!agyPath || !fs.existsSync(agyPath)) {
    return { raw: null, version: null, supportsModelFlag: null, error: null };
  }

  try {
    const raw = execFileSync(agyPath, ['--version'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });
    const version = parseSemverishVersion(raw);
    return {
      raw: raw.trim(),
      version,
      supportsModelFlag: versionSupportsModelFlag(version),
      error: null,
    };
  } catch (error) {
    const combined = `${error.stdout || ''}\n${error.stderr || ''}`.trim();
    const version = parseSemverishVersion(combined);
    return {
      raw: combined || null,
      version,
      supportsModelFlag: versionSupportsModelFlag(version),
      error: error.message,
    };
  }
}

export function getPackageVersion() {
  try {
    return JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8')).version || null;
  } catch (_) {
    return null;
  }
}

export function collectDoctorReport() {
  const resolvedAgyPath = AGY_PATH;
  const nodePty = resolveNodePtyModule();
  const nodePtyArtifacts = inspectNodePtyArtifacts(nodePty.packageRoot);
  const agyExecutable = resolvedAgyPath ? isExecutablePath(resolvedAgyPath) : false;
  const agyVersion = detectAgyVersion(resolvedAgyPath);
  const configuredRgb = parseResponseRgb(process.env.AGY_COMPANION_RESPONSE_RGB) || DEFAULT_RESPONSE_RGB;
  const blockers = [];
  const warnings = [];

  if (!resolvedAgyPath) {
    blockers.push('agy binary not found');
  } else if (!fs.existsSync(resolvedAgyPath)) {
    blockers.push(`agy path does not exist: ${resolvedAgyPath}`);
  } else if (!agyExecutable) {
    blockers.push(`agy path is not executable: ${resolvedAgyPath}`);
  }

  if (!nodePty.ok) {
    blockers.push('node-pty could not be loaded');
  }

  if (resolvedAgyPath && fs.existsSync(resolvedAgyPath) && agyExecutable && !agyVersion.version) {
    warnings.push('agy version could not be detected; model-flag compatibility remains unknown');
  } else if (agyVersion.supportsModelFlag === false) {
    warnings.push('agy 1.0.x detected; prefer --no-model or AGY_COMPANION_NO_MODEL=1');
  }

  if (nodePty.ok && !nodePtyArtifacts.nativeBinaryPath) {
    warnings.push('node-pty native binary could not be located under prebuild/build paths');
  }

  if (process.platform !== 'win32' && nodePty.ok) {
    if (!nodePtyArtifacts.helperExists) {
      warnings.push('node-pty spawn-helper not found in expected prebuild/build paths');
    } else if (!nodePtyArtifacts.helperExecutable) {
      blockers.push(`node-pty spawn-helper is not executable: ${nodePtyArtifacts.helperPath}`);
    }
  }

  return {
    tool: 'companion-for-agy',
    toolVersion: getPackageVersion(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    agy: {
      path: resolvedAgyPath,
      exists: Boolean(resolvedAgyPath && fs.existsSync(resolvedAgyPath)),
      executable: resolvedAgyPath ? agyExecutable : false,
      version: agyVersion.version,
      versionRaw: agyVersion.raw,
      supportsModelFlag: agyVersion.supportsModelFlag,
      error: agyVersion.error,
    },
    nodePty: {
      loadable: nodePty.ok,
      source: nodePty.source,
      resolvedPath: nodePty.resolvedPath,
      packageRoot: nodePty.packageRoot,
      error: nodePty.error ? nodePty.error.message : null,
      nativeBinaryPath: nodePtyArtifacts.nativeBinaryPath,
      helperPath: nodePtyArtifacts.helperPath,
      helperExists: nodePtyArtifacts.helperExists,
      helperExecutable: nodePtyArtifacts.helperExecutable,
    },
    responseColor: {
      rgb: configuredRgb,
      sgrParams: responseRgbToSgrParams(configuredRgb),
    },
    blockers,
    warnings,
    status: blockers.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'ok',
  };
}

export function buildPtySmokeCommand({
  platform = process.platform,
  responseColorParams = getResponseSgrParams(),
  responseText = PTY_SMOKE_TEXT,
} = {}) {
  if (platform === 'win32') {
    const payload = `\x1b[${responseColorParams}m${responseText}\x1b[0m\n`;
    return {
      command: process.execPath,
      args: ['-e', `process.stdout.write(${JSON.stringify(payload)})`],
      description: 'node truecolor stdout',
    };
  }

  return {
    command: '/bin/sh',
    args: ['-lc', `printf '\\033[${responseColorParams}m${responseText}\\033[0m\\n'`],
    description: '/bin/sh truecolor printf',
  };
}

function finalizePtySmokeReport(report) {
  report.status = report.blockers.length > 0 ? 'fail' : report.warnings.length > 0 ? 'warn' : 'ok';
  return report;
}

export async function collectPtySmokeReport({ timeoutMs = 10000 } = {}) {
  const nodePty = resolveNodePtyModule();
  const nodePtyArtifacts = inspectNodePtyArtifacts(nodePty.packageRoot);
  const configuredRgb = parseResponseRgb(process.env.AGY_COMPANION_RESPONSE_RGB) || DEFAULT_RESPONSE_RGB;
  const responseColorParams = responseRgbToSgrParams(configuredRgb);
  const command = buildPtySmokeCommand({ responseColorParams });
  const report = {
    tool: 'companion-for-agy',
    toolVersion: getPackageVersion(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    nodePty: {
      loadable: nodePty.ok,
      source: nodePty.source,
      resolvedPath: nodePty.resolvedPath,
      packageRoot: nodePty.packageRoot,
      error: nodePty.error ? nodePty.error.message : null,
      nativeBinaryPath: nodePtyArtifacts.nativeBinaryPath,
      helperPath: nodePtyArtifacts.helperPath,
      helperExists: nodePtyArtifacts.helperExists,
      helperExecutable: nodePtyArtifacts.helperExecutable,
    },
    responseColor: {
      rgb: configuredRgb,
      sgrParams: responseColorParams,
    },
    smoke: {
      command: command.command,
      args: command.args,
      description: command.description,
      expectedText: PTY_SMOKE_TEXT,
      extractedText: null,
      rawBytes: 0,
      exitCode: null,
      timedOut: false,
      error: null,
    },
    blockers: [],
    warnings: [],
    status: 'fail',
  };

  if (!nodePty.ok) {
    report.blockers.push('node-pty could not be loaded');
    return finalizePtySmokeReport(report);
  }

  if (!nodePtyArtifacts.nativeBinaryPath) {
    report.warnings.push('node-pty native binary could not be located under prebuild/build paths');
  }

  if (process.platform !== 'win32') {
    if (!fs.existsSync('/bin/sh')) {
      report.blockers.push('/bin/sh is required for POSIX PTY smoke');
    }
    if (!nodePtyArtifacts.helperExists) {
      report.blockers.push('node-pty spawn-helper not found in expected prebuild/build paths');
    } else if (!nodePtyArtifacts.helperExecutable) {
      report.blockers.push(`node-pty spawn-helper is not executable: ${nodePtyArtifacts.helperPath}`);
    }
  }

  if (report.blockers.length > 0) {
    return finalizePtySmokeReport(report);
  }

  await new Promise(resolve => {
    let finished = false;
    let raw = '';
    let ptyProc = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      report.smoke.rawBytes = Buffer.byteLength(raw, 'utf8');
      report.smoke.extractedText = extractByResponseColor(raw, responseColorParams);
      if (report.smoke.extractedText !== PTY_SMOKE_TEXT) {
        report.blockers.push('PTY smoke did not extract expected truecolor response');
      }
      resolve();
    };

    const timer = setTimeout(() => {
      report.smoke.timedOut = true;
      report.blockers.push(`PTY smoke timed out after ${timeoutMs}ms`);
      try { ptyProc?.kill(); } catch (_) {}
      finish();
    }, timeoutMs);

    try {
      ptyProc = nodePty.pty.spawn(command.command, command.args, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: os.tmpdir(),
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      });
      ptyProc.onData(chunk => {
        raw += chunk;
      });
      ptyProc.onExit(({ exitCode }) => {
        report.smoke.exitCode = exitCode;
        if (exitCode !== 0) {
          report.blockers.push(`PTY smoke command exited with code ${exitCode}`);
        }
        finish();
      });
    } catch (error) {
      report.smoke.error = error.message;
      report.blockers.push(`PTY smoke failed to start: ${error.message}`);
      finish();
    }
  });

  return finalizePtySmokeReport(report);
}

export function renderDoctorReport(report) {
  const lines = [
    `companion-for-agy doctor ${report.toolVersion || '(unknown version)'}`,
    `Platform: ${report.platform}-${report.arch} | Node ${report.nodeVersion}`,
    `Status: ${report.status.toUpperCase()}`,
    '',
    `agy path: ${report.agy.path || '(not found)'}`,
    `agy executable: ${report.agy.executable ? 'PASS' : 'FAIL'}`,
    `agy version: ${report.agy.version || '(unknown)'}`,
    `model flag support: ${report.agy.supportsModelFlag === null ? 'unknown' : report.agy.supportsModelFlag ? 'PASS' : 'WARN use --no-model'}`,
    '',
    `node-pty load: ${report.nodePty.loadable ? 'PASS' : 'FAIL'} (${report.nodePty.source})`,
    `node-pty module: ${report.nodePty.resolvedPath || '(not resolved)'}`,
    `node-pty binary: ${report.nodePty.nativeBinaryPath || '(not located)'}`,
    `node-pty helper: ${report.nodePty.helperPath || '(n/a)'}`,
  ];

  if (report.platform !== 'win32') {
    lines.push(`node-pty helper executable: ${report.nodePty.helperExecutable === null ? 'unknown' : report.nodePty.helperExecutable ? 'PASS' : 'FAIL'}`);
  }

  lines.push('', `response RGB: ${report.responseColor.rgb.join(',')}`);

  if (report.blockers.length > 0) {
    lines.push('', 'Blockers:');
    for (const blocker of report.blockers) {
      lines.push(`- ${blocker}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join('\n') + '\n';
}

export function renderPtySmokeReport(report) {
  const lines = [
    `companion-for-agy PTY smoke ${report.toolVersion || '(unknown version)'}`,
    `Platform: ${report.platform}-${report.arch} | Node ${report.nodeVersion}`,
    `Status: ${report.status.toUpperCase()}`,
    '',
    `node-pty load: ${report.nodePty.loadable ? 'PASS' : 'FAIL'} (${report.nodePty.source})`,
    `node-pty module: ${report.nodePty.resolvedPath || '(not resolved)'}`,
    `node-pty binary: ${report.nodePty.nativeBinaryPath || '(not located)'}`,
    `node-pty helper: ${report.nodePty.helperPath || '(n/a)'}`,
  ];

  if (report.platform !== 'win32') {
    lines.push(`node-pty helper executable: ${report.nodePty.helperExecutable === null ? 'unknown' : report.nodePty.helperExecutable ? 'PASS' : 'FAIL'}`);
  }

  lines.push(
    '',
    `smoke command: ${[report.smoke.command, ...report.smoke.args].join(' ')}`,
    `response RGB: ${report.responseColor.rgb.join(',')}`,
    `expected text: ${report.smoke.expectedText}`,
    `extracted text: ${report.smoke.extractedText || '(none)'}`,
    `exit code: ${report.smoke.exitCode === null ? '(none)' : report.smoke.exitCode}`,
    `raw bytes: ${report.smoke.rawBytes}`,
  );

  if (report.blockers.length > 0) {
    lines.push('', 'Blockers:');
    for (const blocker of report.blockers) {
      lines.push(`- ${blocker}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join('\n') + '\n';
}

export function buildLiveSmokePrompt(expectedText = LIVE_SMOKE_TEXT) {
  return `Reply with exactly ${expectedText} and no other text.`;
}

export function liveSmokeMatches(text, expectedText = LIVE_SMOKE_TEXT) {
  return typeof text === 'string' && text.trim() === expectedText;
}

export function buildLiveSmokeReport({
  text,
  model,
  requestedModel,
  permissionMode,
  debug,
  prompt,
} = {}) {
  const matched = liveSmokeMatches(text);
  const blockers = matched ? [] : [`live smoke response did not match ${LIVE_SMOKE_TEXT}`];
  const rgb = parseResponseRgb(process.env.AGY_COMPANION_RESPONSE_RGB) || DEFAULT_RESPONSE_RGB;

  return {
    tool: 'companion-for-agy',
    toolVersion: getPackageVersion(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    model,
    requestedModel,
    permissionMode,
    responseColor: {
      rgb,
      sgrParams: responseRgbToSgrParams(rgb),
    },
    liveSmoke: {
      expectedText: LIVE_SMOKE_TEXT,
      prompt,
      response: text,
      matched,
      debugEnabled: Boolean(debug),
      debugLog: debug ? path.resolve('agy-debug.log') : null,
    },
    blockers,
    warnings: [],
    status: matched ? 'ok' : 'fail',
  };
}

export function renderLiveSmokeReport(report) {
  const lines = [
    `companion-for-agy live smoke ${report.toolVersion || '(unknown version)'}`,
    `Platform: ${report.platform}-${report.arch} | Node ${report.nodeVersion}`,
    `Status: ${report.status.toUpperCase()}`,
    '',
    `permission mode: ${report.permissionMode}`,
    `model: ${report.model || '(unknown)'}`,
    `requested model: ${report.requestedModel || '(none)'}`,
    `response RGB: ${report.responseColor.rgb.join(',')}`,
    `expected text: ${report.liveSmoke.expectedText}`,
    `response text: ${report.liveSmoke.response || '(none)'}`,
    `debug log: ${report.liveSmoke.debugLog || '(disabled)'}`,
  ];

  if (report.blockers.length > 0) {
    lines.push('', 'Blockers:');
    for (const blocker of report.blockers) {
      lines.push(`- ${blocker}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join('\n') + '\n';
}

// ---------- Go-style Duration Parser ----------

export function parseDurationToMs(str) {
  if (!str) return null;
  const regex = /(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/g;
  let match;
  let totalMs = 0;
  let hasMatch = false;
  while ((match = regex.exec(str)) !== null) {
    hasMatch = true;
    const value = parseFloat(match[1]);
    const unit = match[2];
    switch (unit) {
      case 'ns': totalMs += value / 1e6; break;
      case 'us':
      case 'µs': totalMs += value / 1000; break;
      case 'ms': totalMs += value; break;
      case 's': totalMs += value * 1000; break;
      case 'm': totalMs += value * 60000; break;
      case 'h': totalMs += value * 3600000; break;
    }
  }
  if (!hasMatch) {
    const plain = parseFloat(str);
    if (!isNaN(plain) && plain > 0) {
      return Math.round(plain * 1000);
    }
    return null;
  }
  return Math.round(totalMs);
}

// ---------- Permission-Presets ----------

export const PERMISSION_PRESETS = {
  sandbox: {
    agyFlags: ['--sandbox'],
    allow: [],
    deny: [],
  },
  'skip-permissions': {
    agyFlags: ['--dangerously-skip-permissions'],
    allow: [],
    deny: [],
  },
  'no-tools': {
    agyFlags: ['--sandbox'],
    allow: [],
    deny: ['command(*)', 'write_file(*)', 'edit_file(*)', 'read_file(*)'],
    promptPrefix: 'IMPORTANT: Do not use any tools. Answer based on your knowledge only.\n\n',
  },
  researcher: {
    agyFlags: ['--sandbox'],
    allow: ['google_search(*)', 'web_search(*)', 'web_fetch(*)', 'read_file(*)'],
    deny: ['command(*)', 'write_file(*)', 'edit_file(*)'],
  },
  'read-only': {
    agyFlags: ['--sandbox'],
    allow: ['read_file(*)'],
    deny: ['command(*)', 'write_file(*)', 'edit_file(*)'],
  },
};

// ---------- State-Machine-Patterns ----------

export const TRUST_DIALOG_PATTERN = /(Do you trust|Vertrauen Sie|Vertraust du)/i;
export const LOGIN_PROMPT_PATTERN = /Select login method/;
export const BANNER_MODEL_PATTERN = /Gemini \d[\d.]* \w+(?:\s*\([^)]*\))?/;

export const STARTUP_DONE_PATTERNS = [
  /\? for shortcuts/i,
  /\? für (Tastenkürzel|Kurzbefehle)/i,
];

export const INIT_DONE_PATTERNS = [
  /Zusammenfassung der Arbeit/,
  /Ich (bin|verwende|laufe) (derzeit |gerade )?(das Modell|auf dem Modell)/i,
  /Das aktive Modell/i,
  /Modell wurde als/i,
  /aktive Modell/i,
  /active model/i,
  /using model/i,
  /session (initialized|started|ready)/i,
];

export const INIT_FALLBACK_MS = 20000;

// ---------- Prompt-Sanitisierung ----------

export function sanitizeForPty(text) {
  return text
    .replace(/[\x00-\x08\x0b\x0e-\x1f]/g, '')
    .replace(/\x03/g, '')
    .replace(/\r\n|\r|\n/g, ' ');
}

// ---------- ANSI/VT100 Bereinigung ----------

export function stripAnsi(raw) {
  return raw
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][AB012]/g, '')
    .replace(/\x1b[=><NOMlmiHI78DEHMNO]/g, '')
    .replace(/\x1b./g, '')
    .replace(/[\x00-\x08\x0b\x0e-\x1f\x7f]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

export function isNoiseLine(line, promptFilter = '') {
  const t = line.trim();
  if (!t) return true;
  if (/^[│┌└┐┘├┤┬┴┼─═╔╗╚╝╠╣╦╩╬▸►◉●▲▼◆□■╭╮╯╰]+$/.test(t)) return true;
  if (t === '>') return true;
  if (/[⣾⣷⣯⣟⡿⢿⣻⣽⠿⠾⠽⠼⠻⠺⠹⠸⠷⠶⠵⠴⠳⠲⠱⠰]/.test(t)) return true;
  if (/Generating|esc to cancel|for shortcuts/i.test(t)) return true;
  if (t === '?' || t === '? for shortcuts') return true;
  if (/^Gemini \d/.test(t)) return true;
  if (/^\d+\s*tokens$/.test(t)) return true;
  if (/^▸\s/.test(t)) return true;
  if (/^(Checking|Reading|Writing|Searching|Fetching|Analyzing|Executing|Verifying)\b/i.test(t)) return true;
  if (/^└\s/.test(t)) return true;
  if (t.includes('@googlemail.com') || t.includes('@gmail.com')) return true;
  const promptNeedle = promptFilter.slice(0, 20).trim();
  if (promptNeedle.length >= 5 && t.includes(promptNeedle)) return true;
  return false;
}

// ---------- Response-Complete Detection ----------

/**
 * Returns true when the stripped response buffer ends with the agy idle prompt (bare '>'),
 * with no real content appearing after it.
 *
 * Bug fixed: the previous implementation used `break` at the first bare '>' after the
 * question echo, so a blank blockquote line or any other mid-response '>' would
 * incorrectly trigger responseComplete, starting the short 2.5s idle timer before the
 * actual response finished.  The new approach tracks a candidate flag and resets it
 * whenever non-noise content follows — only the *last* bare '>' with nothing meaningful
 * after it is treated as the real prompt.
 */
export function detectResponseComplete(responseSoFar, userPromptForFilter) {
  const respLines = responseSoFar.split('\n');
  let seenQuestionEcho = false;
  let foundPromptCandidate = false;
  for (const line of respLines) {
    const t = line.trim();
    if (!seenQuestionEcho && userPromptForFilter && t.includes(userPromptForFilter.slice(0, 15))) {
      seenQuestionEcho = true;
    } else if (seenQuestionEcho) {
      if (t === '>') {
        foundPromptCandidate = true;
      } else if (foundPromptCandidate && t && !isNoiseLine(t)) {
        foundPromptCandidate = false;
      }
    }
  }
  return foundPromptCandidate;
}

// ---------- Response-Extraktion via ANSI-Farbe ----------

export function extractByResponseColor(rawSection, responseColorParams = getResponseSgrParams()) {
  const segments = [];
  let inResponseColor = false;
  let pos = 0;
  const src = rawSection;
  let hadCursorPos = false;
  let cursorRow = null;
  let cursorCol = null;
  let gapHadNewline = false;
  let currentGapNewline = false;
  let preColorSpaces = 0;

  while (pos < src.length) {
    if (src[pos] === '\x1b') {
      if (src[pos + 1] === '[') {
        let end = pos + 2;
        while (end < src.length && !/[A-Za-z]/.test(src[end])) end++;
        const cmd = src[end];
        const params = src.slice(pos + 2, end);
        if (params === responseColorParams && cmd === 'm') {
          inResponseColor = true;
          currentGapNewline = gapHadNewline;
          hadCursorPos = false;
          cursorRow = null;
          cursorCol = null;
          gapHadNewline = false;
        } else if (cmd === 'm') {
          if (params === '' || params === '0' || params === '39' ||
              (params.startsWith('38;') && params !== responseColorParams) ||
              /^3[0-7]$/.test(params) || /^9[0-7]$/.test(params)) {
            inResponseColor = false;
          }
        } else if (inResponseColor && (cmd === 'H' || cmd === 'f')) {
          hadCursorPos = true;
          const parts = params.split(';');
          if (parts.length >= 2) {
            const r = parseInt(parts[0], 10);
            const c = parseInt(parts[1], 10);
            if (!isNaN(r)) cursorRow = r;
            if (!isNaN(c)) cursorCol = c;
          }
        }
        pos = end + 1;
      } else if (src[pos + 1] === ']') {
        let end = pos + 2;
        while (end < src.length && src[end] !== '\x07' &&
               !(src[end] === '\x1b' && src[end + 1] === '\\')) end++;
        pos = src[end] === '\x07' ? end + 1 : end + 2;
      } else {
        pos += 2;
      }
    } else if (inResponseColor) {
      let textEnd = pos;
      while (textEnd < src.length && src[textEnd] !== '\x1b') textEnd++;
      const rawText = src.slice(pos, textEnd);
      const text = rawText.replace(/[\x00-\x08\x0b\x0e-\x1f\x7f]/g, '');
      if (text.length > 0) {
        segments.push({
          text,
          newLine: currentGapNewline && !hadCursorPos,
          startCol: hadCursorPos ? cursorCol : null,
          startRow: hadCursorPos ? cursorRow : null,
          estimatedCol: !hadCursorPos ? preColorSpaces + 1 : null,
        });
        currentGapNewline = false;
        if (hadCursorPos && cursorCol !== null) {
          cursorCol += text.length;
        }
      }
      pos = textEnd;
    } else {
      if (src[pos] === '\n') {
        gapHadNewline = true;
        preColorSpaces = 0;
      } else if (src[pos] === ' ') {
        preColorSpaces++;
      } else {
        preColorSpaces = 0;
      }
      pos++;
    }
  }

  if (segments.length === 0) return null;

  const deduped = segments.filter((s, i) =>
    !segments.some((o, j) => j !== i &&
      s.startCol === null &&
      o.text.length > s.text.length && o.text.startsWith(s.text))
  );

  let combined = '';
  let lastEndCol = null;
  let lastRow = null;
  for (let i = 0; i < deduped.length; i++) {
    const seg = deduped[i];
    const rowChanged = seg.startRow !== null && lastRow !== null && seg.startRow !== lastRow;
    if (i === 0) {
      combined = seg.text;
      if (seg.startCol !== null) {
        lastEndCol = seg.startCol + seg.text.length;
      } else if (seg.estimatedCol !== null) {
        lastEndCol = seg.estimatedCol + seg.text.length;
      }
      if (seg.startRow !== null) lastRow = seg.startRow;
    } else if (seg.startCol !== null && lastEndCol !== null && !rowChanged) {
      const gap = seg.startCol - lastEndCol;
      if (gap > 0) combined += ' '.repeat(gap);
      else if (gap < 0) combined = combined.slice(0, Math.max(0, combined.length + gap));
      combined += seg.text;
      lastEndCol = seg.startCol + seg.text.length;
      if (seg.startRow !== null) lastRow = seg.startRow;
    } else if (seg.startCol !== null && !rowChanged) {
      combined += seg.text;
      lastEndCol = seg.startCol + seg.text.length;
      if (seg.startRow !== null) lastRow = seg.startRow;
    } else if (rowChanged || seg.newLine) {
      if (seg.startCol !== null && lastEndCol !== null && seg.startCol === lastEndCol) {
        combined += seg.text;
      } else {
        combined = combined.trimEnd() + ' ' + seg.text;
      }
      if (seg.startCol !== null) {
        lastEndCol = seg.startCol + seg.text.length;
      } else if (seg.estimatedCol !== null) {
        lastEndCol = seg.estimatedCol + seg.text.length;
      } else {
        lastEndCol = null;
      }
      if (seg.startRow !== null) lastRow = seg.startRow;
    } else {
      combined += seg.text;
      if (lastEndCol !== null) {
        lastEndCol += seg.text.length;
      }
    }
  }
  combined = combined.replace(/ {2,}/g, ' ').trim();
  return combined.length > 0 ? combined : null;
}

export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function stripPromptEcho(text, filter) {
  if (!filter || !text) return null;
  const normText = text.replace(/\s+/g, '');
  const normFilter = filter.replace(/\s+/g, '');
  const matchLen = Math.min(30, normFilter.length);
  if (matchLen < 5 || !normText.includes(normFilter.slice(0, matchLen))) return null;
  const words = filter.split(/\s+/).filter(w => w.length > 0);
  const regexStr = words.map(w => escapeRegex(w)).join('\\s*');
  const clean = text.replace(new RegExp(regexStr), '').trim();
  return clean.length > 0 ? clean : '';
}

export function cleanColorExtracted(text, promptFilter = '') {
  if (!text) return null;
  const lines = text.split('\n');
  const cleaned = lines.filter(l => !isNoiseLine(l, promptFilter));
  const result = cleaned.join('\n').trim();
  return result.length > 0 ? result : null;
}

export function extractResponse(stripped, rawSection, promptFilter = '', effectiveFilter = '') {
  if (rawSection) {
    const colorResult = extractByResponseColor(rawSection);
    if (colorResult && colorResult.length > 0) {
      let result = colorResult;
      const echoFilter = effectiveFilter || promptFilter;
      if (echoFilter) {
        const cleaned = stripPromptEcho(result, echoFilter);
        if (cleaned !== null) result = cleaned || '';
      }
      if (promptFilter && promptFilter !== echoFilter) {
        const cleaned = stripPromptEcho(result, promptFilter);
        if (cleaned !== null) result = cleaned || '';
      }
      const final = cleanColorExtracted(result, promptFilter);
      return final;
    }
  }

  const lines = stripped.split('\n');
  const meaningful = lines.filter(l => !isNoiseLine(l, promptFilter));
  if (meaningful.length === 0) return null;

  let best = meaningful.join('\n').trim();
  const echoFilter = effectiveFilter || promptFilter;
  if (echoFilter) {
    const cleaned = stripPromptEcho(best, echoFilter);
    if (cleaned !== null) best = cleaned || '';
  }
  if (promptFilter && promptFilter !== echoFilter) {
    const cleaned = stripPromptEcho(best, promptFilter);
    if (cleaned !== null) best = cleaned || '';
  }
  return best.trim() || null;
}

// ---------- CLI Main ----------

const __filename = fileURLToPath(import.meta.url);

function isMainModule() {
  try {
    if (!process.argv[1]) return false;
    return fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(path.resolve(__filename));
  } catch (_) {
    return path.resolve(process.argv[1] || '') === path.resolve(__filename);
  }
}

if (isMainModule()) {

  // Update-Hinweis: nur im interaktiven Terminal melden, niemals im Subprozess-/Pipe-Betrieb
  // (schuetzt jede maschinelle Nutzung; der Check laeuft abgekoppelt im Hintergrund).
  try {
    if (process.stdout.isTTY) {
      updateNotifier({ pkg: require('../package.json') }).notify();
    }
  } catch (_) { /* Update-Check darf den Start nie blockieren */ }

  function printUsage(lang) {
    process.stderr.write(getMessage('usage', lang));
  }

  const rawArgs = process.argv.slice(2);

  let model = DEFAULT_MODEL;
  let includeModel = !/^(1|true|yes)$/i.test(process.env.AGY_COMPANION_NO_MODEL || '');
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let debug = false;
  let jsonOutput = false;
  let doctorMode = false;
  let ptySmokeMode = false;
  let liveSmokeMode = false;
  let permissionMode = 'sandbox';
  let permissionModeExplicit = false;
  const customAllow = [];
  const customDeny = [];
  const addDirs = [];
  let userPromptForFilter = '';
  let effectivePromptForFilter = '';
  const promptParts = [];
  let langOption = null;
  let showHelp = false;

  let parseOptions = true;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    if (!parseOptions) {
      promptParts.push(arg);
    } else if (arg === '--') {
      parseOptions = false;
    } else if (arg === '--help' || arg === '-h') {
      showHelp = true;
    } else if ((arg === '--model' || arg === '-m') && rawArgs[i + 1]) {
      model = rawArgs[++i];
    } else if (arg === '--no-model') {
      includeModel = false;
    } else if (arg === '--timeout' && rawArgs[i + 1]) {
      const t = parseInt(rawArgs[++i], 10);
      if (!isNaN(t) && t > 0) timeoutMs = t;
    } else if (arg === '--debug') {
      debug = true;
    } else if (arg === '--json') {
      jsonOutput = true;
    } else if (arg === '--doctor') {
      doctorMode = true;
    } else if (arg === '--pty-smoke') {
      ptySmokeMode = true;
    } else if (arg === '--live-smoke') {
      liveSmokeMode = true;
    } else if (arg === '--sandbox') {
      permissionMode = 'sandbox';
      permissionModeExplicit = true;
    } else if (arg === '--skip-permissions' || arg === '--dangerously-skip-permissions') {
      permissionMode = 'skip-permissions';
      permissionModeExplicit = true;
    } else if (arg === '--no-tools') {
      permissionMode = 'no-tools';
      permissionModeExplicit = true;
    } else if (arg === '--researcher') {
      permissionMode = 'researcher';
      permissionModeExplicit = true;
    } else if (arg === '--read-only') {
      permissionMode = 'read-only';
      permissionModeExplicit = true;
    } else if (arg === '--print-timeout' && rawArgs[i + 1]) {
      const ms = parseDurationToMs(rawArgs[++i]);
      if (ms !== null) timeoutMs = ms;
    } else if (arg.startsWith('--print-timeout=')) {
      const ms = parseDurationToMs(arg.slice(16));
      if (ms !== null) timeoutMs = ms;
    } else if (arg === '-p' || arg === '--print' || arg === '--prompt') {
      // Ignored: agy-companion runs in interactive mode internally to capture PTY/ANSI
    } else if (arg === '-i' || arg === '--prompt-interactive') {
      // Ignored: agy-companion runs interactive by default
    } else if (arg === '--allow' && rawArgs[i + 1]) {
      customAllow.push(rawArgs[++i]);
    } else if (arg === '--deny' && rawArgs[i + 1]) {
      customDeny.push(rawArgs[++i]);
    } else if (arg === '--add-dir' && rawArgs[i + 1]) {
      addDirs.push(rawArgs[++i]);
    } else if (arg === '--lang' && rawArgs[i + 1]) {
      langOption = rawArgs[++i];
    } else if (arg.startsWith('--lang=')) {
      langOption = arg.slice(7);
    } else if (!arg.startsWith('-')) {
      promptParts.push(arg);
    } else {
      const tempLang = detectLocale(langOption);
      process.stderr.write(getMessage('errUnknownOption', tempLang, { arg }));
      printUsage(tempLang);
      process.exit(1);
    }
  }

  const lang = detectLocale(langOption);

  if (showHelp || rawArgs.length === 0) {
    printUsage(lang);
    process.exit(0);
  }

  let userPrompt = promptParts.join(' ').trim();
  if (liveSmokeMode) {
    if (!permissionModeExplicit) {
      permissionMode = 'no-tools';
    }
    if (!userPrompt) {
      userPrompt = buildLiveSmokePrompt();
    }
  }
  if (!doctorMode && !ptySmokeMode && !liveSmokeMode && !userPrompt) {
    process.stderr.write(getMessage('errNoPrompt', lang));
    printUsage(lang);
    process.exit(1);
  }
  userPromptForFilter = userPrompt;

  // ---------- Permission-Setup ----------

  const preset = PERMISSION_PRESETS[permissionMode];
  const allAllow = [...preset.allow, ...customAllow];
  const allDeny = [...preset.deny, ...customDeny];

  const tempWorkspace = path.join(os.tmpdir(), `agy-companion-${process.pid}`);

  // Clean stale workspace from a previous crashed run with same PID
  try { fs.rmSync(tempWorkspace, { recursive: true, force: true }); } catch (_) {}

  if (allAllow.length > 0 || allDeny.length > 0) {
    const geminiDir = path.join(tempWorkspace, '.gemini');
    fs.mkdirSync(geminiDir, { recursive: true });
    const settings = { permissions: {} };
    if (allAllow.length > 0) settings.permissions.allow = allAllow;
    if (allDeny.length > 0) settings.permissions.deny = allDeny;
    fs.writeFileSync(path.join(geminiDir, 'settings.json'), JSON.stringify(settings, null, 2));
  } else {
    fs.mkdirSync(tempWorkspace, { recursive: true });
  }

  const promptPrefix = preset.promptPrefix || '';
  const effectivePrompt = promptPrefix + userPrompt;
  effectivePromptForFilter = effectivePrompt;

  if (doctorMode) {
    const report = collectDoctorReport();
    if (jsonOutput) {
      process.stdout.write(JSON.stringify(report) + '\n');
    } else {
      process.stdout.write(renderDoctorReport(report));
    }
    process.exit(report.blockers.length > 0 ? 2 : 0);
  }

  if (ptySmokeMode) {
    const report = await collectPtySmokeReport();
    if (jsonOutput) {
      process.stdout.write(JSON.stringify(report) + '\n');
    } else {
      process.stdout.write(renderPtySmokeReport(report));
    }
    process.exit(report.blockers.length > 0 ? 2 : 0);
  }

  // ---------- node-pty ----------

  const nodePty = resolveNodePtyModule();
  if (!nodePty.ok) {
    if (process.env.AGY_COMPANION_PTY_PATH) {
      process.stderr.write(getMessage('errPtyLoadFailed', lang, { path: process.env.AGY_COMPANION_PTY_PATH, message: nodePty.error.message }));
    } else {
      process.stderr.write(getMessage('errPtyInstall', lang));
    }
    process.exit(1);
  }
  const pty = nodePty.pty;

  // ---------- Resolve agy path ----------

  const resolvedAgyPath = AGY_PATH;
  if (!resolvedAgyPath) {
    process.stderr.write(getMessage('errAgyNotFound', lang));
    process.exit(1);
  }

  if (!fs.existsSync(resolvedAgyPath)) {
    process.stderr.write(getMessage('errAgyNotAt', lang, { path: resolvedAgyPath }));
    process.exit(1);
  }

  // ---------- Start agy ----------

  const addDirFlags = addDirs.flatMap(dir => ['--add-dir', dir]);
  const agyArgs = includeModel
    ? ['--model', model, ...preset.agyFlags, ...addDirFlags]
    : [...preset.agyFlags, ...addDirFlags];

  process.stderr.write(
    getMessage('statusStarting', lang, { args: agyArgs.join(' '), mode: permissionMode })
  );

  const ptyProc = pty.spawn(resolvedAgyPath, agyArgs, {
    name: 'xterm-256color',
    cols: 220,
    rows: 50,
    cwd: tempWorkspace,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  });

  let signalHandling = false;
  function handleExternalSignal(signal) {
    if (signalHandling) return;
    signalHandling = true;
    const code = signal === 'SIGINT' ? 130 : 143;
    process.stderr.write(getMessage('statusReceivedSignal', lang, { signal }));
    shutdown(code);
  }

  process.once('SIGINT', () => handleExternalSignal('SIGINT'));
  process.once('SIGTERM', () => handleExternalSignal('SIGTERM'));

  let rawBuffer = '';
  let detectedModel = null;
  let trustHandled = false;
  let startupComplete = false;
  let initDone = false;
  let questionSent = false;
  let responseStartMark = 0;
  let initIdleTimer = null;
  let startupFallbackTimer = null;
  let responseIdleTimer = null;
  let finished = false;
  let ptyExited = false;
  let shutdownCode = null;
  let forceKillTimer = null;
  let finalExitTimer = null;
  let lastProgressResponseLength = 0;
  let lastResponseComplete = false;

  const globalTimeout = setTimeout(() => {
    if (!finished) {
      process.stderr.write(getMessage('statusTimeout', lang, { timeout: timeoutMs }));
      shutdown(2);
    }
  }, timeoutMs);

  startupFallbackTimer = setTimeout(() => {
    if (!startupComplete && !finished) {
      startupComplete = true;
      process.stderr.write(getMessage('statusStartupFallback', lang, { timeout: STARTUP_FALLBACK_MS }));
      initIdleTimer = setTimeout(() => {
        if (!initDone && !questionSent) {
          initDone = true;
          sendQuestion();
        }
      }, INIT_FALLBACK_MS);
    }
  }, STARTUP_FALLBACK_MS);

  function cleanupTemp() {
    try {
      const projectsDir = path.join(os.homedir(), '.gemini', 'config', 'projects');
      if (fs.existsSync(projectsDir)) {
        const files = fs.readdirSync(projectsDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            const p = path.join(projectsDir, file);
            try {
              const content = fs.readFileSync(p, 'utf8');
              if (content.includes(`agy-companion-${process.pid}`)) {
                const tempP = p + '.cleanup_tmp';
                fs.renameSync(p, tempP);
                fs.unlinkSync(tempP);
              }
            } catch (_) {}
          }
        }
      }
    } catch (_) {}

    try {
      fs.rmSync(tempWorkspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (_) {}
  }

  function scheduleFinalExit(code) {
    if (finalExitTimer) return;
    finalExitTimer = setTimeout(() => {
      if (debug) {
        const debugPath = path.resolve('agy-debug.log');
        try { fs.writeFileSync(debugPath, rawBuffer, 'utf8'); } catch (_) {}
        process.stderr.write(getMessage('statusDebugLog', lang, { path: debugPath }));
      }

      cleanupTemp();
      process.exit(code);
    }, SHUTDOWN_CLEANUP_DELAY_MS);
  }

  function shutdown(code) {
    if (finished) return;
    finished = true;
    shutdownCode = code;
    clearTimeout(globalTimeout);
    clearTimeout(startupFallbackTimer);
    clearTimeout(initIdleTimer);
    clearTimeout(responseIdleTimer);

    if (!ptyExited) {
      try { ptyProc.write('\x03'); } catch (_) {}
      if (code === 0) {
        scheduleFinalExit(code);
        return;
      }
      forceKillTimer = setTimeout(() => {
        if (!ptyExited) {
          try { ptyProc.kill(); } catch (_) {}
        }
        scheduleFinalExit(code);
      }, SHUTDOWN_FORCE_KILL_MS);
    } else {
      scheduleFinalExit(code);
    }
  }

  function deliverResponse() {
    const responsePart = rawBuffer.slice(responseStartMark);
    const stripped = stripAnsi(responsePart);
    const response = extractResponse(stripped, responsePart, userPromptForFilter, effectivePromptForFilter);

    if (response) {
      shutdown(outputResult(response));
    } else {
      process.stderr.write(getMessage('errNoResponse', lang));
      shutdown(NO_RESPONSE_EXIT_CODE);
    }
  }

  function outputResult(text) {
    if (liveSmokeMode) {
      const report = buildLiveSmokeReport({
        text,
        model: detectedModel || model,
        requestedModel: model,
        permissionMode,
        debug,
        prompt: userPromptForFilter,
      });
      if (jsonOutput) {
        process.stdout.write(JSON.stringify(report) + '\n');
      } else {
        process.stdout.write(renderLiveSmokeReport(report));
      }
      return report.blockers.length > 0 ? LIVE_SMOKE_EXIT_CODE : 0;
    }

    if (jsonOutput) {
      const result = { response: text, model: detectedModel || model, requestedModel: model, permissionMode };
      process.stdout.write(JSON.stringify(result) + '\n');
    } else {
      process.stdout.write(text + '\n');
    }
    return 0;
  }

  function sendQuestion() {
    if (questionSent) return;
    questionSent = true;
    responseStartMark = rawBuffer.length;
    lastProgressResponseLength = 0;
    process.stderr.write(getMessage('statusInitComplete', lang));
    ptyProc.write(sanitizeForPty(effectivePrompt) + '\r');

    responseIdleTimer = setTimeout(() => {
      process.stderr.write(getMessage('statusResponseIdle', lang));
      deliverResponse();
    }, RESPONSE_IDLE_MS);
  }

  ptyProc.onData(chunk => {
    rawBuffer += chunk;
    const recentStripped = stripAnsi(rawBuffer.slice(-3000));

    if (!questionSent && !finished) {
      if (!detectedModel) {
        const modelMatch = recentStripped.match(BANNER_MODEL_PATTERN);
        if (modelMatch) {
          detectedModel = modelMatch[0];
          process.stderr.write(getMessage('statusDetectedModel', lang, { model: detectedModel }));
        }
      }

      if (LOGIN_PROMPT_PATTERN.test(recentStripped)) {
        process.stderr.write(getMessage('errNotSignedIn', lang));
        shutdown(3);
        return;
      }

      if (!trustHandled && TRUST_DIALOG_PATTERN.test(recentStripped)) {
        trustHandled = true;
        process.stderr.write(getMessage('statusTrustDialog', lang));
        ptyProc.write('\r');
      }

      if (!startupComplete) {
        if (STARTUP_DONE_PATTERNS.some(p => p.test(recentStripped))) {
          startupComplete = true;
          clearTimeout(startupFallbackTimer);
          process.stderr.write(getMessage('statusStartupComplete', lang));
          clearTimeout(initIdleTimer);
          initIdleTimer = setTimeout(() => {
            if (!initDone && !questionSent) {
              initDone = true;
              process.stderr.write(getMessage('statusInitFallback', lang, { timeout: INIT_FALLBACK_MS }));
              sendQuestion();
            }
          }, INIT_FALLBACK_MS);
        }
      }

      if (startupComplete && !initDone) {
        if (INIT_DONE_PATTERNS.some(p => p.test(recentStripped))) {
          initDone = true;
          clearTimeout(initIdleTimer);
          process.stderr.write(getMessage('statusInitDetected', lang));
          setTimeout(sendQuestion, 1000);
        } else {
          clearTimeout(initIdleTimer);
          initIdleTimer = setTimeout(() => {
            if (!initDone && !questionSent) {
              initDone = true;
              process.stderr.write(getMessage('statusInitIdle', lang));
              sendQuestion();
            }
          }, INIT_FALLBACK_MS);
        }
      }
    } else if (questionSent && !finished) {
      const responseSoFar = stripAnsi(rawBuffer.slice(responseStartMark));
      const responseComplete = detectResponseComplete(responseSoFar, userPromptForFilter);
      const newLength = responseSoFar.length;

      if (shouldResetIdleTimer({ newLength, lastProgressLength: lastProgressResponseLength, minProgressBytes: RESPONSE_MIN_PROGRESS_BYTES, responseComplete, lastResponseComplete })) {
        lastProgressResponseLength = newLength;
        lastResponseComplete = responseComplete;
        clearTimeout(responseIdleTimer);
        if (responseComplete) {
          responseIdleTimer = setTimeout(() => {
            process.stderr.write(getMessage('statusResponseComplete', lang));
            deliverResponse();
          }, RESPONSE_DONE_IDLE_MS);
        } else {
          responseIdleTimer = setTimeout(() => {
            process.stderr.write(getMessage('statusResponseIdle', lang));
            deliverResponse();
          }, RESPONSE_IDLE_MS);
        }
      }
    }
  });

  ptyProc.onExit(({ exitCode }) => {
    ptyExited = true;
    if (finished) {
      clearTimeout(forceKillTimer);
      scheduleFinalExit(shutdownCode ?? exitCode ?? 0);
      return;
    }

    if (questionSent) {
      deliverResponse();
    } else {
      process.stderr.write(getMessage('errAgyExited', lang));
      shutdown(exitCode ?? 1);
    }
  });
}
