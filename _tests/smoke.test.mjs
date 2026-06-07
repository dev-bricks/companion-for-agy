import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AGY_PATH } from '../src/agy-companion.mjs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '..', 'src', 'agy-companion.mjs');
const RESULTS_DIR = path.resolve(__dirname, '..', '_results');

if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

const agyExists = fs.existsSync(AGY_PATH);

// ---------- CLI basics (no agy needed) ----------

describe('Smoke: CLI basics', () => {
  it('--help exits 0 and shows usage', async () => {
    const { stderr } = await execFileAsync('node', [SCRIPT, '--help']);
    assert.ok(stderr.includes('companion-for-agy'));
    assert.ok(stderr.includes('--sandbox'));
    assert.ok(stderr.includes('--no-tools'));
  });

  it('no arguments exits 0 and shows usage', async () => {
    const { stderr } = await execFileAsync('node', [SCRIPT]);
    assert.ok(stderr.includes('Usage'));
  });
});

// ---------- Live agy tests (skip if agy not installed) ----------

describe('Smoke: Live agy query', {
  skip: !agyExists ? `agy nicht gefunden: ${AGY_PATH}` : undefined,
  timeout: 180000,
}, () => {
  it('answers a simple question', async () => {
    const logPrefix = `smoke-${Date.now()}`;
    try {
      const { stdout, stderr } = await execFileAsync('node', [
        SCRIPT, '--no-tools', '--timeout', '120000',
        'Antworte NUR mit dem Wort: Apfel',
      ], { timeout: 150000 });

      fs.writeFileSync(
        path.join(RESULTS_DIR, `${logPrefix}.log`),
        `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
        'utf8',
      );

      assert.ok(stdout.length > 0, 'stdout should not be empty');
      assert.doesNotMatch(stderr, /AttachConsole failed|conpty_console_list_agent/);
    } catch (err) {
      fs.writeFileSync(
        path.join(RESULTS_DIR, `${logPrefix}-error.log`),
        `ERROR:\n${err.message}\nSTDOUT:\n${err.stdout || ''}\nSTDERR:\n${err.stderr || ''}`,
        'utf8',
      );
      throw err;
    }
  });

  it('--json produces valid JSON output', async () => {
    const logPrefix = `smoke-json-${Date.now()}`;
    try {
      const { stdout, stderr } = await execFileAsync('node', [
        SCRIPT, '--no-tools', '--json', '--timeout', '120000',
        'Antworte NUR mit: ja',
      ], { timeout: 150000 });

      fs.writeFileSync(
        path.join(RESULTS_DIR, `${logPrefix}.log`),
        `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
        'utf8',
      );

      const parsed = JSON.parse(stdout.trim());
      assert.ok(parsed.response, 'JSON should have response field');
      assert.ok(parsed.model, 'JSON should have model field');
      assert.ok(parsed.permissionMode, 'JSON should have permissionMode field');
      assert.equal(parsed.permissionMode, 'no-tools');
      assert.doesNotMatch(stderr, /AttachConsole failed|conpty_console_list_agent/);
    } catch (err) {
      fs.writeFileSync(
        path.join(RESULTS_DIR, `${logPrefix}-error.log`),
        `ERROR:\n${err.message}\nSTDOUT:\n${err.stdout || ''}\nSTDERR:\n${err.stderr || ''}`,
        'utf8',
      );
      throw err;
    }
  });
});
