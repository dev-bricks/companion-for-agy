import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  stripAnsi, isNoiseLine, extractByResponseColor,
  sanitizeForPty, extractResponse, escapeRegex, stripPromptEcho,
  cleanColorExtracted, detectResponseComplete,
  PERMISSION_PRESETS, TRUST_DIALOG_PATTERN, LOGIN_PROMPT_PATTERN, BANNER_MODEL_PATTERN,
  STARTUP_DONE_PATTERNS, INIT_DONE_PATTERNS,
  DEFAULT_MODEL, findAgyPath, AGY_PATH, parseDurationToMs,
  DEFAULT_RESPONSE_RGB, parseResponseRgb, responseRgbToSgrParams,
  shouldResetIdleTimer, RESPONSE_MIN_PROGRESS_BYTES,
  STARTUP_FALLBACK_MS,
  parseSemverishVersion, versionSupportsModelFlag, inspectNodePtyArtifacts,
} from '../src/agy-companion.mjs';
import { detectLocale, getMessage } from '../src/locales.mjs';

const RC = '\x1b[38;2;232;234;237m';
const RESET = '\x1b[0m';

// ---------- stripAnsi ----------

describe('stripAnsi', () => {
  it('removes CSI sequences', () => {
    assert.equal(stripAnsi('\x1b[31mhello\x1b[0m'), 'hello');
  });

  it('removes OSC sequences (BEL terminated)', () => {
    assert.equal(stripAnsi('\x1b]0;title\x07text'), 'text');
  });

  it('removes OSC sequences (ST terminated)', () => {
    assert.equal(stripAnsi('\x1b]0;title\x1b\\text'), 'text');
  });

  it('removes charset sequences', () => {
    assert.equal(stripAnsi('\x1b(Btext'), 'text');
  });

  it('normalizes line endings', () => {
    assert.equal(stripAnsi('a\r\nb\rc'), 'a\nb\nc');
  });

  it('removes control characters', () => {
    assert.equal(stripAnsi('a\x01b\x7fc'), 'abc');
  });

  it('preserves clean text', () => {
    assert.equal(stripAnsi('hello world'), 'hello world');
  });

  it('handles empty string', () => {
    assert.equal(stripAnsi(''), '');
  });

  it('handles multiple sequences in a row', () => {
    assert.equal(stripAnsi('\x1b[1m\x1b[31mred bold\x1b[0m'), 'red bold');
  });

  it('removes single-char escape sequences', () => {
    assert.equal(stripAnsi('\x1b=text\x1b>end'), 'textend');
  });
});

// ---------- isNoiseLine ----------

describe('isNoiseLine', () => {
  it('filters empty lines', () => {
    assert.equal(isNoiseLine(''), true);
    assert.equal(isNoiseLine('   '), true);
  });

  it('keeps short meaningful content', () => {
    assert.equal(isNoiseLine('4'), false);
    assert.equal(isNoiseLine('42'), false);
    assert.equal(isNoiseLine('ja'), false);
    assert.equal(isNoiseLine('ab'), false);
    assert.equal(isNoiseLine('No'), false);
  });

  it('filters single question mark', () => {
    assert.equal(isNoiseLine('?'), true);
  });

  it('filters box-drawing characters', () => {
    assert.equal(isNoiseLine('│││'), true);
    assert.equal(isNoiseLine('╭──────╮'), true);
    assert.equal(isNoiseLine('╰──────╯'), true);
  });

  it('filters bare prompt marker (>)', () => {
    assert.equal(isNoiseLine('>'), true);
  });

  it('preserves blockquote lines (> text)', () => {
    assert.equal(isNoiseLine('> This is a blockquote'), false);
    assert.equal(isNoiseLine('> Zitat aus einer Quelle'), false);
  });

  it('filters spinner characters', () => {
    assert.equal(isNoiseLine('⣾ Working'), true);
    assert.equal(isNoiseLine('⠿ Loading'), true);
  });

  it('filters TUI status lines', () => {
    assert.equal(isNoiseLine('Generating response...'), true);
    assert.equal(isNoiseLine('? for shortcuts'), true);
    assert.equal(isNoiseLine('esc to cancel'), true);
    assert.equal(isNoiseLine('1234 tokens'), true);
  });

  it('filters model name lines', () => {
    assert.equal(isNoiseLine('Gemini 3.5 Flash'), true);
    assert.equal(isNoiseLine('Gemini 2.0 Pro'), true);
  });

  it('filters tool action lines', () => {
    assert.equal(isNoiseLine('Checking permissions...'), true);
    assert.equal(isNoiseLine('Reading file.txt'), true);
    assert.equal(isNoiseLine('Searching for results'), true);
    assert.equal(isNoiseLine('Executing command'), true);
    assert.equal(isNoiseLine('Verifying the Constraints'), true);
  });

  it('filters TUI tip lines (└ prefix)', () => {
    assert.equal(isNoiseLine('└ Tip: Press ? to see keyboard shortcuts.'), true);
    assert.equal(isNoiseLine('└ 42 tokens used'), true);
  });

  it('filters email addresses (privacy)', () => {
    assert.equal(isNoiseLine('user@googlemail.com logged in'), true);
    assert.equal(isNoiseLine('contact@gmail.com'), true);
  });

  it('filters prompt echo when promptFilter given', () => {
    assert.equal(isNoiseLine('Was ist die Hauptstadt von Bayern?', 'Was ist die Hauptstadt'), true);
  });

  it('does NOT filter prompt text without promptFilter', () => {
    assert.equal(isNoiseLine('Was ist die Hauptstadt von Bayern?'), false);
  });

  it('keeps meaningful content', () => {
    assert.equal(isNoiseLine('Die Hauptstadt von Bayern ist München.'), false);
    assert.equal(isNoiseLine('Python is a programming language.'), false);
    assert.equal(isNoiseLine('The answer is 42.'), false);
  });

  it('keeps lines mentioning "tokens" in real content', () => {
    assert.equal(isNoiseLine('GPT-4 was trained on billions of tokens.'), false);
    assert.equal(isNoiseLine('The model uses 7B tokens for training.'), false);
  });

  it('filters triangle-arrow tool lines', () => {
    assert.equal(isNoiseLine('▸ Tool: read_file'), true);
  });
});

