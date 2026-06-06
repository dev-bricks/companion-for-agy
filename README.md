# agy-companion

ConPTY-basierter Wrapper für **agy** (Antigravity CLI / Gemini CLI), der das Erfassen von Gemini-Antworten aus Subprozessen ermöglicht.

## Problem

`agy -p` (Print-Modus) gibt Exit 0 zurück, schreibt aber keinen Output nach stdout — der TUI Text-Drip-Renderer (`text_drip.go`) rendert die Antwort in den Windows-Terminal-Buffer statt nach stdout. Das ist ein [bekannter Bug](https://github.com/google-antigravity/antigravity-cli/issues/76) (antigravity-cli#76, gemini-cli#27466).

Dadurch kann kein anderer Agent (Claude Code, Codex, CI/CD) agys Antworten programmatisch lesen.

## Lösung

`agy-companion` startet agy in einem virtuellen Terminal via [ConPTY](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session) (über `node-pty`) und extrahiert die Antwort aus dem ANSI-Farb-Stream. Agys Response-Text verwendet die Farbe `RGB(232,234,237)` — der Wrapper trackt den ANSI-Farbzustand und sammelt nur Text in dieser Farbe.

## Installation

```bash
npm install
```

### Voraussetzungen

- **Windows 10/11** (ConPTY ist ein Windows-Feature)
- **Node.js >= 18**
- **agy** (Antigravity CLI) installiert und authentifiziert
- **node-pty** (wird via `npm install` heruntergeladen)

## Verwendung

```bash
node src/agy-companion.mjs [optionen] "prompt"
```

### Permission-Modi

| Flag | Beschreibung |
|------|-------------|
| `--sandbox` | Sandbox-Modus (Standard) — Tools in Container |
| `--skip-permissions` | Alle Tools ohne Bestätigung (YOLO) |
| `--no-tools` | Reiner Chat — keine Tool-Ausführung |
| `--researcher` | Web-Recherche erlaubt, keine Dateiänderungen |
| `--read-only` | Nur Lesen erlaubt |

### Custom-Regeln

```bash
--allow "read_file(/pfad)"    # Whitelist-Regel (wiederholbar)
--deny "command(rm)"           # Blacklist-Regel (wiederholbar)
```

Die Formate entsprechen agys eigenem Permission-System (`settings.json`).

### Weitere Optionen

| Flag | Beschreibung |
|------|-------------|
| `--model <model>` | Gemini-Modell (Standard: `gemini-3.5-flash`) |
| `--timeout <ms>` | Timeout in ms (Standard: 120000) |
| `--json` | Ausgabe als JSON-Objekt |
| `--debug` | Roh-PTY-Output in `agy-debug.log` speichern |

### Umgebungsvariablen

| Variable | Beschreibung |
|----------|-------------|
| `AGY_COMPANION_AGY_PATH` | Pfad zu `agy.exe` |
| `AGY_COMPANION_PTY_PATH` | Pfad zum `node-pty` Modul |

### Beispiele

```bash
# Einfache Frage
node src/agy-companion.mjs "Was ist die Hauptstadt von Bayern?"

# Als Advisor (kein Tool-Use)
node src/agy-companion.mjs --no-tools "Reviewe diesen Code: ..."

# Web-Recherche
node src/agy-companion.mjs --researcher "Aktuelle Infos zu Node.js 24"

# Read-Only mit zusätzlicher Git-Erlaubnis
node src/agy-companion.mjs --read-only --allow "command(git log)" "prompt"

# JSON-Output für programmatische Nutzung
node src/agy-companion.mjs --json --model gemini-3.5-pro "prompt"
```

## Wie es funktioniert

```
┌─────────────┐     ConPTY      ┌─────────────┐
│ agy-companion│ ──────────────▸ │     agy     │
│   (Node.js)  │ ◂────────────── │  (Go TUI)   │
│              │  ANSI stream    │             │
│  Color-Based │                 │ text_drip.go│
│  Extraction  │                 │ RGB(232,234,│
│              │                 │     237)    │
└──────┬───────┘                 └─────────────┘
       │
       ▼ stdout
   Antworttext
```

**4-Phasen State-Machine:**

1. **Startup** — agy-Logo und Modell-Info erkennen
2. **Init** — GEMINI.md-Initialisierung abwarten (Pattern-Matching oder 20s Fallback)
3. **Question** — Prompt senden, Response-Marker setzen
4. **Response** — Antwort via ANSI-Color-Extraktion lesen, adaptiver Idle-Timer

## Hintergrund

Dieses Tool entstand, weil die drei CLI-Agenten **Claude Code**, **Codex** und **agy** sich gegenseitig als Fallback-Advisor aufrufen können sollen. Während Claude → Codex und agy → Claude/Codex bereits funktionieren, war Claude → agy durch den TUI-Bug blockiert.

Verwandte Issues:
- [antigravity-cli#76](https://github.com/google-antigravity/antigravity-cli/issues/76) — `agy --print` drops stdout
- [gemini-cli#27466](https://github.com/google-gemini/gemini-cli/issues/27466) — Windows-spezifisch
- [antigravity-cli#115](https://github.com/google-antigravity/antigravity-cli/issues/115) — Can't Capture CLI Output

---

# agy-companion (English)

ConPTY-based wrapper for **agy** (Antigravity CLI / Gemini CLI) that captures Gemini responses from subprocesses.

## Problem

`agy -p` (print mode) returns exit 0 but writes no output to stdout — the TUI text-drip renderer writes to the Windows terminal buffer instead. This is a [known bug](https://github.com/google-antigravity/antigravity-cli/issues/76).

## Solution

`agy-companion` spawns agy inside a virtual terminal via ConPTY (`node-pty`) and extracts the response from the ANSI color stream. agy's response text uses `RGB(232,234,237)` — the wrapper tracks ANSI color state and collects only text in that color.

## Quick Start

```bash
npm install
node src/agy-companion.mjs "Your prompt here"
```

See the German section above for full documentation of all flags and options.

## License

MIT
