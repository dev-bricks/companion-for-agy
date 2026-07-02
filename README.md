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

> **Platform note:** ANSI color extraction (`RGB(232,234,237)`) and the `--model` flag have been verified on **Windows** with agy >= 1.1. On **Linux**, the repository now also has a real `node-pty`/`forkpty` smoke (`npm run test:linux-pty`) that checks `spawn-helper`, the native `pty.node`, and truecolor extraction through `/bin/sh`; the remaining open Linux step is a live agy session. macOS still needs the first independent live verification.
>
> - **agy v1.0.x** (Homebrew `antigravity-cli`) does not support `--model`; use `--no-model` or `AGY_COMPANION_NO_MODEL=1`.
> - If color extraction returns an empty result, run with `--debug` and inspect `agy-debug.log`.
> - Run `companion-for-agy --doctor` before the first macOS/Linux smoke to verify agy path, `node-pty`, native binary, and POSIX `spawn-helper` readiness.
> - Run `companion-for-agy --pty-smoke` before the first live agy test. It verifies the packaged `node-pty` truecolor path without requiring agy authentication.
> - Run `companion-for-agy --platform-smoke --json` to bundle `--doctor` and `--pty-smoke` into one pre-live platform gate for macOS/Linux handoff logs.
> - Run `companion-for-agy --live-smoke --no-model --debug --json` for the first authenticated macOS/Linux live smoke. It asks agy for the marker `AGY_LIVE_SMOKE_OK`, verifies the captured response exactly, and writes raw ANSI evidence to `agy-debug.log`.
> - On Linux, run `npm run test:linux-pty` before the first live agy test. It verifies the PTY pipeline without requiring agy authentication.

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

### Workspace

```bash
--add-dir "/path/to/dir"      # Add a directory to agy's workspace (repeatable)
```

agy only writes files inside its own workspace directory. Without `--add-dir`, any file-write attempt outside the temp workspace is silently ignored or reported as a success even though no file was created.

Use `--add-dir` to register additional directories so agy can actually create or modify files there:

```bash
# Write a file into /my/output — requires both workspace registration and write permission
companion-for-agy --skip-permissions --add-dir "/my/output" \
  "Write hello.txt to /my/output with content: Hello World"

# With sandbox mode: grant write permission explicitly
companion-for-agy --allow "write_file(/my/output/*)" --add-dir "/my/output" \
  "Write hello.txt to /my/output"
```

> **Note:** `--skip-permissions` (YOLO mode) controls **tool authorization**; `--add-dir` controls **workspace scope**. Both are needed when writing to a directory outside the default temp workspace.

### Options