// ---------- sanitizeForPty ----------

describe('sanitizeForPty', () => {
  it('removes control characters', () => {
    assert.equal(sanitizeForPty('hello\x01world'), 'helloworld');
  });

  it('removes Ctrl+C', () => {
    assert.equal(sanitizeForPty('test\x03data'), 'testdata');
  });

  it('converts newlines to spaces', () => {
    assert.equal(sanitizeForPty('line1\nline2\r\nline3'), 'line1 line2 line3');
  });

  it('converts standalone CR to space', () => {
    assert.equal(sanitizeForPty('a\rb'), 'a b');
  });

  it('preserves normal text', () => {
    assert.equal(sanitizeForPty('hello world 123'), 'hello world 123');
  });

  it('preserves umlauts', () => {
    assert.equal(sanitizeForPty('München Ärger Über'), 'München Ärger Über');
  });

  it('handles empty string', () => {
    assert.equal(sanitizeForPty(''), '');
  });
});

// ---------- extractByResponseColor ----------

describe('extractByResponseColor', () => {
  it('extracts text in response color', () => {
    const raw = `noise${RC}München ist die Hauptstadt.${RESET}more noise`;
    assert.equal(extractByResponseColor(raw), 'München ist die Hauptstadt.');
  });

  it('returns null for no response color', () => {
    assert.equal(extractByResponseColor('just plain text'), null);
    assert.equal(extractByResponseColor('\x1b[31mred text\x1b[0m'), null);
  });

  it('concatenates multiple response segments', () => {
    const raw = `${RC}Teil 1${RESET} noise ${RC} Teil 2${RESET}`;
    const result = extractByResponseColor(raw);
    assert.equal(result, 'Teil 1 Teil 2');
  });

  it('deduplicates drip-animated segments', () => {
    const raw = [
      `${RC}Die${RESET}`,
      `${RC}Die Haupt${RESET}`,
      `${RC}Die Hauptstadt${RESET}`,
      `${RC}Die Hauptstadt von Bayern.${RESET}`,
    ].join('');
    assert.equal(extractByResponseColor(raw), 'Die Hauptstadt von Bayern.');
  });

  it('returns null for empty response color segments', () => {
    assert.equal(extractByResponseColor(`${RC}${RESET}`), null);
  });

  it('handles OSC sequences in raw data', () => {
    const raw = `\x1b]0;title\x07${RC}text here${RESET}`;
    assert.equal(extractByResponseColor(raw), 'text here');
  });

  it('strips control chars from extracted text', () => {
    const raw = `${RC}clean\x01text${RESET}`;
    assert.equal(extractByResponseColor(raw), 'cleantext');
  });

  it('handles different non-response colors correctly', () => {
    const green = '\x1b[38;2;0;255;0m';
    const raw = `${green}green text${RESET}${RC}response${RESET}`;
    assert.equal(extractByResponseColor(raw), 'response');
  });

  it('uses a custom response RGB when supplied', () => {
    const custom = '\x1b[38;2;1;2;3m';
    const raw = `${RC}default color${RESET}${custom}custom response${RESET}`;
    assert.equal(extractByResponseColor(raw, '38;2;1;2;3'), 'custom response');
  });

  it('handles response color toggling', () => {
    const other = '\x1b[38;2;100;100;100m';
    const raw = `${RC}first${other}gap${RC}second${RESET}`;
    assert.equal(extractByResponseColor(raw), 'firstsecond');
  });

  it('inserts space at line wrap boundaries', () => {
    const raw = `${RC}end of line,${RESET}\n  ${RC}start of next${RESET}`;
    assert.equal(extractByResponseColor(raw), 'end of line, start of next');
  });

  it('deduplicates partial-word prefix with full cursor-positioned rerender', () => {
    const raw = `${RC}Pse${RESET}\n\n${RC}\x1b[12;12HPseudoterminal${RESET}`;
    assert.equal(extractByResponseColor(raw), 'Pseudoterminal');
  });

  it('inserts space when non-positioned segment meets cursor-positioned text', () => {
    const raw = `\n  ${RC}Ein Compiler${RESET}\n\n${RC}\x1b[14;16Hist ein Test${RESET}`;
    assert.equal(extractByResponseColor(raw), 'Ein Compiler ist ein Test');
  });

  it('joins directly when non-positioned segment is split mid-word', () => {
    const raw = `\n  ${RC}Ein spezielles Comp${RESET}\n\n${RC}\x1b[14;22Huterprogramm${RESET}`;
    assert.equal(extractByResponseColor(raw), 'Ein spezielles Computerprogramm');
  });

  it('captures bold text within response color (SGR 1/22 not a color reset)', () => {
    const BOLD = '\x1b[1m';
    const NOBOLD = '\x1b[22m';
    const raw = `\n  ${RC}1. ${BOLD}Kosteneffizienz:${NOBOLD} Spart Geld.${RESET}`;
    assert.equal(extractByResponseColor(raw), '1. Kosteneffizienz: Spart Geld.');
  });

  it('joins mid-word row wrap without space (column continuity)', () => {
    const BOLD = '\x1b[1m';
    const NOBOLD = '\x1b[22m';
    const raw = `\n  ${RC}1. ${BOLD}Kost${NOBOLD}${RESET}\n\n${RC}${BOLD}\x1b[16;10Heneffizienz:${NOBOLD}${RESET}`;
    assert.equal(extractByResponseColor(raw), '1. Kosteneffizienz:');
  });

  it('fills column gaps with spaces (ConPTY word-boundary skipping)', () => {
    const raw = `${RC}\x1b[1;1Hdas${RESET}${RC}\x1b[1;5Hein Test${RESET}`;
    assert.equal(extractByResponseColor(raw), 'das ein Test');
  });

  it('handles overlap truncation (ConPTY partial re-render)', () => {
    const raw = `${RC}\x1b[1;1Hhello wor${RESET}${RC}\x1b[1;7H    ${RESET}\n  ${RC}world${RESET}`;
    assert.equal(extractByResponseColor(raw), 'hello world');
  });

  it('trims trailing whitespace at line wraps', () => {
    const raw = `${RC}word      ${RESET}\n  ${RC}next${RESET}`;
    assert.equal(extractByResponseColor(raw), 'word next');
  });

  it('collapses multiple spaces to single', () => {
    const raw = `${RC}a    b${RESET}`;
    assert.equal(extractByResponseColor(raw), 'a b');
  });

  it('advances cursorCol for continuation text in same RC block', () => {
    const BOLD = '\x1b[1m';
    const NOBOLD = '\x1b[22m';
    const raw = `\n  ${RC}2. ${BOLD}Hohe Si${NOBOLD}${RESET}${RC}${BOLD}\x1b[15;13Hcherheit${NOBOLD}: Der frei ein${RESET}${RC}\x1b[15;35Hsehbare Code${RESET}`;
    const result = extractByResponseColor(raw);
    assert.ok(result.includes('Sicherheit'));
    assert.ok(result.includes('einsehbare'));
    assert.ok(!result.includes('ein sehbare'));
  });

  it('does not dedup CUP-positioned segments with common prefix', () => {
    const raw = `${RC}\x1b[12;51H: ${RESET}${RC}\x1b[14;22H: Da keine${RESET}`;
    const result = extractByResponseColor(raw);
    assert.ok(result.includes(': '));
    assert.ok(result.includes(': Da keine'));
  });
});

