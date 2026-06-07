import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripAnsi, isNoiseLine, extractByResponseColor,
  sanitizeForPty, extractResponse, escapeRegex, stripPromptEcho,
  cleanColorExtracted,
  PERMISSION_PRESETS, TRUST_DIALOG_PATTERN, BANNER_MODEL_PATTERN,
  STARTUP_DONE_PATTERNS, INIT_DONE_PATTERNS,
  DEFAULT_MODEL, findAgyPath, AGY_PATH, parseDurationToMs,
} from '../src/agy-companion.mjs';

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

  it('handles response color toggling', () => {
    const other = '\x1b[38;2;100;100;100m';
    const raw = `${RC}first${other}gap${RC}second${RESET}`;
    assert.equal(extractByResponseColor(raw), 'firstsecond');
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
});

// ---------- Pattern Detection ----------

describe('TRUST_DIALOG_PATTERN', () => {
  it('detects trust dialog', () => {
    assert.ok(TRUST_DIALOG_PATTERN.test('Do you trust the contents of this project?'));
  });

  it('does not trigger on random text', () => {
    assert.ok(!TRUST_DIALOG_PATTERN.test('hello world'));
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
