import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '..', 'src', 'agy-companion.mjs');
const RC = '\\x1b[38;2;232;234;237m';
const RESET = '\\x1b[0m';

function makeFakeHarness(mode) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-companion-test-'));
  const fakeAgy = path.join(tempDir, process.platform === 'win32' ? 'agy.exe' : 'agy');
  const fakePty = path.join(tempDir, 'fake-pty.cjs');
  const eventLog = path.join(tempDir, 'events.log');
  fs.writeFileSync(fakeAgy, '', 'utf8');
  fs.writeFileSync(eventLog, '', 'utf8');
  fs.writeFileSync(fakePty, `
const fs = require('fs');
const mode = process.env.AGY_COMPANION_FAKE_MODE;
const eventLog = process.env.AGY_COMPANION_FAKE_EVENT_LOG;
const RC = '${RC}';
const RESET = '${RESET}';

function log(event) {
  fs.appendFileSync(eventLog, event + '\\n');
}

exports.spawn = function spawn(_cmd, args) {
  log('args:' + JSON.stringify(args));
  let dataCb = () => {};
  let exitCb = () => {};
  let exited = false;

  function emitExit(code = 0) {
    if (exited) return;
    exited = true;
    log('exit');
    exitCb({ exitCode: code });
  }

  setTimeout(() => {
    dataCb('Antigravity CLI 1.0.6\\nGemini 3.5 Flash (Medium)\\n? for shortcuts\\nsession ready\\n');
  }, 20);

  return {
    onData(cb) { dataCb = cb; },
    onExit(cb) { exitCb = cb; },
    write(text) {
      if (text === '\\x03') {
        log('ctrlc');
        setTimeout(() => emitExit(0), 20);
        return;
      }
      const prompt = text.replace(/\\r$/, '');
      log('prompt:' + prompt);
      setTimeout(() => {
        if (mode === 'hold') {
          dataCb('> ' + prompt + '\\n');
        } else if (mode === 'empty') {
          dataCb('> ' + prompt + '\\n42 tokens\\n>\\n');
        } else {
          dataCb('> ' + prompt + '\\n' + RC + 'OK' + RESET + '\\n>\\n');
        }
      }, 20);
    },
    kill() {
      log('kill');
      setTimeout(() => emitExit(0), 20);
    },
  };
};
`, 'utf8');

  return {
    tempDir,
    eventLog,
    env: {
      ...process.env,
      AGY_COMPANION_AGY_PATH: fakeAgy,
      AGY_COMPANION_PTY_PATH: fakePty,
      AGY_COMPANION_FAKE_MODE: mode,
      AGY_COMPANION_FAKE_EVENT_LOG: eventLog,
    },
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

describe('CLI regressions with fake PTY', () => {
  it('exits nonzero without falling back to startup banner when no response is extractable', async () => {
    const harness = makeFakeHarness('empty');
    try {
      await assert.rejects(
        execFileAsync('node', [SCRIPT, '--no-tools', '--timeout', '30000', 'EMPTY_PROMPT'], {
          env: harness.env,
          timeout: 60000,
        }),
        err => {
          assert.equal(err.code, 4);
          assert.equal(err.stdout, '');
          assert.match(err.stderr, /No usable response received/);
          assert.doesNotMatch(err.stdout, /Antigravity CLI/);
          return true;
        },
      );
    } finally {
      harness.cleanup();
    }
  });

  it('does not force-kill when Ctrl+C already lets the PTY exit cleanly', async () => {
    const harness = makeFakeHarness('ok');
    try {
      const { stdout } = await execFileAsync('node', [SCRIPT, '--no-tools', '--timeout', '30000', 'OK_PROMPT'], {
        env: harness.env,
        timeout: 60000,
      });
      assert.equal(stdout.trim(), 'OK');
      const events = fs.readFileSync(harness.eventLog, 'utf8');
      assert.match(events, /ctrlc/);
      assert.doesNotMatch(events, /kill/);
    } finally {
      harness.cleanup();
    }
  });

  it('rejects unknown options before starting agy', async () => {
    const harness = makeFakeHarness('ok');
    try {
      await assert.rejects(
        execFileAsync('node', [SCRIPT, '--timeuot', '30000', 'OK_PROMPT'], {
          env: harness.env,
          timeout: 10000,
        }),
        err => {
          assert.equal(err.code, 1);
          assert.match(err.stderr, /Unknown option: --timeuot/);
          assert.equal(fs.existsSync(harness.eventLog), true);
          assert.equal(fs.readFileSync(harness.eventLog, 'utf8'), '');
          return true;
        },
      );
    } finally {
      harness.cleanup();
    }
  });

  it('supports -- as a prompt separator for prompts that start with a dash', async () => {
    const harness = makeFakeHarness('ok');
    try {
      const { stdout } = await execFileAsync('node', [SCRIPT, '--no-tools', '--timeout', '30000', '--', '-dash prompt'], {
        env: harness.env,
        timeout: 60000,
      });
      assert.equal(stdout.trim(), 'OK');
      const events = fs.readFileSync(harness.eventLog, 'utf8');
      assert.match(events, /-dash prompt/);
    } finally {
      harness.cleanup();
    }
  });

  it('can omit --model for agy versions that do not support model flags', async () => {
    const harness = makeFakeHarness('ok');
    try {
      const { stdout } = await execFileAsync('node', [SCRIPT, '--no-tools', '--no-model', '--timeout', '30000', 'OK_PROMPT'], {
        env: harness.env,
        timeout: 60000,
      });
      assert.equal(stdout.trim(), 'OK');
      const events = fs.readFileSync(harness.eventLog, 'utf8');
      assert.doesNotMatch(events, /"--model"/);
      assert.match(events, /"--sandbox"/);
    } finally {
      harness.cleanup();
    }
  });

  it('can omit --model via AGY_COMPANION_NO_MODEL', async () => {
    const harness = makeFakeHarness('ok');
    try {
      const { stdout } = await execFileAsync('node', [SCRIPT, '--no-tools', '--timeout', '30000', 'OK_PROMPT'], {
        env: { ...harness.env, AGY_COMPANION_NO_MODEL: '1' },
        timeout: 60000,
      });
      assert.equal(stdout.trim(), 'OK');
      const events = fs.readFileSync(harness.eventLog, 'utf8');
      assert.doesNotMatch(events, /"--model"/);
    } finally {
      harness.cleanup();
    }
  });

  it('handles external SIGTERM with PTY cleanup', {
    skip: process.platform === 'win32' ? 'Windows child signals do not reliably invoke Node signal handlers' : undefined,
  }, async () => {
    const harness = makeFakeHarness('hold');
    try {
      const child = spawn('node', [SCRIPT, '--no-tools', '--timeout', '30000', 'HOLD_PROMPT'], {
        env: harness.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      await new Promise((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error('Timed out waiting for fake prompt')), 10000);
        const poll = setInterval(() => {
          const events = fs.readFileSync(harness.eventLog, 'utf8');
          if (events.includes('prompt:')) {
            clearInterval(poll);
            clearTimeout(deadline);
            resolve();
          }
        }, 50);
      });

      child.kill('SIGTERM');
      const exitCode = await new Promise(resolve => child.on('exit', code => resolve(code)));
      assert.equal(exitCode, 143);
      const events = fs.readFileSync(harness.eventLog, 'utf8');
      assert.match(events, /ctrlc/);
    } finally {
      harness.cleanup();
    }
  });

  it('outputs localized help text via --lang', async () => {
    const { stderr } = await execFileAsync('node', [SCRIPT, '--help', '--lang', 'de']);
    assert.match(stderr, /Inoffizieller PTY-Wrapper/);
  });

  it('outputs localized parsing errors via --lang', async () => {
    await assert.rejects(
      execFileAsync('node', [SCRIPT, '--lang', 'es', '--timeuot', '30000', 'PROMPT']),
      err => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /Opción desconocida: --timeuot/);
        return true;
      }
    );
  });
});