// ---------- escapeRegex ----------

describe('escapeRegex', () => {
  it('escapes dots', () => {
    assert.equal(escapeRegex('hello.world'), 'hello\\.world');
  });

  it('escapes special regex characters', () => {
    assert.equal(escapeRegex('a+b*c?d'), 'a\\+b\\*c\\?d');
    assert.equal(escapeRegex('(test)'), '\\(test\\)');
    assert.equal(escapeRegex('[abc]'), '\\[abc\\]');
    assert.equal(escapeRegex('{1,2}'), '\\{1,2\\}');
  });

  it('escapes pipe and caret', () => {
    assert.equal(escapeRegex('a|b^c$d'), 'a\\|b\\^c\\$d');
  });

  it('preserves normal characters', () => {
    assert.equal(escapeRegex('hello world'), 'hello world');
  });

  it('handles empty string', () => {
    assert.equal(escapeRegex(''), '');
  });
});

// ---------- extractResponse ----------

describe('extractResponse', () => {
  it('prefers color-based extraction', () => {
    const raw = `noise\n${RC}Color response text.${RESET}\nmore noise`;
    const stripped = stripAnsi(raw);
    assert.equal(extractResponse(stripped, raw), 'Color response text.');
  });

  it('falls back to line filtering when no color', () => {
    const stripped = '⢾ Generating\nMeaningful content here.\n123 tokens\n';
    assert.equal(extractResponse(stripped, null), 'Meaningful content here.');
  });

  it('falls back when rawSection is null', () => {
    const stripped = 'A real response line.\n42 tokens\n';
    assert.equal(extractResponse(stripped, null), 'A real response line.');
  });

  it('returns null for all-noise input', () => {
    const stripped = '?\n>\n42 tokens\n';
    assert.equal(extractResponse(stripped, null), null);
  });

  it('filters prompt echo from color result', () => {
    const prompt = 'Was ist die Hauptstadt';
    const raw = `${RC}Was ist die Hauptstadt von Bayern?\nMünchen.${RESET}`;
    const stripped = stripAnsi(raw);
    const result = extractResponse(stripped, raw, prompt);
    assert.ok(!result.includes('Was ist die Hauptstadt'));
    assert.ok(result.includes('München'));
  });

  it('filters prompt echo in fallback mode', () => {
    const prompt = 'Was ist 2+2';
    const stripped = 'Was ist 2+2\nDie Antwort ist 4.\n';
    const result = extractResponse(stripped, null, prompt);
    assert.ok(result.includes('Die Antwort ist 4'));
  });

  it('filters prompt echo in fallback mode using effectiveFilter', () => {
    const prompt = 'What is 2+2?';
    const effectiveFilter = 'IMPORTANT: Do not use any tools. What is 2+2?';
    const stripped = 'IMPORTANT: Do not use any tools. What is 2+2?\n4\n';
    const result = extractResponse(stripped, null, prompt, effectiveFilter);
    assert.equal(result, '4');
  });

  it('keeps short color results', () => {
    const raw = `${RC}Hi${RESET}`;
    const stripped = 'Meaningful line here.\n';
    assert.equal(extractResponse(stripped, raw), 'Hi');
  });

  it('keeps single-char color results', () => {
    const raw = `${RC}4${RESET}`;
    const stripped = 'noise\n';
    assert.equal(extractResponse(stripped, raw), '4');
  });

  it('does not treat a one-character answer as prompt echo', () => {
    const raw = `${RC}4${RESET}`;
    const stripped = stripAnsi(raw);
    assert.equal(extractResponse(stripped, raw, '4'), '4');
  });
});

