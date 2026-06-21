# Roadmap

## Platform Status

| Platform | Status | Notes |
|----------|--------|-------|
| **Windows** | Verified | ConPTY, agy >= 1.1, RGB(232,234,237) confirmed |
| **macOS** | Untested | node-pty (forkpty) expected to work, color values unconfirmed |
| **Linux** | PTY smoke in CI | `node-pty`/`forkpty`, `spawn-helper`, native binary and `RGB(232,234,237)` ANSI extraction are covered by `_tests/linux-pty-smoke.test.mjs`; a real agy live smoke is still open |

## Planned

### macOS / Linux Support

The tool is currently **Windows-only verified**. macOS and Linux are expected to work via `node-pty` (which uses forkpty instead of ConPTY), but the following items need verification:

**TODOs:**
- [ ] Verify ANSI response color on macOS (is it still `RGB(232,234,237)` or does agy use a different palette?)
- [x] Add a Linux PTY smoke that exercises `node-pty`/`forkpty`, `spawn-helper`, native binary discovery and truecolor extraction without requiring agy authentication
- [x] Add bundled `--platform-smoke` / `npm run platform-smoke:json` gate that runs doctor + PTY smoke and prints the next authenticated live-smoke command for Mac/Linux handoff logs
- [x] Add an authenticated live-smoke mode (`--live-smoke`) that asks agy for `AGY_LIVE_SMOKE_OK`, emits text/JSON reports, and exits nonzero on marker mismatch
- [ ] Verify ANSI response color on Linux during a real agy session
- [x] Handle agy v1.0.x (Homebrew `antigravity-cli`) which lacks `--model` flag — `--model` can be skipped via `--no-model` or `AGY_COMPANION_NO_MODEL`
- [ ] Test node-pty spawn-helper permissions after `npm install` on macOS (prebuilt binaries need +x)
- [ ] Test trust dialog auto-confirmation flow on macOS/Linux
- [x] Add a Linux-specific CI smoke for the PTY path without agy authentication
- [ ] Add an agy-authenticated Linux live smoke when a safe CI credential path exists, otherwise keep that step manual

**Diagnostics available now:**
- `--debug` flag saves raw PTY output to `agy-debug.log` — inspect for actual ANSI color codes on any platform
- `AGY_COMPANION_RESPONSE_RGB` environment variable override for platform/theme-specific response colors
- `--platform-smoke --json` bundles the auth-free pre-live checks and records the exact next live-smoke command
- `--live-smoke --no-model --debug --json` is the repeatable authenticated gate after `--doctor` and `--pty-smoke` on macOS/Linux

### Color Fallback / Auto-Probe
The current ANSI color extraction relies on `RGB(232,234,237)` as the response color. This has been verified on Windows (ConPTY). If agy changes its color scheme or uses different values on macOS/Linux, extraction silently fails.

**Ideas:**
- `--probe-color`: Run a known-answer prompt ("What is 2+2?"), scan the raw ANSI stream for the color that wraps "4", and cache it per platform
- [x] Platform-specific RGB override via environment variable (`AGY_COMPANION_RESPONSE_RGB`)
- Heuristic: find the most frequent non-UI color in the stream

### Internationalization (i18n)

Internationalization is split into three surfaces:

1. **companion-for-agy CLI output**: help text, errors, and status messages owned by this wrapper.
2. **Documentation**: README, contributing guide, changelog, examples, and release notes.
3. **agy TUI recognition patterns**: internal regexes for trust dialog, startup readiness, init completion, prompt echo, and response completion.

Empirical status on Windows (2026-06-07): `agy --help` remained English under `LANG=en_US`, `de_DE`, `ja_JP`, and `zh_CN`. Treat agy's CLI help as English-only for now, but do not assume all TUI dialogs, plugins, future agy releases, or platform-specific flows will stay English.

Language target set for user-facing companion text:

| Code | Language | Priority | Scope |
|------|----------|----------|-------|
| `en` | English | P0 | Default CLI and canonical docs |
| `de` | German | P0 | First translated docs and CLI output |
| `es` | Spanish | P1 | Docs and CLI output |
| `zh-Hans` | Simplified Chinese | P1 | Docs and CLI output |
| `ja` | Japanese | P1 | Docs and CLI output |
| `ru` | Russian | P1 | Docs and CLI output |

Recognition-pattern policy: keep English as baseline; add non-English patterns only when observed in agy output or documented upstream. Avoid guessing translations for critical parser states because false positives can send prompts too early or terminate capture too late.

