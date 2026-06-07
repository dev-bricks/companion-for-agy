import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractByResponseColor, extractResponse, stripAnsi, PERMISSION_PRESETS } from '../src/agy-companion.mjs';

const RC = '\x1b[38;2;232;234;237m';
const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

// ---------- Synthetic ANSI fixtures mimicking real agy TUI output ----------

const FIXTURES = {
  simpleResponse: [
    '\x1b]0;agy\x07',
    `${BOLD}Antigravity CLI${RESET}\n`,
    '? for shortcuts\n',
    '╭─────────────╮\n',
    `${DIM}> Was ist 2+2?${RESET}\n`,
    '╰─────────────╯\n',
    `${GREEN}⢾ Generating${RESET}\n`,
    `${RC}Die Antwort auf 2+2 ist 4.${RESET}\n`,
    '1234 tokens\n',
    '>\n',
  ].join(''),

  dripAnimation: [
    `${RC}Die${RESET}`,
    `${RC}Die Antwort${RESET}`,
    `${RC}Die Antwort auf${RESET}`,
    `${RC}Die Antwort auf 2+2 ist 4.${RESET}`,
  ].join(''),

  multilineMarkdown: [
    `${RC}# Überschrift\n${RESET}`,
    `${RC}\n${RESET}`,
    `${RC}Hier ist eine Liste:\n${RESET}`,
    `${RC}- Punkt 1\n${RESET}`,
    `${RC}- Punkt 2\n${RESET}`,
    `${RC}- Punkt 3${RESET}`,
  ].join(''),

  noColorFallback: [
    '? for shortcuts\n',
    'Gemini 3.5 Flash\n',
    '> prompt text here\n',
    'Die Hauptstadt von Bayern ist München.\n',
    'Sie liegt an der Isar.\n',
    '42 tokens\n',
  ].join(''),

  toolNoiseMixed: [
    `${RC}Ich schaue mir die Datei an.${RESET}\n`,
    `${GREEN}▸ Tool: read_file(/tmp/test.txt)${RESET}\n`,
    `Checking permissions...\n`,
    `Reading /tmp/test.txt\n`,
    `${RC}Die Datei enthält: Hello World.${RESET}\n`,
  ].join(''),

  emptyResponse: [
    '? for shortcuts\n',
    '╭──╮\n',
    '╰──╯\n',
    '>\n',
    '42 tokens\n',
  ].join(''),

  multiTurnWithPromptEcho: [
    `${RC}Erste Antwort.${RESET}\n`,
    '>\n',
    `${DIM}> Zweite Frage hier${RESET}\n`,
    `${RC}Zweite Antwort.${RESET}\n`,
  ].join(''),

  heavyDripWithNoise: [
    `${GREEN}⢾ Generating${RESET}\n`,
    `${RC}D${RESET}`,
    `${RC}Da${RESET}`,
    `${RC}Das${RESET}`,
    `${RC}Das ${RESET}`,
    `${RC}Das i${RESET}`,
    `${RC}Das is${RESET}`,
    `${RC}Das ist${RESET}`,
    `${RC}Das ist ${RESET}`,
    `${RC}Das ist e${RESET}`,
    `${RC}Das ist ei${RESET}`,
    `${RC}Das ist ein${RESET}`,
    `${RC}Das ist ein ${RESET}`,
    `${RC}Das ist ein T${RESET}`,
    `${RC}Das ist ein Te${RESET}`,
    `${RC}Das ist ein Tes${RESET}`,
    `${RC}Das ist ein Test${RESET}`,
    `${RC}Das ist ein Test.${RESET}`,
    '42 tokens\n',
  ].join(''),
};

const FIXTURE_BLOCKQUOTE = {
  responseWithBlockquote: [
    `${RC}Hier ist ein Zitat:\n${RESET}`,
    `${RC}\n${RESET}`,
    `${RC}> Dies ist ein Blockquote.\n${RESET}`,
    `${RC}> Es hat mehrere Zeilen.\n${RESET}`,
    `${RC}\n${RESET}`,
    `${RC}Ende der Antwort.${RESET}`,
  ].join(''),

  responseWithTokensWord: [
    `${RC}GPT-4 wurde auf Milliarden Tokens trainiert.\n${RESET}`,
    `${RC}Die Kontextlänge beträgt 128k tokens.${RESET}`,
  ].join(''),
};

const FIXTURE_SHORT = {
  singleDigit: `${DIM}⣾ Generating${RESET}\n${RC}4${RESET}\n42 tokens\n`,
  twoChars: `${RC}ja${RESET}\n`,
  shortWithNoise: `${GREEN}▸ Tool: calculate${RESET}\n${RC}42${RESET}\n100 tokens\n`,
};

// ---------- Fixture tests ----------

describe('Fixture: Simple response', () => {
  it('extracts response via color', () => {
    const result = extractByResponseColor(FIXTURES.simpleResponse);
    assert.equal(result, 'Die Antwort auf 2+2 ist 4.');
  });

  it('extractResponse returns same result', () => {
    const stripped = stripAnsi(FIXTURES.simpleResponse);
    const result = extractResponse(stripped, FIXTURES.simpleResponse);
    assert.equal(result, 'Die Antwort auf 2+2 ist 4.');
  });
});