// ---------- stripPromptEcho ----------

describe('stripPromptEcho', () => {
  it('strips exact prompt match', () => {
    assert.equal(stripPromptEcho('Was ist 2+2? Die Antwort ist 4.', 'Was ist 2+2?'), 'Die Antwort ist 4.');
  });

  it('strips prompt with collapsed whitespace (ConPTY space-loss)', () => {
    const text = 'IMPORTANT:Donotuse any tools.Was ist2+2?4';
    const filter = 'IMPORTANT: Do not use any tools. Was ist 2+2?';
    assert.equal(stripPromptEcho(text, filter), '4');
  });

  it('returns null when prompt not found', () => {
    assert.equal(stripPromptEcho('Die Antwort ist 4.', 'Unrelated prompt'), null);
  });

  it('returns empty string when echo is entire text', () => {
    assert.equal(stripPromptEcho('Was ist 2+2?', 'Was ist 2+2?'), '');
  });

  it('returns null for empty inputs', () => {
    assert.equal(stripPromptEcho('', 'prompt'), null);
    assert.equal(stripPromptEcho('text', ''), null);
    assert.equal(stripPromptEcho(null, 'prompt'), null);
  });

  it('handles special regex characters in prompt', () => {
    assert.equal(stripPromptEcho('Was ist 2+2? Antwort: 4', 'Was ist 2+2?'), 'Antwort: 4');
  });
});

// ---------- extractResponse with effectiveFilter ----------

describe('extractResponse with effectiveFilter', () => {
  it('strips no-tools prefix echo via effectiveFilter', () => {
    const prefix = 'IMPORTANT: Do not use any tools. Answer based on your knowledge only.\n';
    const userPrompt = 'Was ist 2+2?';
    const effectivePrompt = prefix + userPrompt;
    const raw = `${RC}IMPORTANT: Do not use any tools. Answer based on your knowledge only.\nWas ist 2+2?\n4${RESET}`;
    const stripped = stripAnsi(raw);
    const result = extractResponse(stripped, raw, userPrompt, effectivePrompt);
    assert.equal(result, '4');
  });

  it('strips no-tools prefix echo with ConPTY space-loss', () => {
    const prefix = 'IMPORTANT: Do not use any tools. Answer based on your knowledge only.\n';
    const userPrompt = 'Was ist 2+2?';
    const effectivePrompt = prefix + userPrompt;
    const raw = `${RC}IMPORTANT:Donotuse any tools. Answer based on your knowledgeonly.Was ist2+2?4${RESET}`;
    const stripped = stripAnsi(raw);
    const result = extractResponse(stripped, raw, userPrompt, effectivePrompt);
    assert.equal(result, '4');
  });

  it('falls back to promptFilter when effectiveFilter does not match', () => {
    const prompt = 'Was ist die Hauptstadt';
    const raw = `${RC}Was ist die Hauptstadt von Bayern?\nMünchen.${RESET}`;
    const stripped = stripAnsi(raw);
    const result = extractResponse(stripped, raw, prompt, 'UNRELATED PREFIX\n' + prompt);
    assert.ok(result.includes('München'));
  });

  it('works with empty effectiveFilter (backward compat)', () => {
    const raw = `${RC}response text${RESET}`;
    const stripped = stripAnsi(raw);
    assert.equal(extractResponse(stripped, raw, '', ''), 'response text');
  });
});

