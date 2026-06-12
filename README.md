# companion-for-agy

<p align="left">
  <img src="https://raw.githubusercontent.com/dev-bricks/companion-for-agy/master/assets/logo.jpg" alt="companion-for-agy Banner" width="800" />
</p>

[![npm](https://img.shields.io/npm/v/companion-for-agy)](https://www.npmjs.com/package/companion-for-agy)
[![CI](https://github.com/dev-bricks/companion-for-agy/actions/workflows/tests.yml/badge.svg)](https://github.com/dev-bricks/companion-for-agy/actions/workflows/tests.yml)
[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![Deutsch](https://img.shields.io/badge/lang-Deutsch-blue)](README_de.md)
[![Español](https://img.shields.io/badge/lang-Espa%C3%B1ol-blue)](README_es.md)
[![简体中文](https://img.shields.io/badge/lang-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-blue)](README_zh-Hans.md)
[![日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-blue)](README_ja.md)
[![Русский](https://img.shields.io/badge/lang-%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9-blue)](README_ru.md)

> **Unofficial** - not affiliated with or endorsed by Google.

PTY-based wrapper for **agy** (Antigravity CLI / Gemini CLI) that captures Gemini responses from subprocesses.

| Start here | Link |
|---|---|
| Install | `npm install -g companion-for-agy` |
| Run | `companion-for-agy --json --no-tools "prompt"` |
| German docs | [README_de.md](README_de.md) |
| Changelog | [CHANGELOG.md](CHANGELOG.md) |
| npm package | [npmjs.com/package/companion-for-agy](https://www.npmjs.com/package/companion-for-agy) |

## Problem

`agy -p` (print mode) exits with code 0 but writes no response to stdout. Instead, the TUI text-drip renderer (`text_drip.go`) writes to the terminal buffer. Known upstream issues:

- [antigravity-cli#76](https://github.com/google-antigravity/antigravity-cli/issues/76)
- [gemini-cli#27466](https://github.com/google-gemini/gemini-cli/issues/27466)
- [antigravity-cli#115](https://github.com/google-antigravity/antigravity-cli/issues/115)

That means other agents such as Claude Code, Codex, or CI/CD scripts cannot programmatically read agy's responses.

## Solution

`companion-for-agy` starts agy inside a virtual terminal via `node-pty` (ConPTY on Windows, forkpty on macOS/Linux) and extracts the response from the ANSI color stream. agy's response text currently uses `RGB(232,234,237)`, so the wrapper tracks ANSI color state and collects only text in that color.

> **Platform note:** ANSI color extraction (`RGB(232,234,237)`) and the `--model` flag have been verified on **Windows** with agy >= 1.1. macOS and Linux are expected to work through `node-pty`, but the exact response color still needs independent verification there.
>
> - **agy v1.0.x** (Homebrew `antigravity-cli`) does not support `--model`; use `--no-model` or `AGY_COMPANION_NO_MODEL=1`.
> - If color extraction returns an empty result, run with `--debug` and inspect `agy-debug.log`.

## Installation

```bash
npm install -g companion-for-agy
```

### Prerequisites

- **Node.js >= 18**
- **agy** ([Gemini CLI](https://github.com/google-gemini/gemini-cli)) installed and authenticated
- **C/C++ build tools** for native `node-pty` compilation:
  - **Windows:** Visual Studio Build Tools + Python 3
  - **macOS:** `xcode-select --install`
  - **Linux:** `sudo apt install build-essential python3` (Debian/Ubuntu)

If native compilation fails, run:

```bash
npm rebuild node-pty
```

## Usage

```bash
companion-for-agy [options] "prompt"
```

### Permission Modes

| Flag | Description |
|------|-------------|
| `--sandbox` | Sandbox mode (default), tools in container |
| `--skip-permissions` | All tools without confirmation (YOLO) |
| `--no-tools` | Pure chat, no tool execution |
| `--researcher` | Web/search research allowed, shell commands and file changes denied |
| `--read-only` | File reads allowed, shell commands and modifications denied |

### Custom Rules

```bash
--allow "read_file(/path)"    # Allowlist rule (repeatable)
--deny "command(rm)"          # Denylist rule (repeatable)
```

Formats match agy's own permission system (`settings.json`).

### Options

| Flag | Description |
|------|-------------|
| `--model <model>` | Gemini model (default: `gemini-3.5-flash`) |
| `--no-model` | Do not pass `--model` to agy; useful for agy v1.0.x |
| `--timeout <ms>` | Timeout in ms (default: `120000`) |
| `--json` | Output as JSON object |
| `--debug` | Save raw PTY output to `agy-debug.log` |
| `--lang <code>` | CLI output language: `en`, `de`, `es`, `zh-Hans`, `ja`, `ru` |
| `--` | Stop option parsing; use before prompts that start with `-` |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `AGY_COMPANION_AGY_PATH` | Path to agy binary (auto-detected if unset) |
| `AGY_PATH` | Alternative path to agy binary |
| `AGY_COMPANION_NO_MODEL` | Set to `1`, `true`, or `yes` to omit `--model` |
| `AGY_COMPANION_RESPONSE_RGB` | Override response color as `R,G,B` or `R;G;B` |

### Examples

```bash
companion-for-agy "What is the capital of Bavaria?"
companion-for-agy --no-tools "Review this code: ..."
companion-for-agy --researcher "Latest info on Node.js 24"
companion-for-agy --read-only --allow "command(git log)" "prompt"
companion-for-agy --json --model gemini-3.5-pro "prompt"
companion-for-agy --no-model "prompt"
companion-for-agy --lang de --help
companion-for-agy --no-tools -- "-dash-prefixed prompt"
```

JSON output includes `response`, `model`, `requestedModel`, and `permissionMode`. `model` is detected from agy's banner when possible and falls back to `requestedModel`.

## Internationalization Scope

There are three separate i18n surfaces:

1. **companion-for-agy CLI output:** help text, errors, and status lines produced by this wrapper.
2. **Documentation:** README, contributing guide, changelog, and examples.
3. **agy TUI recognition patterns:** internal regexes that detect agy's trust dialog, startup readiness, init completion, and response completion.

Local Windows checks showed that `agy --help` stayed English under `LANG=en_US`, `de_DE`, `ja_JP`, and `zh_CN`. That suggests agy's CLI help is currently English-only, but it does not prove every TUI dialog, future agy release, plugin, or OS-specific flow will stay English.

Planned user-facing languages:

| Code | Language | Scope |
|------|----------|-------|
| `en` | English | Default CLI and canonical docs |
| `de` | German | Translated docs and CLI output |
| `es` | Spanish | Translated docs and CLI output |
| `zh-Hans` | Simplified Chinese | Translated docs and CLI output |
| `ja` | Japanese | Translated docs and CLI output |
| `ru` | Russian | Translated docs and CLI output |

Recognition patterns are not blindly translated. English stays the baseline; non-English patterns are added only when agy actually emits those strings or a stable upstream string is documented.

## How It Works

```text
companion-for-agy (Node.js)
  -> starts agy in a PTY
  -> detects trust/startup/init states
  -> sends the prompt
  -> captures ANSI response-color segments
  -> writes response text to stdout
```

**5-phase state machine:**

1. **Trust:** detect and auto-confirm workspace trust dialog
2. **Startup:** detect main UI readiness (`? for shortcuts`)
3. **Init:** wait for initialization, with timeout fallback
4. **Question:** send prompt and mark response start
5. **Response:** extract response via ANSI color and adaptive idle timers

## Use Cases

- Multi-agent orchestration: Claude Code, Codex, or other agents querying Gemini via agy
- CI/CD scripts that need text output from agy
- Local automation where agy's TUI response must be captured as stdout

## Discovery Context

Search for **`dev-bricks/companion-for-agy`**, **`companion-for-agy stdout capture`**, **`agy Gemini CLI PTY wrapper`**, or **`Antigravity CLI subprocess response capture`** to find this project directly.

This project is not the official Gemini CLI Companion VS Code extension, not a generic AI companion chatbot, and not related to Databricks Agent Bricks. It is a Node.js `node-pty`/ConPTY wrapper for capturing agy or Gemini CLI responses as stdout for automation.

## Background

This tool was built because three CLI agents - Claude Code, Codex, and agy - need to call each other as fallback advisors. Claude to Codex and agy to Claude/Codex already worked; Claude to agy was blocked by the TUI stdout bug.

## License

MIT