**Pattern Recognition (critical):**
- [x] Audit all regex patterns (`TRUST_DIALOG_PATTERN`, `STARTUP_DONE_PATTERNS`, `INIT_DONE_PATTERNS`) for locale dependency
- [x] Add German patterns for trust dialog and startup detection
- [x] Test agy CLI help under non-English locales — observed English output for `en_US`, `de_DE`, `ja_JP`, `zh_CN` on Windows
- [ ] Test full agy TUI under non-English locales — does agy localize dialogs beyond `--help`?
- [ ] Add observed Spanish, Simplified Chinese, Japanese, and Russian recognition patterns only if agy emits localized TUI strings
- [x] Fallback strategy: if no known pattern matches within timeout, proceed anyway (graceful degradation) — `STARTUP_FALLBACK_MS = 30000`, fires before global timeout, 6-locale status message, unit-tested (2026-06-16)

**CLI Output:**
- [x] Extract all user-facing strings (help text, error messages, status output) into a locale map
- [x] Auto-detect locale from `LANG`/`LC_ALL` environment variable or `--lang` flag
- [x] Supported CLI languages: English (default), German, Spanish, Simplified Chinese, Japanese, Russian

**Documentation:**
- [x] README.md (English) + README_de.md (German) with language switcher badges
- [x] CONTRIBUTING.md — German translation
- [x] CHANGELOG.md — bilingual or German translation
- [x] README_es.md — Spanish
- [x] README_zh-Hans.md — Simplified Chinese
- [x] README_ja.md — Japanese
- [x] README_ru.md — Russian

### Robust Response Return (stdout capture for long / non-ASCII / CJK responses)

The stdout return path is currently unreliable for **long, non-ASCII, or CJK content**: characters can be garbled into replacement characters (U+FFFD), as documented in the "Best Practices: Two Return Paths" section of the README. The capture happens through ConPTY/ANSI color extraction, where multi-byte sequences and terminal-buffer reflow can corrupt non-ASCII text.

**Current workaround:** let agy write its result to a file itself via `--add-dir` and read it from disk (lossless UTF-8, including CJK). This works but forces callers into a file-based contract instead of a clean stdout response.

**Goal:** make the return path itself robust, so the file-output workaround is no longer mandatory for bulky or non-ASCII responses.

**Ideas:**
- Harden the ConPTY capture's encoding handling: treat the PTY stream as a byte stream and decode UTF-8 only after reassembly, so multi-byte sequences split across chunks are not corrupted.
- Audit the ANSI/SGR extraction and terminal-buffer reflow handling for multi-byte/wide (CJK) characters and replacement-character insertion points.
- Add a structured `--json` output channel that carries the response losslessly (e.g. agy writing to a known temp file behind the scenes, or an explicit length-delimited/base64 transport), decoupling the response payload from terminal rendering.
- Regression tests with long and CJK (Chinese/Japanese/Korean) payloads asserting byte-exact round-trips, on Windows first, then macOS/Linux.

### Multi-Turn Mode
Currently, each invocation spawns a fresh agy process (one question, one answer). A persistent mode that keeps the PTY alive across multiple prompts would reduce startup overhead for batch workloads.

### Streaming Output
Emit response tokens as they arrive (line-by-line or chunk-by-chunk) instead of buffering until completion. Useful for long responses where the caller wants progressive output.

### Response Format Detection
Detect whether agy's response is Markdown, JSON, or plain text and expose this in the JSON output (`"format": "markdown"`).

### Robustness Improvements (from Bugsweep 2026-06-07)

Items identified during the systematic bug sweep that are design improvements, not defects:

- **Response idle timer minimum-progress threshold:** Currently, any single byte within the idle window resets the timer. A very slow stream (1 char/10s) keeps the timer alive indefinitely — only the global timeout catches it. Add a "minimum bytes since last check" threshold.
- [x] **Signal handling for external kill:** Register `process.on('SIGTERM')` and `process.on('SIGINT')` to ensure temp workspace cleanup when the process is killed externally (e.g., by a parent orchestrator or Ctrl+C in a pipeline).
- [x] **Dead code cleanup:** `tempSettingsCreated` variable is set but never read. Cleanup works unconditionally via `cleanupTemp()`.
- [x] **Prompt-echo filter edge case:** Very short prompts (≤2 chars) identical to the response text are incorrectly filtered as prompt echoes. Rare in practice (requires the user's question to be the same as the answer), but theoretically possible.

## Completed (v1.2.0-alpha.1)

- Trust dialog auto-confirmation (5-phase state machine)
- Banner model detection (actual model from agy's banner)
- Short response noise filter fix (answers like "4" or "42")
- Prompt-echo stripping in no-tools mode (ConPTY space-loss tolerant)
- Cross-platform agy binary auto-detection
- node-pty as standard npm dependency
