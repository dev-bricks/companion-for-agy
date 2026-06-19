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

> **Inoffiziell** - nicht mit Google verbunden und nicht von Google unterstützt.

PTY-basierter Wrapper für **agy** (Antigravity CLI / Gemini CLI), der Gemini-Antworten aus Subprozessen erfasst.

| Einstieg | Link |
|---|---|
| Installation | `npm install -g companion-for-agy` |
| Ausführen | `companion-for-agy --json --no-tools "Prompt"` |
| Englische Doku | [README.md](README.md) |
| Changelog | [CHANGELOG.md](CHANGELOG.md) |
| npm-Paket | [npmjs.com/package/companion-for-agy](https://www.npmjs.com/package/companion-for-agy) |

## Problem

`agy -p` (Print-Modus) beendet sich mit Exit-Code 0, schreibt aber keine Antwort nach stdout. Stattdessen schreibt der TUI-Renderer (`text_drip.go`) in den Terminal-Puffer. Bekannte Upstream-Issues:

- [antigravity-cli#76](https://github.com/google-antigravity/antigravity-cli/issues/76)
- [gemini-cli#27466](https://github.com/google-gemini/gemini-cli/issues/27466)
- [antigravity-cli#115](https://github.com/google-antigravity/antigravity-cli/issues/115)

Dadurch können andere Agenten wie Claude Code, Codex oder CI/CD-Skripte agys Antworten nicht programmatisch lesen.

## Lösung

`companion-for-agy` startet agy in einem virtuellen Terminal via `node-pty` (ConPTY unter Windows, forkpty unter macOS/Linux) und extrahiert die Antwort aus dem ANSI-Farbstream. agys Antworttext nutzt derzeit `RGB(232,234,237)`, daher verfolgt der Wrapper den ANSI-Farbstatus und sammelt nur Text in dieser Farbe.

> **Plattformhinweis:** ANSI-Farbextraktion (`RGB(232,234,237)`) und das Flag `--model` wurden unter **Windows** mit agy >= 1.1 verifiziert. macOS und Linux sollten über `node-pty` funktionieren, aber der exakte Antwortfarbwert muss dort noch unabhängig geprüft werden.
>
> - **agy v1.0.x** (Homebrew `antigravity-cli`) unterstützt `--model` nicht; nutze `--no-model` oder `AGY_COMPANION_NO_MODEL=1`.
> - Falls die Farbextraktion leer bleibt, mit `--debug` starten und `agy-debug.log` prüfen.
> - Vor einem echten macOS-/Linux-Live-Smoke zuerst `companion-for-agy --doctor` und danach `companion-for-agy --pty-smoke` ausführen. `--pty-smoke` prüft den paketierten `node-pty`-Truecolor-Pfad ohne agy-Authentifizierung.

## Installation

```bash
npm install -g companion-for-agy
```

### Voraussetzungen

- **Node.js >= 18**
- **agy** ([Gemini CLI](https://github.com/google-gemini/gemini-cli)) installiert und authentifiziert
- **C/C++ Build-Tools** für die native `node-pty`-Kompilierung:
  - **Windows:** Visual Studio Build Tools + Python 3
  - **macOS:** `xcode-select --install`
  - **Linux:** `sudo apt install build-essential python3` (Debian/Ubuntu)

Falls die native Kompilierung fehlschlägt:

```bash
npm rebuild node-pty
```

## Nutzung

```bash
companion-for-agy [Optionen] "Prompt"
```

### Berechtigungsmodi

| Flag | Beschreibung |
|------|--------------|
| `--sandbox` | Sandbox-Modus (Standard), Tools im Container |
| `--skip-permissions` | Alle Tools ohne Bestätigung (YOLO) |
| `--no-tools` | Reiner Chat, keine Tool-Ausführung |
| `--researcher` | Websuche/Recherche erlaubt, Shell-Befehle und Dateiänderungen verboten |
| `--read-only` | Datei-Lesen erlaubt, Shell-Befehle und Änderungen verboten |

### Eigene Regeln

```bash
--allow "read_file(/pfad)"    # Erlaubnisregel (wiederholbar)
--deny "command(rm)"          # Verbotsregel (wiederholbar)
```

Die Formate entsprechen agys eigenem Berechtigungssystem (`settings.json`).

### Workspace

```bash
--add-dir "/pfad/zum/verzeichnis"   # Verzeichnis zum agy-Workspace hinzufügen (wiederholbar)
```

agy schreibt Dateien nur in seinen eigenen Workspace. Ohne `--add-dir` werden Schreibversuche außerhalb des temporären Workspaces still ignoriert oder fälschlicherweise als erfolgreich gemeldet, obwohl keine Datei entstanden ist.

Mit `--add-dir` wird ein zusätzliches Verzeichnis registriert, sodass agy dort tatsächlich Dateien anlegen oder ändern kann:

```bash
# Datei in /mein/ausgabe schreiben — Workspace-Registrierung und Schreibrecht nötig
companion-for-agy --skip-permissions --add-dir "/mein/ausgabe" \
  "Schreibe hello.txt nach /mein/ausgabe mit Inhalt: Hallo Welt"

# Im Sandbox-Modus: Schreibrecht explizit vergeben
companion-for-agy --allow "write_file(/mein/ausgabe/*)" --add-dir "/mein/ausgabe" \
  "Schreibe hello.txt nach /mein/ausgabe"
```

> **Hinweis:** `--skip-permissions` (YOLO-Modus) steuert die **Tool-Freigabe**; `--add-dir` steuert den **Workspace-Geltungsbereich**. Beide sind nötig, wenn in ein Verzeichnis außerhalb des Standard-Temp-Workspaces geschrieben werden soll.

### Optionen

| Flag | Beschreibung |
|------|--------------|
| `--add-dir <Verz.>` | Verzeichnis zum agy-Workspace hinzufügen (wiederholbar); erforderlich damit agy Dateien außerhalb des Temp-Verzeichnisses schreiben kann |
| `--model <Modell>` | Gemini-Modell (Standard: `gemini-3.5-flash`) |
| `--no-model` | `--model` nicht an agy übergeben; nützlich für agy v1.0.x |
| `--timeout <ms>` | Timeout in ms (Standard: `120000`) |
| `--json` | Ausgabe als JSON-Objekt |
| `--debug` | Raw-PTY-Ausgabe in `agy-debug.log` speichern |
| `--doctor` | Plattform-Preflight für agy, node-pty und Helper-Artefakte ausgeben |
| `--pty-smoke` | Auth-freien node-pty-Truecolor-Smoke für Plattformvalidierung ausführen |
| `--lang <Code>` | CLI-Sprache: `en`, `de`, `es`, `zh-Hans`, `ja`, `ru` |
| `--` | Optionsauswertung stoppen; vor Prompts nutzen, die mit `-` beginnen |

### Umgebungsvariablen

| Variable | Beschreibung |
|----------|--------------|
| `AGY_COMPANION_AGY_PATH` | Pfad zur agy-Binärdatei (automatische Erkennung, wenn nicht gesetzt) |
| `AGY_PATH` | Alternativer Pfad zur agy-Binärdatei |
| `AGY_COMPANION_NO_MODEL` | Auf `1`, `true` oder `yes` setzen, um `--model` wegzulassen |
| `AGY_COMPANION_RESPONSE_RGB` | Antwortfarbe als `R,G,B` oder `R;G;B` überschreiben |

### Beispiele

```bash
companion-for-agy "Was ist die Hauptstadt von Bayern?"
companion-for-agy --no-tools "Code-Review: ..."
companion-for-agy --researcher "Aktuelle Infos zu Node.js 24"
companion-for-agy --read-only --allow "command(git log)" "Prompt"
companion-for-agy --json --model gemini-3.5-pro "Prompt"
companion-for-agy --no-model "Prompt"
companion-for-agy --skip-permissions --add-dir "/mein/ausgabe" "Schreibe hello.txt nach /mein/ausgabe"
companion-for-agy --doctor --json
companion-for-agy --pty-smoke --json
companion-for-agy --lang de --help
companion-for-agy --no-tools -- "-prompt mit Bindestrich"
```

JSON-Ausgabe enthält `response`, `model`, `requestedModel` und `permissionMode`. `model` wird nach Möglichkeit aus agys Banner erkannt und fällt sonst auf `requestedModel` zurück.

Für `--doctor --json` enthält die Ausgabe stattdessen einen Preflight-Bericht mit `status`, `blockers`, `warnings`, agy-Versionserkennung, `node-pty`-Ladedetails und Helper-/Binary-Pfaden. Für `--pty-smoke --json` enthält sie einen PTY-Smoke-Bericht mit verwendetem Kommando, erwarteter/extrahierter Truecolor-Antwort, Rohbytezahl sowie Blockern/Warnungen.

## Internationalisierung

i18n betrifft drei getrennte Ebenen:

1. **CLI-Ausgaben von companion-for-agy:** Hilfetext, Fehler und Statuszeilen dieses Wrappers.
2. **Dokumentation:** README, Beitragsrichtlinie, Changelog und Beispiele.
3. **agy-TUI-Erkennungsmuster:** interne Regexe für Trust-Dialog, Startbereitschaft, Init-Abschluss und Antwortabschluss.

Lokale Windows-Checks zeigten: `agy --help` blieb bei `LANG=en_US`, `de_DE`, `ja_JP` und `zh_CN` englisch. Das spricht dafür, dass agys CLI-Hilfe derzeit englisch ist. Es beweist aber nicht, dass alle TUI-Dialoge, künftige agy-Versionen, Plugins oder OS-spezifischen Flows dauerhaft englisch bleiben.

Geplante und dokumentierte Nutzer-Sprachen:

| Code | Sprache | Umfang |
|------|---------|--------|
| `en` | Englisch | Standard-CLI und kanonische Doku |
| `de` | Deutsch | Übersetzte Doku und CLI-Ausgabe |
| `es` | Spanisch | Übersetzte Doku und CLI-Ausgabe |
| `zh-Hans` | Vereinfachtes Chinesisch | Übersetzte Doku und CLI-Ausgabe |
| `ja` | Japanisch | Übersetzte Doku und CLI-Ausgabe |
| `ru` | Russisch | Übersetzte Doku und CLI-Ausgabe |

Erkennungsmuster werden nicht blind übersetzt. Englisch bleibt Basis; nicht-englische Patterns werden nur ergänzt, wenn agy diese Strings tatsächlich ausgibt oder Upstream sie stabil dokumentiert.

## Funktionsweise

```text
companion-for-agy (Node.js)
  -> startet agy in einem PTY
  -> erkennt Trust-, Startup- und Init-Status
  -> sendet den Prompt
  -> erfasst ANSI-Segmente in der Antwortfarbe
  -> schreibt den Antworttext nach stdout
```

**5-Phasen-State-Machine:**

1. **Trust:** Workspace-Trust-Dialog erkennen und automatisch bestätigen
2. **Startup:** UI-Bereitschaft erkennen (`? for shortcuts`)
3. **Init:** Initialisierung abwarten, mit Timeout-Fallback
4. **Question:** Prompt senden und Antwortstart markieren
5. **Response:** Antwort über ANSI-Farbe und adaptive Idle-Timer extrahieren

## Use Cases

- Multi-Agent-Orchestrierung: Claude Code, Codex oder andere Agenten fragen Gemini via agy
- CI/CD-Skripte, die Textausgabe von agy benötigen
- Lokale Automatisierung, bei der agys TUI-Antwort als stdout gebraucht wird

## Best Practices: Zwei Rückgabewege

companion-for-agy bietet zwei Wege, um Ergebnisse von agy zurückzubekommen. Die Wahl hängt vom Anwendungsfall ab:

### Weg 1 — stdout (kurze Nachrichten, Aufgabenübergabe)

Der Standardweg: companion-for-agy erfasst agys Antwort aus dem PTY und schreibt sie auf seinen eigenen stdout. Das funktioniert zuverlässig für **kurze Antworten und ASCII-Text** und ist die richtige Wahl, wenn eine kompakte Antwort auf einen kurzen `-p`-Prompt erwartet wird.

```bash
companion-for-agy --no-tools "Was ist 2 + 2?"
```

**Einschränkung (beobachtet unter Windows):** Bei langen Antworten oder nicht-ASCII-Inhalten (z. B. CJK-Zeichen wie Chinesisch, Japanisch, Koreanisch) kann der stdout-Rückgabeweg die Ausgabe verstümmeln — Zeichen werden durch Ersatzzeichen (U+FFFD) ersetzt (z. B. `从​方阵…` wird zu `从​​阵…`). Diese Einschränkung liegt in der PTY/ANSI-Extraktionsschicht, nicht in agy selbst.

### Weg 2 — Dateiausgabe via `--add-dir` (umfangreiche Antworten, Nicht-ASCII, CJK)

agy schreibt das Ergebnis direkt als Datei. Die Daten laufen dann nicht durch die PTY-Farbextraktion. Dieser Weg ist für **beliebige Inhalte** zuverlässig, einschließlich vollständiger CJK-Texte.

**Muster:** Eine kurze Instruktionsdatei ablegen, agy per kurzem `-p`-Prompt darauf verweisen lassen und das Ergebnis von der Festplatte lesen.

```bash
# agy schreibt das Ergebnis selbst nach /mein/ausgabe/result.json — sauberes UTF-8, inkl. CJK
companion-for-agy --skip-permissions --add-dir "/mein/ausgabe" \
  "Lese /mein/ausgabe/aufgabe.txt und führe sie genau aus."
# Danach /mein/ausgabe/result.json lesen (oder den in der Aufgabe genannten Pfad)
```

> **Faustregel:**
> - **Aufgaben delegieren, kurze Prompts übergeben** → stdout ist ausreichend.
> - **Vollständige Antwort zuverlässig benötigen** (langer Text, Nicht-ASCII, CJK) → `--add-dir` nutzen und agy die Datei selbst schreiben lassen.

**Befund:** Die Aufgabenübermittlung an agy (Inbound) ist zuverlässig — agy empfängt Instruktionen korrekt, auch mit CJK-Inhalten. Die Dateiausgabe via `--add-dir` ist ebenfalls sauber (getestet unter Windows mit CJK-Inhalten). Der stdout-Rückgabeweg ist das unzuverlässige Glied bei Nicht-ASCII- und umfangreichen Inhalten.

## Auffindbarkeit

Suche nach **`dev-bricks/companion-for-agy`**, **`companion-for-agy stdout capture`**, **`agy Gemini CLI PTY wrapper`** oder **`Antigravity CLI subprocess response capture`**, um dieses Projekt direkt zu finden.

Dieses Projekt ist nicht die offizielle Gemini CLI Companion VS-Code-Erweiterung, kein generischer AI-Companion-Chatbot und nicht mit Databricks Agent Bricks verwandt. Es ist ein Node.js-Wrapper auf Basis von `node-pty`/ConPTY, der Antworten von agy beziehungsweise Gemini CLI als stdout für Automatisierung erfasst.

## Hintergrund

Dieses Tool entstand, weil drei CLI-Agenten - Claude Code, Codex und agy - sich gegenseitig als Fallback-Berater aufrufen sollen. Claude zu Codex und agy zu Claude/Codex funktionierten bereits; Claude zu agy war durch den TUI-stdout-Bug blockiert.

## Lizenz

MIT