// ---------- PERMISSION_PRESETS ----------

describe('PERMISSION_PRESETS', () => {
  const modes = ['sandbox', 'skip-permissions', 'no-tools', 'researcher', 'read-only'];

  it('has all 5 modes', () => {
    for (const mode of modes) {
      assert.ok(PERMISSION_PRESETS[mode], `Missing mode: ${mode}`);
    }
  });

  it('each mode has required fields', () => {
    for (const mode of modes) {
      const p = PERMISSION_PRESETS[mode];
      assert.ok(Array.isArray(p.agyFlags), `${mode}: agyFlags missing`);
      assert.ok(Array.isArray(p.allow), `${mode}: allow missing`);
      assert.ok(Array.isArray(p.deny), `${mode}: deny missing`);
    }
  });

  it('no-tools has promptPrefix', () => {
    assert.ok(PERMISSION_PRESETS['no-tools'].promptPrefix);
    assert.ok(PERMISSION_PRESETS['no-tools'].promptPrefix.includes('tools'));
  });

  it('sandbox has no custom rules', () => {
    assert.equal(PERMISSION_PRESETS.sandbox.allow.length, 0);
    assert.equal(PERMISSION_PRESETS.sandbox.deny.length, 0);
  });

  it('skip-permissions uses dangerously flag', () => {
    assert.ok(PERMISSION_PRESETS['skip-permissions'].agyFlags.includes('--dangerously-skip-permissions'));
  });

  it('researcher allows search but denies writes', () => {
    const r = PERMISSION_PRESETS.researcher;
    assert.ok(r.allow.some(a => a.includes('search')));
    assert.ok(r.deny.some(d => d.includes('write_file')));
  });

  it('researcher denies shell commands to keep the preset read-only', () => {
    assert.ok(PERMISSION_PRESETS.researcher.deny.includes('command(*)'));
  });

  it('read-only denies shell commands to prevent command-based writes', () => {
    assert.ok(PERMISSION_PRESETS['read-only'].deny.includes('command(*)'));
  });
});

// ---------- Pattern Detection ----------

describe('TRUST_DIALOG_PATTERN', () => {
  it('detects trust dialog', () => {
    assert.ok(TRUST_DIALOG_PATTERN.test('Do you trust the contents of this project?'));
  });

  it('detects German trust dialog variants', () => {
    assert.ok(TRUST_DIALOG_PATTERN.test('Vertrauen Sie dem Inhalt dieses Projekts?'));
    assert.ok(TRUST_DIALOG_PATTERN.test('Vertraust du den Inhalten dieses Ordners?'));
  });

  it('does not trigger on random text', () => {
    assert.ok(!TRUST_DIALOG_PATTERN.test('hello world'));
  });
});

describe('LOGIN_PROMPT_PATTERN', () => {
  it('detects "Select login method" prompt', () => {
    assert.ok(LOGIN_PROMPT_PATTERN.test('Select login method:'));
  });

  it('does not match startup banner "not signed in"', () => {
    assert.ok(!LOGIN_PROMPT_PATTERN.test('You are currently not signed in.'));
  });

  it('does not match generic "Sign in to continue"', () => {
    assert.ok(!LOGIN_PROMPT_PATTERN.test('Sign in to continue'));
  });

  it('does not trigger on normal output', () => {
    assert.ok(!LOGIN_PROMPT_PATTERN.test('Gemini 3.5 Flash'));
  });
});

describe('BANNER_MODEL_PATTERN', () => {
  it('matches Flash model with quality tier', () => {
    const m = 'Gemini 3.5 Flash (Medium)'.match(BANNER_MODEL_PATTERN);
    assert.ok(m);
    assert.equal(m[0], 'Gemini 3.5 Flash (Medium)');
  });

  it('matches Pro model with quality tier', () => {
    const m = 'Gemini 3.1 Pro (High)'.match(BANNER_MODEL_PATTERN);
    assert.ok(m);
    assert.equal(m[0], 'Gemini 3.1 Pro (High)');
  });

  it('matches model without quality tier', () => {
    const m = 'Gemini 2.0 Flash'.match(BANNER_MODEL_PATTERN);
    assert.ok(m);
    assert.equal(m[0], 'Gemini 2.0 Flash');
  });

  it('matches in surrounding text', () => {
    const m = '  Gemini 3.5 Pro  '.match(BANNER_MODEL_PATTERN);
    assert.ok(m);
    assert.equal(m[0], 'Gemini 3.5 Pro');
  });

  it('does not match random text', () => {
    assert.equal('hello world'.match(BANNER_MODEL_PATTERN), null);
  });
});

describe('STARTUP_DONE_PATTERNS', () => {
  it('detects shortcut hint', () => {
    assert.ok(STARTUP_DONE_PATTERNS.some(p => p.test('? for shortcuts')));
  });

  it('detects German shortcut hints', () => {
    assert.ok(STARTUP_DONE_PATTERNS.some(p => p.test('? für Tastenkürzel')));
    assert.ok(STARTUP_DONE_PATTERNS.some(p => p.test('? für Kurzbefehle')));
  });

  it('does not trigger on Antigravity CLI banner alone', () => {
    assert.ok(!STARTUP_DONE_PATTERNS.some(p => p.test('Antigravity CLI v1.0')));
  });

  it('does not trigger on random text', () => {
    assert.ok(!STARTUP_DONE_PATTERNS.some(p => p.test('hello world')));
  });
});

