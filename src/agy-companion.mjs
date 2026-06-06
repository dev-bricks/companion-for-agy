#!/usr/bin/env node
/**
 * agy-companion.mjs — ConPTY-basierter Wrapper für agy (Antigravity CLI)
 *
 * Problem: agy ist eine Go-TUI-Anwendung die in den Windows Console Buffer schreibt
 *          (nicht stdout). Aus Claude Code Subprozessen ist kein Output abgreifbar.
 *          Außerdem führt GEMINI.md eine "Erste Aktion" aus, die den einzigen -p-Turn
 *          für Session-Initialisierung verbraucht.
 *
 * Lösung:  1. node-pty (ConPTY) erstellt einen virtuellen Windows-Terminal
 *          2. Interaktiver Modus: Init abwarten, DANN die eigentliche Frage senden
 *          3. Antwort via ANSI-Color-Extraktion ([38;2;232;234;237m = Response-Farbe)
 *          4. Fallback: Zeilen-basierte Noise-Filterung
 *
 * Aufruf:
 *   node agy-companion.mjs [optionen] "prompt"
 *
 * Permission-Modi:
 *   --sandbox              Sandbox-Modus (Standard) — Tools in Container
 *   --skip-permissions     YOLO — alle Tools ohne Bestätigung
 *   --no-tools             Reiner Chat — keine Tool-Ausführung
 *   --researcher           Web-Recherche erlaubt, keine Dateiänderungen
 *   --read-only            Nur Lesen erlaubt
 *   --allow <pattern>      Whitelist-Regel (wiederholbar)
 *   --deny <pattern>       Blacklist-Regel (wiederholbar)
 *
 * Weitere Optionen:
 *   --model <model>        Gemini-Modell (Standard: gemini-3.5-flash)
 *   --timeout <ms>         Timeout in ms (Standard: 120000)
 *   --json                 Ausgabe als JSON {"response":"...", "model":"..."}
 *   --debug                Roh-PTY-Output in agy-debug.log speichern
 *
 * node-pty stammt aus: @google/gemini-cli node_modules (bereits installiert)
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';

// ---------- Konfigurierbare Pfade (env vars oder Defaults) ----------

const NODE_PTY_PATH = process.env.AGY_COMPANION_PTY_PATH
  || 'C:\\Users\\User\\AppData\\Roaming\\npm\\node_modules\\@google\\gemini-cli\\node_modules\\node-pty';
const AGY_PATH = process.env.AGY_COMPANION_AGY_PATH
  || process.env.AGY_PATH
  || 'C:\\Users\\User\\AppData\\Local\\agy\\bin\\agy.exe';
const DEFAULT_MODEL = 'gemini-3.5-flash';
const DEFAULT_TIMEOUT_MS = 120000;
const RESPONSE_IDLE_MS = 10000;
const RESPONSE_DONE_IDLE_MS = 2500;

const require = createRequire(import.meta.url);

// ---------- Permission-Presets ----------

const PERMISSION_PRESETS = {
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

// ---------- CLI Argument Parsing ----------

function printUsage() {
  process.stderr.write([
    'agy-companion — ConPTY-Wrapper für agy (Antigravity CLI)',
    '',
    'Verwendung: node agy-companion.mjs [optionen] "prompt"',
    '',
    'Permission-Modi (gegenseitig exklusiv):',
    '  --sandbox              Sandbox-Modus (Standard) — Tools in Container',
    '  --skip-permissions     Alle Tools ohne Bestätigung (YOLO)',
    '  --no-tools             Reiner Chat — keine Tool-Ausführung',
    '  --researcher           Web-Recherche erlaubt, keine Dateiänderungen',
    '  --read-only            Nur Lesen erlaubt, keine Änderungen',
    '',
    'Custom-Regeln (kombinierbar mit Modi):',
    '  --allow <pattern>      Whitelist-Regel (wiederholbar)',
    '  --deny <pattern>       Blacklist-Regel (wiederholbar)',
    '  Formate: read_file(/pfad), command(git), write_file(*)',
    '',
    'Weitere Optionen:',
    '  --model <model>        Gemini-Modell (Standard: gemini-3.5-flash)',
    '  --timeout <ms>         Timeout in ms (Standard: 120000)',
    '  --json                 Ausgabe als JSON-Objekt',
    '  --debug                Roh-PTY-Output in agy-debug.log speichern',
    '  --help                 Diese Hilfe anzeigen',
    '',
    'Modelle:',
    '  gemini-1.5-flash   gemini-1.5-pro',
    '  gemini-2.0-flash   gemini-2.0-pro',
    '  gemini-3.5-flash   gemini-3.5-pro',
    '',
    'Umgebungsvariablen:',
    '  AGY_COMPANION_AGY_PATH   Pfad zu agy.exe',
    '  AGY_COMPANION_PTY_PATH   Pfad zum node-pty Modul',
    '',
    'Beispiele:',
    '  node agy-companion.mjs "Was ist die Hauptstadt von Bayern?"',
    '  node agy-companion.mjs --no-tools "Reviewe diesen Code: ..."',
    '  node agy-companion.mjs --researcher "Suche aktuelle Infos zu ..."',
    '  node agy-companion.mjs --read-only --allow "command(git log)" "prompt"',
    '  node agy-companion.mjs --json --model gemini-3.5-pro "prompt"',
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
  } else if (arg === '--skip-permissions') {
    permissionMode = 'skip-permissions';
  } else if (arg === '--no-tools') {
    permissionMode = 'no-tools';
  } else if (arg === '--researcher') {
    permissionMode = 'researcher';
  } else if (arg === '--read-only') {
    permissionMode = 'read-only';
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
  process.stderr.write('Fehler: Kein Prompt angegeben.\n\n');
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

// ---------- Prompt-Sanitisierung ----------

function sanitizeForPty(text) {
  return text
    .replace(/[\x00-\x08\x0b\x0e-\x1f]/g, '')
    .replace(/\x03/g, '')
    .replace(/\r\n|\r|\n/g, ' ');
}

// ---------- ANSI/VT100 Bereinigung ----------

function stripAnsi(raw) {
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

function isNoiseLine(line) {
  const t = line.trim();
  if (!t) return true;
  if (t.length <= 2) return true;
  if (/^[│┌└┐┘├┤┬┴┼─═╔╗╚╝╠╣╦╩╬▸►◉●▲▼◆□■╭╮╯╰]+$/.test(t)) return true;
  if (t.startsWith('>')) return true;
  if (/[⣾⣷⣯⣟⡿⢿⣻⣽⠿⠾⠽⠼⠻⠺⠹⠸⠷⠶⠵⠴⠳⠲⠱⠰]/.test(t)) return true;
  if (/Generating|esc to cancel|for shortcuts|tokens/i.test(t)) return true;
  if (t === '?' || t === '? for shortcuts') return true;
  if (/^Gemini \d/.test(t)) return true;
  if (/^\d+\s*tokens$/.test(t)) return true;
  if (/^▸\s/.test(t)) return true;
  if (/^(Checking|Reading|Writing|Searching|Fetching|Analyzing|Executing)\b/i.test(t)) return true;
  if (t.includes('@googlemail.com') || t.includes('@gmail.com')) return true;
  if (userPromptForFilter && t.includes(userPromptForFilter.slice(0, 20))) return true;
  return false;
}

// ---------- Response-Extraktion via ANSI-Farbe ----------

function extractByResponseColor(rawSection) {
  // Response-Text in agy: RGB(232,234,237) — [38;2;232;234;237m
  const segments = [];
  let inResponseColor = false;
  let pos = 0;
  const src = rawSection;

  while (pos < src.length) {
    if (src[pos] === '\x1b') {
      if (src[pos + 1] === '[') {
        let end = pos + 2;
        while (end < src.length && !/[A-Za-z]/.test(src[end])) end++;
        const cmd = src[end];
        const params = src.slice(pos + 2, end);
        if (params === '38;2;232;234;237' && cmd === 'm') {
          inResponseColor = true;
        } else if (cmd === 'm') {
          inResponseColor = false;
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
      if (text.length > 0) segments.push(text);
      pos = textEnd;
    } else {
      pos++;
    }
  }

  if (segments.length === 0) return null;

  // Deduplizieren: Nur exakte Präfix-Matches (Drip-Animation)
  const deduped = segments.filter((s, i) =>
    !segments.some((o, j) => j !== i && o.length > s.length && o.startsWith(s))
  );

  const combined = deduped.join('').trim();
  return combined.length > 0 ? combined : null;
}

function extractResponse(stripped, rawSection) {
  if (rawSection) {
    const colorResult = extractByResponseColor(rawSection);
    if (colorResult && colorResult.length > 2) {
      if (userPromptForFilter && colorResult.includes(userPromptForFilter.slice(0, 15))) {
        const clean = colorResult.replace(
          new RegExp(escapeRegex(userPromptForFilter.slice(0, 20)) + '[^\\n]*', 'g'), ''
        ).trim();
        if (clean.length > 2) return clean;
      }
      return colorResult;
    }
  }

  const lines = stripped.split('\n');
  const meaningful = lines.filter(l => !isNoiseLine(l));
  if (meaningful.length === 0) return null;

  let best = meaningful.join('\n').trim();
  if (userPromptForFilter) {
    const promptWords = userPromptForFilter.split(/\s+/).slice(0, 5).join('');
    best = best.split('\n')
      .filter(l => !l.replace(/\s/g, '').startsWith(promptWords.replace(/\s/g, '')))
      .join('\n')
      .trim();
  }
  return best || null;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------- node-pty laden ----------

let pty;
try {
  pty = require(NODE_PTY_PATH);
} catch (err) {
  process.stderr.write(
    `[agy-companion] node-pty nicht geladen (${NODE_PTY_PATH}):\n  ${err.message}\n`
  );
  process.exit(1);
}

if (!fs.existsSync(AGY_PATH)) {
  process.stderr.write(`[agy-companion] agy.exe nicht gefunden: ${AGY_PATH}\n`);
  process.exit(1);
}

// ---------- agy starten ----------

const agyArgs = ['--model', model, ...preset.agyFlags];

process.stderr.write(
  `[agy-companion] Starte agy ${agyArgs.join(' ')} (${permissionMode})...\n`
);

const ptyProc = pty.spawn(AGY_PATH, agyArgs, {
  name: 'xterm-256color',
  cols: 220,
  rows: 50,
  cwd: tempWorkspace,
  env: { ...process.env, TERM: 'xterm-256color' },
});

let rawBuffer = '';
let startupComplete = false;
let initDone = false;
let questionSent = false;
let responseStartMark = 0;
let initIdleTimer = null;
let responseIdleTimer = null;
let finished = false;

const globalTimeout = setTimeout(() => {
  if (!finished) {
    process.stderr.write(`[agy-companion] Globaler Timeout (${timeoutMs}ms). Abbruch.\n`);
    shutdown(2);
  }
}, timeoutMs);

function cleanupTemp() {
  try {
    if (tempSettingsCreated) {
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
    } else {
      fs.rmdirSync(tempWorkspace);
    }
  } catch (_) {}
}

function shutdown(code) {
  if (finished) return;
  finished = true;
  clearTimeout(globalTimeout);
  clearTimeout(initIdleTimer);
  clearTimeout(responseIdleTimer);

  // Graceful shutdown: Ctrl+C → kurze Grace-Period → kill
  try { ptyProc.write('\x03'); } catch (_) {}
  setTimeout(() => {
    try { ptyProc.kill(); } catch (_) {}

    if (debug) {
      const debugPath = path.join(os.homedir(), '.claude', 'scripts', 'agy-debug.log');
      try { fs.writeFileSync(debugPath, rawBuffer, 'utf8'); } catch (_) {}
      process.stderr.write(`[agy-companion] Debug-Log: ${debugPath}\n`);
    }

    cleanupTemp();
    process.exit(code);
  }, 500);
}

function deliverResponse() {
  const responsePart = rawBuffer.slice(responseStartMark);
  const stripped = stripAnsi(responsePart);
  const response = extractResponse(stripped, responsePart);

  if (response) {
    outputResult(response);
    shutdown(0);
  } else {
    const fullStripped = stripAnsi(rawBuffer);
    const fallback = extractResponse(fullStripped, rawBuffer);
    if (fallback) {
      outputResult(fallback);
    } else {
      process.stderr.write('[agy-companion] Keine verwertbare Antwort erhalten.\n');
    }
    shutdown(0);
  }
}

function outputResult(text) {
  if (jsonOutput) {
    const result = { response: text, model, permissionMode };
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    process.stdout.write(text + '\n');
  }
}

function sendQuestion() {
  if (questionSent) return;
  questionSent = true;
  responseStartMark = rawBuffer.length;
  process.stderr.write(`[agy-companion] Init fertig. Sende Frage...\n`);
  ptyProc.write(sanitizeForPty(effectivePrompt) + '\r');

  responseIdleTimer = setTimeout(() => {
    process.stderr.write(`[agy-companion] Response-Idle-Timeout. Extrahiere Antwort...\n`);
    deliverResponse();
  }, RESPONSE_IDLE_MS);
}

// Phase 1: Startup-Screen abgeschlossen
const STARTUP_DONE_PATTERNS = [
  /\? for shortcuts/,
  /Antigravity CLI/,
];

// Phase 2: GEMINI.md-Initialisierung abgeschlossen
const INIT_DONE_PATTERNS = [
  /Zusammenfassung der Arbeit/,
  /Ich (bin|verwende|laufe) (derzeit |gerade )?(das Modell|auf dem Modell)/i,
  /Das aktive Modell/i,
  /Modell wurde als/i,
  /aktive Modell/i,
];

const INIT_FALLBACK_MS = 20000;

ptyProc.onData(chunk => {
  rawBuffer += chunk;
  const recentStripped = stripAnsi(rawBuffer.slice(-3000));

  if (!questionSent && !finished) {
    if (!startupComplete) {
      if (STARTUP_DONE_PATTERNS.some(p => p.test(recentStripped))) {
        startupComplete = true;
        process.stderr.write(`[agy-companion] Startup fertig. Warte auf Gemini-Init...\n`);
        clearTimeout(initIdleTimer);
        initIdleTimer = setTimeout(() => {
          if (!initDone && !questionSent) {
            initDone = true;
            process.stderr.write(`[agy-companion] Init-Fallback-Timeout (${INIT_FALLBACK_MS}ms) → sende Frage.\n`);
            sendQuestion();
          }
        }, INIT_FALLBACK_MS);
      }
    }

    if (startupComplete && !initDone) {
      if (INIT_DONE_PATTERNS.some(p => p.test(recentStripped))) {
        initDone = true;
        clearTimeout(initIdleTimer);
        process.stderr.write(`[agy-companion] Gemini-Init erkannt. Kurze Pause...\n`);
        setTimeout(sendQuestion, 1000);
      } else {
        clearTimeout(initIdleTimer);
        initIdleTimer = setTimeout(() => {
          if (!initDone && !questionSent) {
            initDone = true;
            process.stderr.write(`[agy-companion] Init-Idle-Timeout → sende Frage.\n`);
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
        process.stderr.write(`[agy-companion] Response done (empty prompt detected) → deliver.\n`);
        deliverResponse();
      }, RESPONSE_DONE_IDLE_MS);
    } else {
      responseIdleTimer = setTimeout(() => {
        process.stderr.write(`[agy-companion] Response-Idle-Timeout → Antwort fertig.\n`);
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
      process.stderr.write('[agy-companion] agy beendet bevor Init fertig.\n');
      shutdown(exitCode ?? 1);
    }
  }
});
