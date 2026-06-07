# companion-for-agy

<p align="left">
  <img src="https://raw.githubusercontent.com/dev-bricks/companion-for-agy/master/assets/logo.jpg" alt="companion-for-agy Banner" width="800" />
</p>

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)

> **Inoffiziell** — nicht verbunden mit oder empfohlen von Google.

PTY-basierter Wrapper für **agy** (Antigravity CLI / Gemini CLI), der Gemini-Antworten aus Subprozessen erfasst.

## Problem

`agy -p` (Print-Modus) gibt Exit 0 zurück, schreibt aber keinen Output nach stdout — der TUI Text-Drip-Renderer (`text_drip.go`) schreibt in den Terminal-Buffer. Das ist ein bekannter Bug:

- [antigravity-cli#76](https://github.com/google-antigravity/antigravity-cli/issues/76)
- [gemini-cli#27466](https://github.com/google-gemini/gemini-cli/issues/27466)
- [antigravity-cli#115](https://github.com/google-antigravity/antigravity-cli/issues/115)

Kein anderer Agent (Claude Code, Codex, CI/CD) kann dadurch agys Antworten programmatisch lesen.

## Lösung

`companion-for-agy` startet agy in einem virtuellen Terminal via `node-pty` (ConPTY unter Windows, forkpty unter macOS/Linux) und extrahiert die Antwort aus dem ANSI-Farbstream. agys Antworttext nutzt `RGB(232,234,237)` — der Wrapper verfolgt den ANSI-Farbstatus und sammelt nur Text in dieser Farbe.

> **Plattformhinweis:** Die ANSI-Farbextraktion (`RGB(232,234,237)`) wurde unter **Windows** (ConPTY) verifiziert. macOS und Linux sollten über `node-pty` funktionieren, da agy denselben Go-TUI-Renderer verwendet, aber die exakten RGB-Werte wurden auf diesen Plattformen noch nicht unabhängig bestätigt. Falls die Farbextraktion leere Ergebnisse liefert, `--debug` verwenden und `agy-debug.log` auf die tatsächlichen Farbcodes prüfen.

## Installation

```bash
npm install -g companion-for-agy
```

### Voraussetzungen

- **Node.js >= 18**
- **agy** ([Gemini CLI](https://github.com/google-gemini/gemini-cli)) installiert und authentifiziert
- **C/C++ Build-Tools** für `node-pty` Native-Kompilierung:
  - **Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) + Python 3
  - **macOS:** `xcode-select --install`
  - **Linux:** `sudo apt install build-essential python3` (Debian/Ubuntu)

## Verwendung

```bash
companion-for-agy [optionen] "prompt"
```

### Berechtigungsmodi

| Flag | Beschreibung |
|------|-------------|
| `--sandbox` | Sandbox-Modus (Standard) — Tools im Container |
| `--skip-permissions` | Alle Tools ohne Bestätigung (YOLO) |
| `--no-tools` | Reiner Chat — keine Tool-Ausführung |
| `--researcher` | Web-Suche erlaubt, keine Dateiänderungen |
| `--read-only` | Nur Lesen, keine Änderungen |

### Eigene Regeln

```bash
--allow "read_file(/pfad)"    # Erlaubnisregel (wiederholbar)
--deny "command(rm)"           # Verbots-Regel (wiederholbar)
```

### Optionen

| Flag | Beschreibung |
|------|-------------|
| `--model <modell>` | Gemini-Modell (Standard: `gemini-3.5-flash`) |
| `--timeout <ms>` | Timeout in ms (Standard: 120000) |
| `--json` | Ausgabe als JSON-Objekt |
| `--debug` | Rohen PTY-Output in `agy-debug.log` speichern |

### Beispiele

```bash
# Einfache Frage
companion-for-agy "Was ist die Hauptstadt von Bayern?"

# Als Berater (keine Tool-Nutzung)
companion-for-agy --no-tools "Überprüfe diesen Code: ..."

# Web-Recherche
companion-for-agy --researcher "Neueste Infos zu Node.js 24"

# JSON-Output für programmatische Nutzung
companion-for-agy --json --model gemini-3.5-pro "prompt"
```

> **JSON-Felder:** `model` meldet das tatsächliche Modell aus agys Banner (z.B. `"Gemini 3.5 Flash (Medium)"`). `requestedModel` ist was via `--model` übergeben wurde.

## Funktionsweise

```
┌────────────────────┐       PTY       ┌─────────────┐
│ companion-for-agy  │ ─────────────▸  │     agy     │
│     (Node.js)      │ ◂────────────── │  (Go TUI)   │
│                    │  ANSI-Stream    │             │
│  Farbbasierte      │                 │ text_drip.go│
│  Extraktion        │                 │ RGB(232,234,│
│                    │                 │     237)    │
└────────┬───────────┘                 └─────────────┘
         │
         ▼ stdout
     Antworttext
```

**5-Phasen State Machine:**

1. **Trust** — Workspace-Trust-Dialog erkennen und automatisch bestätigen
2. **Startup** — Haupt-UI-Bereitschaft erkennen (`? for shortcuts`)
3. **Init** — GEMINI.md-Initialisierung abwarten (Pattern-Matching oder 20s Fallback)
4. **Question** — Prompt senden, Response-Marker setzen
5. **Response** — Antwort via ANSI-Farbextraktion lesen, adaptiver Idle-Timer

## Anwendungsfälle

- **Multi-Agent-Orchestrierung:** Claude Code, Codex oder andere Agenten fragen Gemini via agy
- **CI/CD-Pipelines:** Automatisierte Gemini-Abfragen in Build-Scripts
- **Scripting:** Jedes Szenario wo agys Antwort als Text benötigt wird

## Lizenz

MIT