describe('INIT_DONE_PATTERNS', () => {
  it('detects German session summary', () => {
    assert.ok(INIT_DONE_PATTERNS.some(p => p.test('Zusammenfassung der Arbeit')));
  });

  it('detects German model identification', () => {
    assert.ok(INIT_DONE_PATTERNS.some(p => p.test('Ich verwende derzeit das Modell gemini-3.5-flash')));
    assert.ok(INIT_DONE_PATTERNS.some(p => p.test('Das aktive Modell ist gemini-3.5-flash')));
    assert.ok(INIT_DONE_PATTERNS.some(p => p.test('Modell wurde als gemini-3.5-pro gesetzt')));
  });

  it('detects English model patterns', () => {
    assert.ok(INIT_DONE_PATTERNS.some(p => p.test('active model is gemini-3.5-flash')));
    assert.ok(INIT_DONE_PATTERNS.some(p => p.test('using model gemini-3.5-pro')));
    assert.ok(INIT_DONE_PATTERNS.some(p => p.test('session initialized')));
    assert.ok(INIT_DONE_PATTERNS.some(p => p.test('session ready')));
  });

  it('is case insensitive for model patterns', () => {
    assert.ok(INIT_DONE_PATTERNS.some(p => p.test('das AKTIVE modell')));
    assert.ok(INIT_DONE_PATTERNS.some(p => p.test('ACTIVE MODEL')));
  });
});

describe('findAgyPath', () => {
  it('is a function', () => {
    assert.equal(typeof findAgyPath, 'function');
  });

  it('returns string or null', () => {
    const result = findAgyPath();
    assert.ok(result === null || typeof result === 'string');
  });

  it('AGY_PATH matches findAgyPath result', () => {
    assert.equal(AGY_PATH, findAgyPath());
  });
});

// ---------- cleanColorExtracted ----------

describe('cleanColorExtracted', () => {
  it('removes noise lines from color-extracted text', () => {
    const text = '└ Tip: Press ? to see keyboard shortcuts.\nVerifying the Constraints\n4\n└ Tip: Press ? to see keyboard shortcuts.';
    assert.equal(cleanColorExtracted(text), '4');
  });

  it('returns null for all-noise input', () => {
    assert.equal(cleanColorExtracted('└ Tip: shortcuts\nVerifying stuff'), null);
  });

  it('preserves multi-line responses', () => {
    const text = 'Line one.\nLine two.\nLine three.';
    assert.equal(cleanColorExtracted(text), 'Line one.\nLine two.\nLine three.');
  });

  it('returns null for empty/null input', () => {
    assert.equal(cleanColorExtracted(''), null);
    assert.equal(cleanColorExtracted(null), null);
  });
});

// ---------- Constants ----------

describe('DEFAULT_MODEL', () => {
  it('is gemini-3.5-flash', () => {
    assert.equal(DEFAULT_MODEL, 'gemini-3.5-flash');
  });
});

// ---------- STARTUP_FALLBACK_MS ----------

describe('STARTUP_FALLBACK_MS', () => {
  it('is 30000ms', () => {
    assert.equal(STARTUP_FALLBACK_MS, 30000);
  });
});

// ---------- statusStartupFallback locale ----------

describe('statusStartupFallback locale', () => {
  it('exists in all supported locales', () => {
    for (const lang of ['en', 'de', 'es', 'zh-Hans', 'ja', 'ru']) {
      const msg = getMessage('statusStartupFallback', lang, { timeout: 30000 });
      assert.ok(msg.length > 0, `statusStartupFallback missing for locale ${lang}`);
      assert.ok(msg.includes('30000'), `statusStartupFallback does not interpolate timeout for locale ${lang}`);
    }
  });

  it('en message mentions proceeding', () => {
    const msg = getMessage('statusStartupFallback', 'en', { timeout: 30000 });
    assert.ok(msg.toLowerCase().includes('proceed') || msg.toLowerCase().includes('continuing'));
  });
});

// ---------- parseDurationToMs ----------

describe('parseDurationToMs', () => {
  it('parses basic seconds', () => {
    assert.equal(parseDurationToMs('20s'), 20000);
    assert.equal(parseDurationToMs('1.5s'), 1500);
  });

  it('parses basic minutes', () => {
    assert.equal(parseDurationToMs('2m'), 120000);
  });

  it('parses composite durations', () => {
    assert.equal(parseDurationToMs('5m0s'), 300000);
    assert.equal(parseDurationToMs('1h30m'), 5400000);
  });

  it('parses milliseconds', () => {
    assert.equal(parseDurationToMs('500ms'), 500);
  });

  it('handles plain numbers as seconds (lenient fallback)', () => {
    assert.equal(parseDurationToMs('20'), 20000);
    assert.equal(parseDurationToMs('0.5'), 500);
  });

  it('returns null for invalid input', () => {
    assert.equal(parseDurationToMs('invalid'), null);
    assert.equal(parseDurationToMs(''), null);
    assert.equal(parseDurationToMs(null), null);
  });
});

