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

// ---------- Defaults ----------

export const DEFAULT_MODEL = 'gemini-3.5-flash';
export const DEFAULT_TIMEOUT_MS = 120000;
export const RESPONSE_IDLE_MS = 10000;
export const RESPONSE_DONE_IDLE_MS = 2500;

const require = createRequire(import.meta.url);

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
      '/usr/local/bin/agy',
      '/opt/homebrew/bin/agy',
    ]) {
      if (fs.existsSync(p)) return p;
    }
  }

  return null;
}

export const AGY_PATH = findAgyPath();

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
    deny: ['write_file(*)', 'edit_file(*)', 'command(rm *)', 'command(del *)'],
  },
  'read-only': {
    agyFlags: ['--sandbox'],
    allow: ['read_file(*)'],
    deny: ['write_file(*)', 'edit_file(*)', 'command(rm *)', 'command(del *)'],
  },
};

// ---------- State-Machine-Patterns ----------

export const TRUST_DIALOG_PATTERN = /Do you trust/;
export const LOGIN_PROMPT_PATTERN = /Select login method/;
export const BANNER_MODEL_PATTERN = /Gemini \d[\d.]* \w+(?:\s*\([^)]*\))?/;

export const STARTUP_DONE_PATTERNS = [
  /\? for shortcuts/,
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
  if (promptFilter && t.includes(promptFilter.slice(0, 20))) return true;
  return false;
}

// ---------- Response-Extraktion via ANSI-Farbe ----------