describe('Fixture: Drip animation dedup', () => {
  it('deduplicates progressive renders to final text', () => {
    const result = extractByResponseColor(FIXTURES.dripAnimation);
    assert.equal(result, 'Die Antwort auf 2+2 ist 4.');
  });
});

describe('Fixture: Multiline Markdown', () => {
  it('preserves markdown structure', () => {
    const result = extractByResponseColor(FIXTURES.multilineMarkdown);
    assert.ok(result.includes('# Überschrift'));
    assert.ok(result.includes('Hier ist eine Liste:'));
    assert.ok(result.includes('- Punkt 1'));
    assert.ok(result.includes('- Punkt 3'));
  });
});

describe('Fixture: No color fallback', () => {
  it('falls back to line-based extraction', () => {
    const stripped = stripAnsi(FIXTURES.noColorFallback);
    const result = extractResponse(stripped, FIXTURES.noColorFallback);
    assert.ok(result.includes('München'));
    assert.ok(result.includes('Isar'));
  });

  it('filters noise from fallback result', () => {
    const stripped = stripAnsi(FIXTURES.noColorFallback);
    const result = extractResponse(stripped, FIXTURES.noColorFallback);
    assert.ok(!result.includes('tokens'));
    assert.ok(!result.includes('Gemini'));
    assert.ok(!result.includes('shortcuts'));
  });
});

describe('Fixture: Tool noise mixed with response', () => {
  it('extracts only response-colored text', () => {
    const result = extractByResponseColor(FIXTURES.toolNoiseMixed);
    assert.ok(result.includes('Ich schaue mir die Datei an.'));
    assert.ok(result.includes('Hello World'));
  });

  it('excludes non-response colored noise', () => {
    const result = extractByResponseColor(FIXTURES.toolNoiseMixed);
    assert.ok(!result.includes('▸ Tool'));
    assert.ok(!result.includes('Checking'));
    assert.ok(!result.includes('Reading'));
  });
});

describe('Fixture: Empty response', () => {
  it('color extraction returns null', () => {
    const result = extractByResponseColor(FIXTURES.emptyResponse);
    assert.equal(result, null);
  });

  it('extractResponse returns null', () => {
    const stripped = stripAnsi(FIXTURES.emptyResponse);
    const result = extractResponse(stripped, FIXTURES.emptyResponse);
    assert.equal(result, null);
  });
});

describe('Fixture: Multi-turn with prompt echo', () => {
  it('captures both response segments', () => {
    const result = extractByResponseColor(FIXTURES.multiTurnWithPromptEcho);
    assert.ok(result.includes('Erste Antwort.'));
    assert.ok(result.includes('Zweite Antwort.'));
  });
});

describe('Fixture: Blockquote preservation', () => {
  it('preserves blockquote lines in color-extracted response', () => {
    const raw = FIXTURE_BLOCKQUOTE.responseWithBlockquote;
    const stripped = stripAnsi(raw);
    const result = extractResponse(stripped, raw);
    assert.ok(result.includes('> Dies ist ein Blockquote.'));
    assert.ok(result.includes('> Es hat mehrere Zeilen.'));
    assert.ok(result.includes('Ende der Antwort.'));
  });

  it('preserves "tokens" word in real response content', () => {
    const raw = FIXTURE_BLOCKQUOTE.responseWithTokensWord;
    const stripped = stripAnsi(raw);
    const result = extractResponse(stripped, raw);
    assert.ok(result.includes('Milliarden Tokens'));
    assert.ok(result.includes('128k tokens'));
  });
});

describe('Fixture: Short answer extraction', () => {
  it('extracts single digit answer', () => {
    const result = extractByResponseColor(FIXTURE_SHORT.singleDigit);
    assert.equal(result, '4');
  });

  it('extractResponse keeps single digit', () => {
    const stripped = stripAnsi(FIXTURE_SHORT.singleDigit);
    assert.equal(extractResponse(stripped, FIXTURE_SHORT.singleDigit), '4');
  });

  it('extracts two-char answer', () => {
    assert.equal(extractByResponseColor(FIXTURE_SHORT.twoChars), 'ja');
  });

  it('extracts short answer among tool noise', () => {
    const result = extractByResponseColor(FIXTURE_SHORT.shortWithNoise);
    assert.equal(result, '42');
  });
});

describe('Fixture: Heavy drip animation (character-by-character)', () => {
  it('deduplicates to final text only', () => {
    const result = extractByResponseColor(FIXTURES.heavyDripWithNoise);
    assert.equal(result, 'Das ist ein Test.');
  });

  it('full pipeline extracts correctly', () => {
    const stripped = stripAnsi(FIXTURES.heavyDripWithNoise);
    const result = extractResponse(stripped, FIXTURES.heavyDripWithNoise);
    assert.equal(result, 'Das ist ein Test.');
  });
});