// ---------- Response RGB parsing ----------

describe('DEFAULT_RESPONSE_RGB', () => {
  it('is the verified Windows response color', () => {
    assert.deepEqual(DEFAULT_RESPONSE_RGB, [232, 234, 237]);
  });
});

describe('parseResponseRgb', () => {
  it('parses comma-separated RGB triples', () => {
    assert.deepEqual(parseResponseRgb('1,2,3'), [1, 2, 3]);
  });

  it('parses semicolon-separated RGB triples', () => {
    assert.deepEqual(parseResponseRgb('232;234;237'), [232, 234, 237]);
  });

  it('trims whitespace', () => {
    assert.deepEqual(parseResponseRgb(' 10, 20, 30 '), [10, 20, 30]);
  });

  it('rejects invalid values', () => {
    assert.equal(parseResponseRgb('1,2'), null);
    assert.equal(parseResponseRgb('1,2,999'), null);
    assert.equal(parseResponseRgb('abc'), null);
    assert.equal(parseResponseRgb(''), null);
    assert.equal(parseResponseRgb(null), null);
  });
});

describe('responseRgbToSgrParams', () => {
  it('converts RGB arrays to SGR params', () => {
    assert.equal(responseRgbToSgrParams([1, 2, 3]), '38;2;1;2;3');
  });
});

// ---------- i18n Locales ----------

describe('detectLocale', () => {
  it('detects locale from options priority', () => {
    assert.equal(detectLocale('de'), 'de');
    assert.equal(detectLocale('ES'), 'es');
    assert.equal(detectLocale('zh'), 'zh-Hans');
    assert.equal(detectLocale('zh-hans'), 'zh-Hans');
    assert.equal(detectLocale('ja'), 'ja');
    assert.equal(detectLocale('ru'), 'ru');
    assert.equal(detectLocale('unknown'), 'en');
  });

  it('detects locale from environment variables', () => {
    assert.equal(detectLocale(null, { LANG: 'de_DE.UTF-8' }), 'de');
    assert.equal(detectLocale(null, { LANG: 'ja_JP' }), 'ja');
    assert.equal(detectLocale(null, { LANG: 'zh_CN.gbk' }), 'zh-Hans');
  });

  it('uses standard environment variable priority', () => {
    assert.equal(detectLocale(null, {
      LANG: 'de_DE.UTF-8',
      LC_MESSAGES: 'es_ES.UTF-8',
      LC_ALL: 'ja_JP.UTF-8',
    }), 'ja');
    assert.equal(detectLocale(null, {
      LANG: 'de_DE.UTF-8',
      LC_MESSAGES: 'ru_RU.UTF-8',
    }), 'ru');
  });

  it('defaults to en for empty/unsupported values', () => {
    assert.equal(detectLocale(null, {}), 'en');
    assert.equal(detectLocale('fr', {}), 'en');
  });
});

describe('getMessage', () => {
  it('returns translation for valid keys', () => {
    assert.ok(getMessage('usage', 'de').includes('Optionen:'));
    assert.ok(getMessage('usage', 'es').includes('Opciones:'));
    assert.ok(getMessage('usage', 'zh-Hans').includes('选项:'));
    assert.ok(getMessage('usage', 'ja').includes('オプション:'));
    assert.ok(getMessage('usage', 'ru').includes('Опции:'));
  });

  it('interpolates placeholders correctly', () => {
    assert.equal(getMessage('errUnknownOption', 'en', { arg: '--foo' }), 'Error: Unknown option: --foo\n\n');
    assert.equal(getMessage('errUnknownOption', 'de', { arg: '--foo' }), 'Fehler: Unbekannte Option: --foo\n\n');
  });

  it('falls back to English when key or locale missing', () => {
    assert.equal(getMessage('errNoPrompt', 'invalid_locale'), getMessage('errNoPrompt', 'en'));
  });

  it('handles $ special chars in placeholder values without corruption', () => {
    // Bug B: raw string replace() treats $& as "the matched string" — use function form
    assert.equal(
      getMessage('errAgyNotAt', 'en', { path: 'C:\\test$&suffix' }),
      '[agy-companion] agy not found at: C:\\test$&suffix\n'
    );
    assert.equal(
      getMessage('errAgyNotAt', 'en', { path: "C:\\prefix$'suffix" }),
      "[agy-companion] agy not found at: C:\\prefix$'suffix\n"
    );
  });
});

// ---------- detectResponseComplete ----------

