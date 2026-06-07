# Changelog

## [Unreleased]

## [1.3.1] - 2026-06-07

### Fixed (Bugsweep)
- **detectResponseComplete:** Mid-response bare `>` (e.g. Markdown blockquotes, agy status lines) no longer triggers premature response-complete detection; the new `foundPromptCandidate` approach scans the full buffer and resets on real content after a candidate (`ed1436d`).
- **getMessage:** Placeholder values containing `$&`, `$'`, `` $` `` or `$n` were corrupted by JavaScript's `String.prototype.replace` special-pattern expansion; replacement now uses the function form `() => String(val)` to prevent any substitution (`5470404`).

## [1.3.0] - 2026-06-07

### Added
- CLI localization via `--lang <code>` and locale auto-detection.
- Supported CLI/documentation languages: English, German, Spanish, Simplified Chinese, Japanese, and Russian.
- New localization module `src/locales.mjs`.
- Translated README files: `README_de.md`, `README_es.md`, `README_zh-Hans.md`, `README_ja.md`, `README_ru.md`.
- German changelog: `CHANGELOG_de.md`.
- CLI regression tests for localized help and parsing errors.

### Changed
- User-facing CLI strings are now read from locale maps instead of being hardcoded in `src/agy-companion.mjs`.
- `package.json` now includes all localized documentation files in the npm package.
- Documentation now distinguishes CLI output localization, documentation translation, and agy TUI recognition patterns.

### Fixed
- Empty/non-extractable responses now exit nonzero instead of falling back to startup banner text or reporting success.
- Shutdown no longer force-kills the PTY when `Ctrl+C` already produced a clean exit, avoiding late `node-pty` cleanup stacktraces in successful runs.
- `researcher` and `read-only` permission presets now deny `command(*)` to prevent command-based writes.
- Unknown CLI options now fail fast; `--` can be used before prompts that start with a dash.
- Response color can now be overridden via `AGY_COMPANION_RESPONSE_RGB`.
- German trust/startup patterns, signal cleanup, dead-code cleanup, and one-character prompt/answer handling are covered by tests.
- agy v1.0.x can be used by omitting the model flag via `--no-model` or `AGY_COMPANION_NO_MODEL`.

## [1.2.0] - 2026-06-07

### Fixed (Bugsweep)
- **Security:** Stale temp workspace from crashed run with same PID could leak permissions to a new run; it is now cleaned on startup (`e8c5230`).
- Temp directory leak in sandbox/skip-permissions modes when no custom rules are set (`d406299`).
- Temp cleanup race on Windows: post-kill delay plus `rmSync` retries for CWD locks (`41412d6`).
- ConPTY text extraction: stale cursor position, bold SGR false positive, and too-narrow deduplication scope (`c2194bb`).
- `isNoiseLine` false positives for blockquotes (`>`) and lines containing the word "tokens" (`f6a8e7b`).

## [1.2.0-alpha.2] - 2026-06-07

### Changed
- Brand ASCII banner aligned to the left in READMEs.
- Switched image source to raw GitHub URLs to fix logo rendering on npmjs.com.

### Fixed
- Handled additional CLI tip noise (lines starting with `└`) and "Verifying..." lines in the output parser.

## [1.2.0-alpha.1] - 2026-06-07

### Changed
- Package renamed to `companion-for-agy` for legal/trademark distancing via the "for" pattern.
- Added "Unofficial" disclaimer to README and package description.

### Fixed
- Short responses (2 or fewer characters like "4", "42", "ja") were incorrectly filtered as noise.
- Prompt-echo bug in `--no-tools` mode: the permission prefix was returned as the response instead of the actual answer.
- ConPTY space loss in prompt echo: whitespace-normalized matching now handles "Donotuse" versus "Do not use".

### Added
- `stripPromptEcho()` for whitespace-tolerant prompt echo removal.
- `extractResponse()` accepts a fourth parameter, `effectiveFilter`, for full prompt echo stripping.
- 5-phase state machine with a trust dialog auto-confirmation phase.
- Banner model detection: JSON reports the actual model from agy's banner.
- 26 new tests (107 total): short-answer extraction, prompt echo regression, and `stripPromptEcho` unit tests.
- `companion-for-agy` CLI alias alongside `agy-companion` for backward compatibility.

## [1.1.0] - 2026-06-06

### Changed
- Cross-platform support: Windows, macOS, Linux (`node-pty` handles platform-specific PTYs).
- Auto-detection of the agy binary via PATH, common install locations, and environment variable fallback.
- `node-pty` loaded as a standard npm dependency, without a hardcoded path to gemini-cli internals.
- Debug log writes to `./agy-debug.log` instead of `~/.claude/scripts/`.
- CLI messages and usage text in English for an international audience.
- Added English `INIT_DONE_PATTERNS` alongside German ones.
- Removed the `"os": ["win32"]` restriction from `package.json`.

### Added
- Exported `findAgyPath()` for programmatic agy detection.
- Test suite: 81 tests (unit, fixture, smoke) via `node:test`.
- `npm run deploy` and `npm run sync` scripts for local copy management.
- Comprehensive README with installation, troubleshooting, and usage docs.

## [1.0.0] - 2026-06-06

### Added
- ConPTY-based wrapper for agy (Antigravity CLI).
- ANSI-color-based response extraction (`RGB(232,234,237)`).
- Line-based noise-filter fallback.
- 4-phase state machine (startup, init, question, response).
- Adaptive timing: 10s during generation, 2.5s after completion.
- Permission system with 5 modes: sandbox, skip-permissions, no-tools, researcher, read-only.
- Custom allow/deny rules compatible with agy's `settings.json` format.
- JSON output mode (`--json`).
- Configurable paths via environment variables.
- Prompt sanitization against PTY injection.
- Graceful shutdown.
- Debug mode with PTY output log.
