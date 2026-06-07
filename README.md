# companion-for-agy

<p align="center">
  <img src="assets/logo.png" alt="companion-for-agy Logo" width="200" height="200" />
</p>

[![Deutsch](https://img.shields.io/badge/lang-Deutsch-blue)](README_de.md)

> **Unofficial** — not affiliated with or endorsed by Google.

PTY-based wrapper for **agy** (Antigravity CLI / Gemini CLI) that captures Gemini responses from subprocesses.

## Problem

`agy -p` (print mode) returns exit 0 but writes no output to stdout — the TUI text-drip renderer (`text_drip.go`) writes to the terminal buffer instead. This is a known bug:

- [antigravity-cli#76](https://github.com/google-antigravity/antigravity-cli/issues/76)
- [gemini-cli#27466](https://github.com/google-gemini/gemini-cli/issues/27466)
- [antigravity-cli#115](https://github.com/google-antigravity/antigravity-cli/issues/115)

This means no other agent (Claude Code, Codex, CI/CD) can programmatically read agy's responses.

## Solution

`companion-for-agy` spawns agy inside a virtual terminal via `node-pty` (ConPTY on Windows, forkpty on macOS/Linux) and extracts the response from the ANSI color stream. agy's response text uses `RGB(232,234,237)` — the wrapper tracks ANSI color state and collects only text in that color.

> **Platform note:** The ANSI color extraction (`RGB(232,234,237)`) has been verified on **Windows** (ConPTY). macOS and Linux are expected to work via `node-pty` since agy uses the same Go TUI renderer, but the exact RGB values have not been independently confirmed on those platforms. If color extraction returns empty results, try `--debug` and check `agy-debug.log` for the actual color codes.

## Installation

```bash
npm install -g companion-for-agy
```

### Prerequisites

- **Node.js >= 18**
- **agy** ([Gemini CLI](https://github.com/google-gemini/gemini-cli)) installed and authenticated
- **C/C++ build tools** for `node-pty` native compilation:
  - **Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) + Python 3
  - **macOS:** `xcode-select --install`
  - **Linux:** `sudo apt install build-essential python3` (Debian/Ubuntu)

### Troubleshooting `node-pty` build errors

If `npm install` fails with native compilation errors:

```bash
# All platforms: rebuild native modules
npm rebuild node-pty

# Windows: if cl.exe is not found, install Visual Studio Build Tools
# then open "Developer Command Prompt" or run from "x64 Native Tools"
```

## Usage

```bash
companion-for-agy [options] "prompt"
```

### Permission Modes

| Flag | Description |
|------|-------------|
| `--sandbox` | Sandbox mode (default) — tools in container |
| `--skip-permissions` | All tools without confirmation (YOLO) |
| `--no-tools` | Pure chat — no tool execution |
| `--researcher` | Web search allowed, no file changes |
| `--read-only` | Read-only, no modifications |

### Custom Rules

```bash
--allow "read_file(/path)"    # Allowlist rule (repeatable)
--deny "command(rm)"           # Denylist rule (repeatable)
```

Formats match agy's own permission system (`settings.json`).

### Options

| Flag | Description |
|------|-------------|
| `--model <model>` | Gemini model (default: `gemini-3.5-flash`) |
| `--timeout <ms>` | Timeout in ms (default: 120000) |
| `--json` | Output as JSON object |
| `--debug` | Save raw PTY output to `agy-debug.log` |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `AGY_COMPANION_AGY_PATH` | Path to agy binary (auto-detected if not set) |
| `AGY_PATH` | Alternative path to agy binary |

### Examples

```bash
# Simple question
companion-for-agy "What is the capital of Bavaria?"

# As advisor (no tool use)
companion-for-agy --no-tools "Review this code: ..."

# Web research
companion-for-agy --researcher "Latest info on Node.js 24"

# Read-only with additional git permission
companion-for-agy --read-only --allow "command(git log)" "prompt"

# JSON output for programmatic use
companion-for-agy --json --model gemini-3.5-pro "prompt"
# → {"response":"...","model":"Gemini 3.5 Pro (High)","requestedModel":"gemini-3.5-pro","permissionMode":"sandbox"}
```

> **JSON fields:** `model` reports the actual model detected from agy's banner (e.g., `"Gemini 3.5 Flash (Medium)"`). `requestedModel` is what was passed via `--model`. If banner detection fails, `model` falls back to `requestedModel`.

## How It Works

```
┌────────────────────┐       PTY       ┌─────────────┐
│ companion-for-agy  │ ─────────────▸  │     agy     │
│     (Node.js)      │ ◂────────────── │  (Go TUI)   │
│                    │  ANSI stream    │             │
│  Color-Based       │                 │ text_drip.go│
│  Extraction        │                 │ RGB(232,234,│
│                    │                 │     237)    │
└────────┬───────────┘                 └─────────────┘
         │
         ▼ stdout
     Response text
```

**5-Phase State Machine:**

1. **Trust** — detect and auto-confirm workspace trust dialog
2. **Startup** — detect main UI readiness (`? for shortcuts`)
3. **Init** — wait for GEMINI.md initialization (pattern matching or 20s fallback)
4. **Question** — send prompt, set response marker
5. **Response** — read response via ANSI color extraction, adaptive idle timer

## Use Cases

- **Multi-agent orchestration**: Claude Code, Codex, or other agents querying Gemini via agy
- **CI/CD pipelines**: automated Gemini queries in build scripts
- **Scripting**: any scenario where agy's response needs to be captured as text

## Background

This tool was built because three CLI agents — **Claude Code**, **Codex**, and **agy** — need to call each other as fallback advisors. While Claude → Codex and agy → Claude/Codex already work, Claude → agy was blocked by the TUI stdout bug.

## License

MIT