describe('detectResponseComplete', () => {
  it('detects final > after echo as response-complete', () => {
    const response = '> Was ist 2+2?\nDie Antwort ist 4.\n>';
    assert.equal(detectResponseComplete(response, 'Was ist 2+2'), true);
  });

  it('rejects mid-response bare > when real content follows', () => {
    // Bug-Fix: frueheres break ignorierte Inhalt nach dem ersten >
    const response = '> Was ist 2+2?\nDie Antwort ist 4.\n>\nWeiterer Inhalt hier.';
    assert.equal(detectResponseComplete(response, 'Was ist 2+2'), false);
  });

  it('accepts final > after mid-response > when content appeared between them', () => {
    const response = '> Was ist 2+2?\nDie Antwort ist 4.\n>\nWeiterer Inhalt.\n>';
    assert.equal(detectResponseComplete(response, 'Was ist 2+2'), true);
  });

  it('returns false when no > seen after echo', () => {
    const response = '> Was ist 2+2?\nDie Antwort ist 4.';
    assert.equal(detectResponseComplete(response, 'Was ist 2+2'), false);
  });

  it('returns false when question echo not found', () => {
    const response = 'Die Antwort ist 4.\n>';
    assert.equal(detectResponseComplete(response, 'Andere Frage'), false);
  });

  it('returns false when userPromptForFilter is empty', () => {
    const response = 'Die Antwort ist 4.\n>';
    assert.equal(detectResponseComplete(response, ''), false);
  });

  it('ignores noise lines after candidate >', () => {
    const response = '> Was ist 2+2?\nDie Antwort ist 4.\n>\n1234 tokens\nGemini 3.5 Flash';
    assert.equal(detectResponseComplete(response, 'Was ist 2+2'), true);
  });

  it('rejects multiple > without content between (empty blockquote spam)', () => {
    // Three bare > at end: last one should still be detected as complete
    const response = '> Was ist 2+2?\nAntwort.\n>\n>\n>';
    assert.equal(detectResponseComplete(response, 'Was ist 2+2'), true);
  });
});

// ---------- shouldResetIdleTimer ----------

describe('shouldResetIdleTimer', () => {
  it('returns false for trickle below threshold', () => {
    assert.equal(
      shouldResetIdleTimer({ newLength: 5, lastProgressLength: 0, minProgressBytes: RESPONSE_MIN_PROGRESS_BYTES, responseComplete: false, lastResponseComplete: false }),
      false
    );
  });

  it('returns true when progress meets threshold', () => {
    assert.equal(
      shouldResetIdleTimer({ newLength: 10, lastProgressLength: 0, minProgressBytes: RESPONSE_MIN_PROGRESS_BYTES, responseComplete: false, lastResponseComplete: false }),
      true
    );
  });

  it('returns true when responseComplete transitions from false to true', () => {
    assert.equal(
      shouldResetIdleTimer({ newLength: 3, lastProgressLength: 0, minProgressBytes: RESPONSE_MIN_PROGRESS_BYTES, responseComplete: true, lastResponseComplete: false }),
      true
    );
  });

  it('returns false when responseComplete remains true (prevents trickle-reset)', () => {
    assert.equal(
      shouldResetIdleTimer({ newLength: 5, lastProgressLength: 3, minProgressBytes: RESPONSE_MIN_PROGRESS_BYTES, responseComplete: true, lastResponseComplete: true }),
      false
    );
  });

  it('returns true when responseComplete transitions from true to false', () => {
    assert.equal(
      shouldResetIdleTimer({ newLength: 15, lastProgressLength: 10, minProgressBytes: RESPONSE_MIN_PROGRESS_BYTES, responseComplete: false, lastResponseComplete: true }),
      true
    );
  });

  it('RESPONSE_MIN_PROGRESS_BYTES is 10', () => {
    assert.equal(RESPONSE_MIN_PROGRESS_BYTES, 10);
  });
});

describe('doctor helpers', () => {
  it('parses semverish agy versions from text', () => {
    assert.equal(parseSemverishVersion('Antigravity CLI 1.0.6'), '1.0.6');
    assert.equal(parseSemverishVersion('Gemini CLI v1.1.2-beta.1'), '1.1.2-beta.1');
    assert.equal(parseSemverishVersion('no version here'), null);
  });

  it('maps agy version to model-flag support', () => {
    assert.equal(versionSupportsModelFlag('1.0.9'), false);
    assert.equal(versionSupportsModelFlag('1.1.0'), true);
    assert.equal(versionSupportsModelFlag('2.0.0'), true);
    assert.equal(versionSupportsModelFlag(null), null);
  });

  it('detects POSIX spawn-helper and executable bit from artifact tree', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-companion-artifacts-'));
    try {
      const packageRoot = path.join(tempRoot, 'node-pty');
      const prebuildDir = path.join(packageRoot, 'prebuilds', 'darwin-arm64');
      fs.mkdirSync(prebuildDir, { recursive: true });
      const helperPath = path.join(prebuildDir, 'spawn-helper');
      const nativePath = path.join(prebuildDir, 'pty.node');
      fs.writeFileSync(helperPath, '#!/bin/sh\nexit 0\n', 'utf8');
      fs.writeFileSync(nativePath, '', 'utf8');

      if (process.platform !== 'win32') {
        fs.chmodSync(helperPath, 0o755);
      }

      const report = inspectNodePtyArtifacts(packageRoot, 'darwin', 'arm64');
      assert.equal(report.nativeBinaryPath, nativePath);
      assert.equal(report.helperPath, helperPath);
      assert.equal(report.helperExists, true);
      assert.equal(report.helperExecutable, true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
