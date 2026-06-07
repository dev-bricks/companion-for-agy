# Changelog

## [1.2.0-alpha.1] - 2026-06-07

### Changed
- Package renamed to `companion-for-agy` (legal/trademark distancing via "for" pattern)
- Added "Unofficial" disclaimer to README and package description

### Fixed
- Short responses (≤2 chars like "4", "42", "ja") were incorrectly filtered as noise
- Prompt-echo bug in `--no-tools` mode: the permission prefix ("IMPORTANT: Do not use...") was returned as the response instead of the actual answer
- ConPTY space-loss in prompt echo: whitespace-normalized matching now handles "Donotuse" vs "Do not use"

### Added
- `stripPromptEcho()` — whitespace-tolerant prompt echo removal (word-by-word regex)
- `extractResponse()` now accepts 4th parameter `effectiveFilter` for full prompt echo stripping
- 5-phase state machine: Trust dialog auto-confirmation phase
- Banner model detection: JSON reports actual model from agy's banner
- 26 new tests (107 total): short answer extraction, prompt echo regression, stripPromptEcho unit tests
- `companion-for-agy` CLI alias (alongside `agy-companion` for backward compatibility)

## [1.1.0] - 2026-06-06

### Changed
- Cross-platform support: Windows, macOS, Linux (node-pty handles platform-specific PTY)
- Auto-detection of agy binary via PATH, common install locations, env var fallback
- node-pty loaded as standard npm dependency (no hardcoded path to gemini-cli internals)
- Debug log writes to `./agy-debug.log` (CWD) instead of `~/.claude/scripts/`
- CLI messages and usage text in English for international audience
- Added English INIT_DONE_PATTERNS alongside German ones
- Removed `"os": ["win32"]` restriction from package.json

### Added
- `findAgyPath()` exported function for programmatic agy detection
- Test suite: 81 tests (unit, fixture, smoke) via `node:test`
- `npm run deploy` and `npm run sync` scripts for local copy management
- Comprehensive README with installation, troubleshooting, and usage docs

## [1.0.0] - 2026-06-06

### Hinzugefügt
- ConPTY-basierter Wrapper für agy (Antigravity CLI)
- ANSI-Color-basierte Response-Extraktion (RGB 232,234,237)
- Fallback: Zeilen-basierte Noise-Filterung
- 4-Phasen State-Machine (Startup → Init → Question → Response)
- Adaptives Timing (10s während Generierung, 2.5s nach Abschluss)
- Permission-System mit 5 Modi: sandbox, skip-permissions, no-tools, researcher, read-only
- Custom allow/deny Regeln (kompatibel mit agys settings.json-Format)
- JSON-Output-Modus (--json)
- Konfigurierbare Pfade via Umgebungsvariablen
- Prompt-Sanitisierung gegen PTY-Injection
- Graceful Shutdown (Ctrl+C → Grace-Period → kill)
- Debug-Modus mit PTY-Output-Log