// ---------- No-tools prompt-echo regression ----------

describe('Fixture: No-tools prompt echo (regression)', () => {
  const prefix = PERMISSION_PRESETS['no-tools'].promptPrefix;
  const userPrompt = 'Was ist 2+2?';
  const effectivePrompt = prefix + userPrompt;

  it('strips clean prompt echo and keeps answer', () => {
    const raw = `${RC}${effectivePrompt}\n4${RESET}`;
    const stripped = stripAnsi(raw);
    const result = extractResponse(stripped, raw, userPrompt, effectivePrompt);
    assert.equal(result, '4');
  });

  it('strips ConPTY-mangled prompt echo (space-loss)', () => {
    const mangled = 'IMPORTANT:Donotuse any tools. Answer based on your knowledgeonly.\nWas ist2+2?';
    const raw = `${RC}${mangled}\n4${RESET}`;
    const stripped = stripAnsi(raw);
    const result = extractResponse(stripped, raw, userPrompt, effectivePrompt);
    assert.equal(result, '4');
  });

  it('returns null when only echo and no answer', () => {
    const raw = `${RC}${effectivePrompt}${RESET}`;
    const stripped = stripAnsi(raw);
    const result = extractResponse(stripped, raw, userPrompt, effectivePrompt);
    assert.equal(result, null);
  });
});

// ---------- Real ConPTY fixture: cursor-positioned multi-sentence with bold ----------

describe('Fixture: ConPTY cursor-positioned response with bold text', () => {
  const CUP = (r, c) => `\x1b[${r};${c}H`;
  const NOBOLD = '\x1b[22m';
  const ERCH = '\x1b[208X';

  const conptyResponse = [
    `\n  ${RC}Hier sind dr${RESET}`,
    `\n${RC}${CUP(14, 15)}ei Vorteile${RESET}`,
    `${RC}${CUP(14, 27)}von OSS:${RESET}`,
    `\n  ${RC}1. ${BOLD}Kost${NOBOLD}${RESET}`,
    `\n${RC}${BOLD}${CUP(16, 10)}eneffizienz:${NOBOLD}${RESET}`,
    `${RC}${CUP(16, 23)}Spart Geld.${RESET}`,
    `\n  ${RC}2. ${BOLD}Sicherheit:${NOBOLD} Code wird geprüft.${RESET}`,
    `\n  ${RC}3. ${BOLD}Flexibilität:${NOBOLD} Anpassbar.${RESET}`,
  ].join('');

  it('joins cursor-positioned segments with correct spacing', () => {
    const result = extractByResponseColor(conptyResponse);
    assert.ok(result.includes('Hier sind drei Vorteile von OSS:'));
  });

  it('captures bold text within response color', () => {
    const result = extractByResponseColor(conptyResponse);
    assert.ok(result.includes('Kosteneffizienz:'));
    assert.ok(result.includes('Sicherheit:'));
    assert.ok(result.includes('Flexibilität:'));
  });

  it('joins mid-word row wrap without spurious space', () => {
    const result = extractByResponseColor(conptyResponse);
    assert.ok(result.includes('Kosteneffizienz: Spart Geld.'));
    assert.ok(!result.includes('Kost eneffizienz'));
  });

  it('preserves inline text after bold markers', () => {
    const result = extractByResponseColor(conptyResponse);
    assert.ok(result.includes('Sicherheit: Code wird geprüft.'));
    assert.ok(result.includes('Flexibilität: Anpassbar.'));
  });
});

describe('Fixture: Real smoke test — no-tools with tip noise', () => {
  const prefix = PERMISSION_PRESETS['no-tools'].promptPrefix;
  const userPrompt = 'What is 2+2? Answer with just the number.';
  const effectivePrompt = prefix + userPrompt;

  it('strips prompt echo + tip lines + thinking noise, keeps "4"', () => {
    const mangled = [
      'IMPORTANT:Do not use any tools.Answer based on your knowledge only.',
      'What is2+2?Answer withjustthenumber.',
      '└ Tip: Press ? to see keyboard shortcuts.',
      '  Verifying the Constraints',
      '  4',
      '└ Tip: Press ? to see keyboard shortcuts.',
    ].join('\n');
    const raw = `${RC}${mangled}${RESET}`;
    const stripped = stripAnsi(raw);
    const result = extractResponse(stripped, raw, userPrompt, effectivePrompt);
    assert.equal(result, '4');
  });

  it('handles same scenario with extra whitespace', () => {
    const mangled = [
      'IMPORTANT:Donotuse any tools. Answer based on your knowledgeonly.What is2+2?Answer withjustthenumber.',
      '└ Tip: Press ? to see keyboard shortcuts.',
      'Verifying the Constraints',
      '4',
      '└ Tip: Press ? to see keyboard shortcuts.',
    ].join('\n');
    const raw = `${RC}${mangled}${RESET}`;
    const stripped = stripAnsi(raw);
    const result = extractResponse(stripped, raw, userPrompt, effectivePrompt);
    assert.equal(result, '4');
  });
});