| Flag | Description |
|------|-------------|
| `--add-dir <dir>` | Add a directory to agy's workspace (repeatable); required for agy to write files outside its temp dir |
| `--model <model>` | Gemini model (default: `gemini-3.5-flash`) |
| `--no-model` | Do not pass `--model` to agy; useful for agy v1.0.x |
| `--timeout <ms>` | Timeout in ms (default: `120000`) |
| `--json` | Output as JSON object |
| `--report-file <path>` | Write diagnostic report JSON to a file for `--doctor`, `--platform-smoke`, `--pty-smoke` and `--live-smoke` |
| `--debug` | Save raw PTY output to `agy-debug.log` |
| `--doctor` | Print a platform preflight for agy, node-pty and helper artifacts |
| `--platform-smoke` | Run `--doctor` and `--pty-smoke` as one pre-live platform gate |
| `--pty-smoke` | Run an auth-free node-pty truecolor smoke for platform validation |
| `--live-smoke` | Run a real agy marker smoke; defaults to `no-tools` unless another permission mode is selected |
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
companion-for-agy --skip-permissions --add-dir "/my/output" "Write hello.txt to /my/output"
companion-for-agy --doctor
companion-for-agy --doctor --json
companion-for-agy --platform-smoke --report-file reports/platform-smoke.json
companion-for-agy --platform-smoke --json
companion-for-agy --pty-smoke --json
companion-for-agy --live-smoke --no-model --debug --json
companion-for-agy --lang de --help
companion-for-agy --no-tools -- "-dash-prefixed prompt"
```

JSON output includes `response`, `model`, `requestedModel`, and `permissionMode`. `model` is detected from agy's banner when possible and falls back to `requestedModel`.

For `--doctor --json`, the output instead contains a preflight report with `status`, `blockers`, `warnings`, agy version detection, `node-pty` load details and helper/binary paths.
For `--platform-smoke --json`, the output contains a bundled pre-live report with nested doctor and PTY-smoke results plus the exact authenticated live-smoke command to run next.
For `--pty-smoke --json`, the output contains a PTY smoke report with the command used, expected/extracted truecolor text, raw byte count, and blockers/warnings. This is the first auth-free check to run on macOS and Linux before a real `agy --debug` live smoke.
For `--live-smoke --no-model --debug --json`, the output contains an authenticated agy live-smoke report with `status`, marker match details, model metadata, permission mode, response RGB and the debug-log path. A marker mismatch exits with code `5`.
Add `--report-file <path>` to any diagnostic mode when the report should be persisted as pretty JSON while stdout keeps its selected text or JSON format.

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

## Best Practices: Two Return Paths

companion-for-agy gives you two ways to get results back from agy. Choose based on what you need:

### Path 1 — stdout (short messages, task delegation)

The default path: companion-for-agy captures agy's response from the PTY and writes it to its own stdout. This works reliably for **short responses and ASCII text**, and is the right choice when you delegate a task with a brief `-p` prompt and only need a compact answer back.

```bash
companion-for-agy --no-tools "What is 2 + 2?"
```

**Limitation (observed on Windows):** When the response is long or contains non-ASCII content (e.g. CJK characters such as Chinese, Japanese, Korean), the stdout relay can garble the output — replacing characters with replacement characters (U+FFFD, e.g. `从​方阵…` becomes `从​​阵…`). This is a property of the PTY/ANSI extraction layer, not of agy itself.

### Path 2 — file output via `--add-dir` (bulky responses, non-ASCII, CJK)

Let agy write its result directly to a file. agy writes to disk itself; the data never passes through the PTY color extraction. This path is reliable for **any content**, including full CJK text.

**Pattern:** write a short instruction file, point agy at it with a brief `-p` prompt, and read the result from disk.

```bash
# agy writes the result to /my/output/result.json itself — clean UTF-8, including CJK
companion-for-agy --skip-permissions --add-dir "/my/output" \
  "Read /my/output/task.txt and follow it exactly."
# then read /my/output/result.json (or whatever the task specifies)
```

> **Rule of thumb:**
> - **Delegate tasks, pass short prompts** → stdout is fine.
> - **Need the full response reliably** (long text, non-ASCII, CJK) → use `--add-dir` and let agy write the file.

**Evidence:** Inbound task delivery is reliable (agy receives instructions correctly, including CJK). File output via `--add-dir` is also clean (tested on Windows with CJK content). The stdout return path is the unreliable leg for non-ASCII/bulky content.

## Discovery Context

Search for **`dev-bricks/companion-for-agy`**, **`companion-for-agy stdout capture`**, **`agy Gemini CLI PTY wrapper`**, or **`Antigravity CLI subprocess response capture`** to find this project directly.

This project is not the official Gemini CLI Companion VS Code extension, not a generic AI companion chatbot, and not related to Databricks Agent Bricks. It is a Node.js `node-pty`/ConPTY wrapper for capturing agy or Gemini CLI responses as stdout for automation.

## Background

This tool was built because three CLI agents - Claude Code, Codex, and agy - need to call each other as fallback advisors. Claude to Codex and agy to Claude/Codex already worked; Claude to agy was blocked by the TUI stdout bug.

## License

MIT
