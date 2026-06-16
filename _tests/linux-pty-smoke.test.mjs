import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import {
  DEFAULT_RESPONSE_RGB,
  extractByResponseColor,
  inspectNodePtyArtifacts,
  resolveNodePtyModule,
  responseRgbToSgrParams,
} from '../src/agy-companion.mjs';

describe('Smoke: Linux forkpty path', {
  skip: process.platform !== 'linux' ? 'Linux-only PTY smoke' : undefined,
  timeout: 20000,
}, () => {
  it('spawns /bin/sh via node-pty and extracts the truecolor response', async () => {
    const nodePty = resolveNodePtyModule();
    assert.equal(nodePty.ok, true, nodePty.error?.message || 'node-pty should load on Linux');

    const artifacts = inspectNodePtyArtifacts(nodePty.packageRoot, 'linux', process.arch);
    assert.equal(artifacts.helperExists, true, `spawn-helper missing under ${artifacts.prebuildDir || '(unknown prebuild dir)'}`);
    assert.equal(artifacts.helperExecutable, true, `spawn-helper not executable: ${artifacts.helperPath || '(unknown helper path)'}`);
    assert.ok(artifacts.nativeBinaryPath, 'node-pty native binary should be located for Linux');

    const responseText = 'Linux PTY smoke OK';
    const rgb = responseRgbToSgrParams(DEFAULT_RESPONSE_RGB);
    const command = `printf '\\033[${rgb}m${responseText}\\033[0m\\n'`;
    const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    const rawChunks = [];

    const exitInfo = await new Promise((resolve, reject) => {
      const ptyProc = nodePty.pty.spawn('/bin/sh', ['-lc', command], {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: process.cwd(),
        env,
      });

      const timer = setTimeout(() => {
        try {
          ptyProc.kill();
        } catch (_) {}
        reject(new Error('Timed out waiting for Linux PTY smoke to exit'));
      }, 10000);

      ptyProc.onData(chunk => {
        rawChunks.push(chunk);
      });

      ptyProc.onExit(exit => {
        clearTimeout(timer);
        resolve(exit);
      });
    });

    assert.equal(exitInfo.exitCode, 0, 'shell smoke should exit cleanly');
    const raw = rawChunks.join('');
    assert.match(raw, /\x1b\[38;2;232;234;237m/, 'raw PTY output should contain the expected truecolor SGR');
    assert.equal(extractByResponseColor(raw), responseText);
  });
});