export function extractByResponseColor(rawSection) {
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
        if (params === '38;2;232;234;237' && cmd === 'm') {
          inResponseColor = true;
          currentGapNewline = gapHadNewline;
          hadCursorPos = false;
          cursorRow = null;
          cursorCol = null;
          gapHadNewline = false;
        } else if (cmd === 'm') {
          if (params === '' || params === '0' || params === '39' ||
              (params.startsWith('38;') && params !== '38;2;232;234;237') ||
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

  function printUsage() {
    process.stderr.write([
      'companion-for-agy — Unofficial PTY wrapper for agy (Antigravity CLI / Gemini CLI)',
      '',
      'Usage: companion-for-agy [options] "prompt"',
      '',
      'Permission modes (mutually exclusive):',
      '  --sandbox              Sandbox mode (default) — tools in container',
      '  --skip-permissions     All tools without confirmation (YOLO)',
      '  --no-tools             Pure chat — no tool execution',
      '  --researcher           Web search allowed, no file changes',
      '  --read-only            Read-only, no modifications',
      '',
      'Custom rules (combinable with modes):',
      '  --allow <pattern>      Allowlist rule (repeatable)',
      '  --deny <pattern>       Denylist rule (repeatable)',
      '  Formats: read_file(/path), command(git), write_file(*)',
      '',
      'Options:',
      '  --model <model>        Gemini model (default: gemini-3.5-flash)',
      '  --timeout <ms>         Timeout in ms (default: 120000)',
      '  --json                 Output as JSON object',
      '  --debug                Save raw PTY output to agy-debug.log',
      '  --help                 Show this help',
      '',
      'Models:',
      '  gemini-1.5-flash   gemini-1.5-pro',
      '  gemini-2.0-flash   gemini-2.0-pro',
      '  gemini-3.5-flash   gemini-3.5-pro',
      '',
      'Environment variables:',
      '  AGY_COMPANION_AGY_PATH   Path to agy binary',
      '  AGY_PATH                 Alternative path to agy binary',
      '',
      'Examples:',
      '  companion-for-agy "What is the capital of Bavaria?"',
      '  companion-for-agy --no-tools "Review this code: ..."',
      '  companion-for-agy --researcher "Latest info on Node.js 24"',
      '  companion-for-agy --read-only --allow "command(git log)" "prompt"',
      '  companion-for-agy --json --model gemini-3.5-pro "prompt"',
    ].join('\n') + '\n');
  }

  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0 || rawArgs[0] === '--help' || rawArgs[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  let model = DEFAULT_MODEL;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let debug = false;
  let jsonOutput = false;
  let permissionMode = 'sandbox';
  const customAllow = [];
  const customDeny = [];
  let userPromptForFilter = '';
  let effectivePromptForFilter = '';
  const promptParts = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if ((arg === '--model' || arg === '-m') && rawArgs[i + 1]) {
      model = rawArgs[++i];
    } else if (arg === '--timeout' && rawArgs[i + 1]) {
      const t = parseInt(rawArgs[++i], 10);
      if (!isNaN(t) && t > 0) timeoutMs = t;
    } else if (arg === '--debug') {
      debug = true;
    } else if (arg === '--json') {
      jsonOutput = true;
    } else if (arg === '--sandbox') {
      permissionMode = 'sandbox';
    } else if (arg === '--skip-permissions' || arg === '--dangerously-skip-permissions') {
      permissionMode = 'skip-permissions';
    } else if (arg === '--no-tools') {
      permissionMode = 'no-tools';
    } else if (arg === '--researcher') {
      permissionMode = 'researcher';
    } else if (arg === '--read-only') {
      permissionMode = 'read-only';
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
    } else if (!arg.startsWith('-')) {
      promptParts.push(arg);
    }
  }

  const userPrompt = promptParts.join(' ').trim();
  if (!userPrompt) {
    process.stderr.write('Error: No prompt provided.\n\n');
    printUsage();
    process.exit(1);
  }
  userPromptForFilter = userPrompt;

  // ---------- Permission-Setup ----------

  const preset = PERMISSION_PRESETS[permissionMode];
  const allAllow = [...preset.allow, ...customAllow];
  const allDeny = [...preset.deny, ...customDeny];

  const tempWorkspace = path.join(os.tmpdir(), `agy-companion-${process.pid}`);
  let tempSettingsCreated = false;

  if (allAllow.length > 0 || allDeny.length > 0) {
    const geminiDir = path.join(tempWorkspace, '.gemini');
    fs.mkdirSync(geminiDir, { recursive: true });
    const settings = { permissions: {} };
    if (allAllow.length > 0) settings.permissions.allow = allAllow;
    if (allDeny.length > 0) settings.permissions.deny = allDeny;
    fs.writeFileSync(path.join(geminiDir, 'settings.json'), JSON.stringify(settings, null, 2));
    tempSettingsCreated = true;
  } else {
    fs.mkdirSync(tempWorkspace, { recursive: true });
  }

  const promptPrefix = preset.promptPrefix || '';
  const effectivePrompt = promptPrefix + userPrompt;
  effectivePromptForFilter = effectivePrompt;

  // ---------- node-pty ----------

  let pty;
  const nodePtyOverride = process.env.AGY_COMPANION_PTY_PATH;

  if (nodePtyOverride) {
    try {
      pty = require(nodePtyOverride);
    } catch (err) {
      process.stderr.write(`[agy-companion] Failed to load node-pty from ${nodePtyOverride}:\n  ${err.message}\n`);
      process.exit(1);
    }
  } else {
    try {
      pty = require('node-pty');
    } catch (_) {
      let loaded = false;
      const geminiPtySuffix = path.join('@google', 'gemini-cli', 'node_modules', 'node-pty');
      const candidates = [];

      if (process.platform === 'win32' && process.env.APPDATA) {
        candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', geminiPtySuffix));
      }
      try {
        const globalRoot = execSync('npm root -g', {
          encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        candidates.push(path.join(globalRoot, geminiPtySuffix));
      } catch (_) { /* npm not available */ }

      for (const candidate of candidates) {
        try {
          pty = require(candidate);
          loaded = true;
          break;
        } catch (_) { /* try next */ }
      }

      if (!loaded) {
        process.stderr.write(
          `[agy-companion] Failed to load node-pty.\n` +
          `[agy-companion] Install via: npm install -g companion-for-agy\n` +
          `[agy-companion] Or set AGY_COMPANION_PTY_PATH environment variable.\n`
        );
        process.exit(1);
      }
    }
  }

  // ---------- Resolve agy path ----------

  const resolvedAgyPath = AGY_PATH;
  if (!resolvedAgyPath) {
    process.stderr.write(
      `[agy-companion] agy not found.\n` +
      `[agy-companion] Install agy: https://github.com/google-gemini/gemini-cli\n` +
      `[agy-companion] Or set AGY_PATH / AGY_COMPANION_AGY_PATH environment variable.\n`
    );
    process.exit(1);
  }

  if (!fs.existsSync(resolvedAgyPath)) {
    process.stderr.write(`[agy-companion] agy not found at: ${resolvedAgyPath}\n`);
    process.exit(1);
  }

  // ---------- Start agy ----------

  const agyArgs = ['--model', model, ...preset.agyFlags];

  process.stderr.write(
    `[agy-companion] Starting agy ${agyArgs.join(' ')} (${permissionMode})...\n`
  );

  const ptyProc = pty.spawn(resolvedAgyPath, agyArgs, {
    name: 'xterm-256color',
    cols: 220,
    rows: 50,
    cwd: tempWorkspace,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  });

  let rawBuffer = '';
  let detectedModel = null;
  let trustHandled = false;
  let startupComplete = false;
  let initDone = false;
  let questionSent = false;
  let responseStartMark = 0;
  let initIdleTimer = null;
  let responseIdleTimer = null;
  let finished = false;

  const globalTimeout = setTimeout(() => {
    if (!finished) {
      process.stderr.write(`[agy-companion] Global timeout (${timeoutMs}ms). Aborting.\n`);
      shutdown(2);
    }
  }, timeoutMs);

  function cleanupTemp() {
    try {
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
    } catch (_) {}
  }

  function shutdown(code) {
    if (finished) return;
    finished = true;
    clearTimeout(globalTimeout);
    clearTimeout(initIdleTimer);
    clearTimeout(responseIdleTimer);

    try { ptyProc.write('\x03'); } catch (_) {}
    setTimeout(() => {
      try { ptyProc.kill(); } catch (_) {}

      if (debug) {
        const debugPath = path.resolve('agy-debug.log');
        try { fs.writeFileSync(debugPath, rawBuffer, 'utf8'); } catch (_) {}
        process.stderr.write(`[agy-companion] Debug log: ${debugPath}\n`);
      }

      cleanupTemp();
      process.exit(code);
    }, 500);
  }

  function deliverResponse() {
    const responsePart = rawBuffer.slice(responseStartMark);
    const stripped = stripAnsi(responsePart);
    const response = extractResponse(stripped, responsePart, userPromptForFilter, effectivePromptForFilter);

    if (response) {
      outputResult(response);
      shutdown(0);
    } else {
      const fullStripped = stripAnsi(rawBuffer);
      const fallback = extractResponse(fullStripped, rawBuffer, userPromptForFilter, effectivePromptForFilter);
      if (fallback) {
        outputResult(fallback);
      } else {
        process.stderr.write('[agy-companion] No usable response received.\n');
      }
      shutdown(0);
    }
  }

  function outputResult(text) {
    if (jsonOutput) {
      const result = { response: text, model: detectedModel || model, requestedModel: model, permissionMode };
      process.stdout.write(JSON.stringify(result) + '\n');
    } else {
      process.stdout.write(text + '\n');
    }
  }

  function sendQuestion() {
    if (questionSent) return;
    questionSent = true;
    responseStartMark = rawBuffer.length;
    process.stderr.write(`[agy-companion] Init complete. Sending question...\n`);
    ptyProc.write(sanitizeForPty(effectivePrompt) + '\r');

    responseIdleTimer = setTimeout(() => {
      process.stderr.write(`[agy-companion] Response idle timeout. Extracting...\n`);
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
          process.stderr.write(`[agy-companion] Detected model: ${detectedModel}\n`);
        }
      }

      if (LOGIN_PROMPT_PATTERN.test(recentStripped)) {
        process.stderr.write(`[agy-companion] agy is not signed in. Please run 'agy' manually and complete sign-in first.\n`);
        shutdown(3);
        return;
      }

      if (!trustHandled && TRUST_DIALOG_PATTERN.test(recentStripped)) {
        trustHandled = true;
        process.stderr.write(`[agy-companion] Trust dialog detected. Auto-confirming...\n`);
        ptyProc.write('\r');
      }

      if (!startupComplete) {
        if (STARTUP_DONE_PATTERNS.some(p => p.test(recentStripped))) {
          startupComplete = true;
          process.stderr.write(`[agy-companion] Startup complete. Waiting for init...\n`);
          clearTimeout(initIdleTimer);
          initIdleTimer = setTimeout(() => {
            if (!initDone && !questionSent) {
              initDone = true;
              process.stderr.write(`[agy-companion] Init fallback timeout (${INIT_FALLBACK_MS}ms).\n`);
              sendQuestion();
            }
          }, INIT_FALLBACK_MS);
        }
      }

      if (startupComplete && !initDone) {
        if (INIT_DONE_PATTERNS.some(p => p.test(recentStripped))) {
          initDone = true;
          clearTimeout(initIdleTimer);
          process.stderr.write(`[agy-companion] Init detected. Brief pause...\n`);
          setTimeout(sendQuestion, 1000);
        } else {
          clearTimeout(initIdleTimer);
          initIdleTimer = setTimeout(() => {
            if (!initDone && !questionSent) {
              initDone = true;
              process.stderr.write(`[agy-companion] Init idle timeout.\n`);
              sendQuestion();
            }
          }, INIT_FALLBACK_MS);
        }
      }
    } else if (questionSent && !finished) {
      clearTimeout(responseIdleTimer);

      const responseSoFar = stripAnsi(rawBuffer.slice(responseStartMark));
      const respLines = responseSoFar.split('\n');
      let seenQuestionEcho = false;
      let responseComplete = false;
      for (const line of respLines) {
        const t = line.trim();
        if (!seenQuestionEcho && userPromptForFilter && t.includes(userPromptForFilter.slice(0, 15))) {
          seenQuestionEcho = true;
        } else if (seenQuestionEcho && t === '>') {
          responseComplete = true;
          break;
        }
      }

      if (responseComplete) {
        responseIdleTimer = setTimeout(() => {
          process.stderr.write(`[agy-companion] Response complete.\n`);
          deliverResponse();
        }, RESPONSE_DONE_IDLE_MS);
      } else {
        responseIdleTimer = setTimeout(() => {
          process.stderr.write(`[agy-companion] Response idle timeout.\n`);
          deliverResponse();
        }, RESPONSE_IDLE_MS);
      }
    }
  });

  ptyProc.onExit(({ exitCode }) => {
    if (!finished) {
      if (questionSent) {
        deliverResponse();
      } else {
        process.stderr.write('[agy-companion] agy exited before init completed.\n');
        shutdown(exitCode ?? 1);
      }
    }
  });
}
