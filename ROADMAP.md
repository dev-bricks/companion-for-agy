# Roadmap

## Platform Status

| Platform | Status | Notes |
|----------|--------|-------|
| **Windows** | Verified | ConPTY, agy >= 1.1, RGB(232,234,237) confirmed |
| **macOS** | Untested | node-pty (forkpty) expected to work, color values unconfirmed |
| **Linux** | Untested | node-pty (forkpty) expected to work, color values unconfirmed |

## Planned

### macOS / Linux Support

The tool is currently **Windows-only verified**. macOS and Linux are expected to work via `node-pty` (which uses forkpty instead of ConPTY), but the following items need verification:

**TODOs:**
- [ ] Verify ANSI response color on macOS (is it still `RGB(232,234,237)` or does agy use a different palette?)
- [ ] Verify ANSI response color on Linux
- [ ] Handle agy v1.0.x (Homebrew `antigravity-cli`) which lacks `--model` flag — make `--model` conditional or skip it when agy version < 1.1
- [ ] Test node-pty spawn-helper permissions after `npm install` on macOS (prebuilt binaries need +x)
- [ ] Test trust dialog auto-confirmation flow on macOS/Linux
- [ ] Add platform-specific CI smoke tests (requires agy authentication in CI — may need to remain manual)

**Diagnostics available now:**
- `--debug` flag saves raw PTY output to `agy-debug.log` — inspect for actual ANSI color codes on any platform
- `AGY_COMPANION_RESPONSE_RGB` environment variable override (planned, not yet implemented)

### Color Fallback / Auto-Probe
The current ANSI color extraction relies on `RGB(232,234,237)` as the response color. This has been verified on Windows (ConPTY). If agy changes its color scheme or uses different values on macOS/Linux, extraction silently fails.

**Ideas:**
- `--probe-color`: Run a known-answer prompt ("What is 2+2?"), scan the raw ANSI stream for the color that wraps "4", and cache it per platform
- Platform-specific RGB override via environment variable (`AGY_COMPANION_RESPONSE_RGB`)
- Heuristic: find the most frequent non-UI color in the stream

### Internationalization (i18n)

Currently, pattern matching (trust dialog, startup detection, init detection) relies on English agy output strings, with partial German support for init patterns. CLI help text and error messages are English-only.

**Pattern Recognition (critical):**
- [ ] Audit all regex patterns (`TRUST_DIALOG_PATTERN`, `STARTUP_DONE_PATTERNS`, `INIT_DONE_PATTERNS`) for locale dependency
- [ ] Add German patterns for trust dialog and startup detection
- [ ] Test with agy running in non-English locales — does agy localize its TUI strings?
- [ ] Fallback strategy: if no known pattern matches within timeout, proceed anyway (graceful degradation)

**CLI Output:**
- [ ] Extract all user-facing strings (help text, error messages, status output) into a locale map
- [ ] Auto-detect locale from `LANG`/`LC_ALL` environment variable or `--lang` flag
- [ ] Supported languages: English (default), German

**Documentation:**
- [x] README.md (English) + README_de.md (German) with language switcher badges
- [ ] CONTRIBUTING.md — German translation
- [ ] CHANGELOG.md — bilingual or German translation

### Multi-Turn Mode
Currently, each invocation spawns a fresh agy process (one question, one answer). A persistent mode that keeps the PTY alive across multiple prompts would reduce startup overhead for batch workloads.

### Streaming Output
Emit response tokens as they arrive (line-by-line or chunk-by-chunk) instead of buffering until completion. Useful for long responses where the caller wants progressive output.

### Response Format Detection
Detect whether agy's response is Markdown, JSON, or plain text and expose this in the JSON output (`"format": "markdown"`).

## Completed (v1.2.0-alpha.1)

- Trust dialog auto-confirmation (5-phase state machine)
- Banner model detection (actual model from agy's banner)
- Short response noise filter fix (answers like "4" or "42")
- Prompt-echo stripping in no-tools mode (ConPTY space-loss tolerant)
- Cross-platform agy binary auto-detection
- node-pty as standard npm dependency
