# Änderungsprotokoll

## [Unveröffentlicht]

### Dokumentation
- Abschnitt **Best Practices: Zwei Rückgabewege** in README.md, README_de.md und llms.txt ergänzt. Dokumentiert, dass der stdout-Rückgabeweg bei Nicht-ASCII- und CJK-Inhalten verstümmelte Ausgaben erzeugen kann (beobachtet unter Windows) und empfiehlt das Dateiausgabe-Muster via `--add-dir` für umfangreiche oder Nicht-ASCII-Antworten. Aufgabenübermittlung (Inbound) und Dateiausgabe via `--add-dir` sind zuverlässig (getestet unter Windows, inkl. CJK); der stdout-Rückgabeweg ist das unzuverlässige Glied. Übersetzungen der übrigen Sprachen (es, ja, ru, zh-Hans) sind als TODO erfasst.

## [1.4.0] - 2026-06-14

### Hinzugefügt
- **`--add-dir <Verz.>` Workspace-Passthrough** (wiederholbar). agy schreibt Dateien nur in seinen eigenen Workspace; ohne dieses Flag werden Schreibversuche außerhalb des temporären Verzeichnisses still ignoriert oder fälschlicherweise als erfolgreich gemeldet. `--add-dir` registriert zusätzliche Verzeichnisse über agys `--add-dir`-Flag, sodass Schreibvorgänge dort tatsächlich ankommen. Zusammen mit `--skip-permissions` für vollen Schreibzugriff verwenden, oder mit einer passenden `--allow "write_file(...)"`-Regel im Sandbox-Modus.

## [1.3.3] - 2026-06-08

### Behoben
- **Sidebar-Workspace-Leck:** Bei der Ausführung in temporären Arbeitsbereichen (z. B. `agy-companion-<PID>`) registriert die Antigravity IDE diese automatisch als Projekte unter `.gemini/config/projects/<uuid>.json`. Diese blieben dauerhaft bestehen und müllten die Seitenleiste zu. Es wurde eine Bereinigungslogik in `cleanupTemp()` hinzugefügt, um die entsprechende Projekt-JSON beim Beenden zu löschen.

## [1.3.1] - 2026-06-07

### Behoben (Bugsweep)
- **detectResponseComplete:** Ein alleinstehender `>` mitten in der Antwort (z. B. Markdown-Blockquotes, agy-Statuszeilen) löst kein vorzeitiges Response-Complete mehr aus; der neue `foundPromptCandidate`-Ansatz scannt den vollständigen Puffer und setzt sich bei echtem Inhalt nach einem Kandidaten zurück (`ed1436d`).
- **getMessage:** Platzhalterwerte mit `$&`, `$'`, `` $` `` oder `$n` wurden durch JavaScripts Sondermuster-Expansion in `String.prototype.replace` beschädigt; der Ersatz verwendet nun die Funktionsform `() => String(val)`, um jede Substitution zu verhindern (`5470404`).

## [1.3.0] - 2026-06-07

### Hinzugefügt
- CLI-Lokalisierung über `--lang <Code>` und automatische Locale-Erkennung.
- Unterstützte CLI- und Dokumentationssprachen: Englisch, Deutsch, Spanisch, vereinfachtes Chinesisch, Japanisch und Russisch.
- Neues Lokalisierungsmodul `src/locales.mjs`.
- Übersetzte README-Dateien: `README_de.md`, `README_es.md`, `README_zh-Hans.md`, `README_ja.md`, `README_ru.md`.
- Deutsches Änderungsprotokoll: `CHANGELOG_de.md`.
- CLI-Regressionstests für lokalisierte Hilfe und lokalisierte Parsing-Fehler.

### Geändert
- Benutzerseitige CLI-Texte werden nun aus Locale-Maps gelesen und nicht mehr direkt in `src/agy-companion.mjs` hartcodiert.
- `package.json` liefert alle lokalisierten Dokumentationsdateien im npm-Paket aus.
- Die Dokumentation trennt nun CLI-Lokalisierung, Dokumentationsübersetzung und agy-TUI-Erkennungsmuster.

### Behoben
- Leere oder nicht extrahierbare Antworten führen nun zu einem Exit-Code ungleich Null, statt auf Startup-Banner-Text zurückzufallen oder Erfolg zu melden.
- Das Beenden erzwingt keinen PTY-Kill mehr, wenn `Ctrl+C` bereits zu einem sauberen Exit geführt hat. Das verhindert späte `node-pty`-Bereinigungs-Stacktraces bei erfolgreichen Läufen.
- Die Berechtigungs-Voreinstellungen `researcher` und `read-only` verbieten nun `command(*)`, um befehlsbasierte Schreibvorgänge zu verhindern.
- Unbekannte CLI-Optionen schlagen nun sofort fehl; `--` kann vor Prompts genutzt werden, die mit einem Bindestrich beginnen.
- Die Antwortfarbe kann über `AGY_COMPANION_RESPONSE_RGB` überschrieben werden.
- Deutsche Trust-/Startup-Muster, Signal-Bereinigung, Bereinigung von totem Code und Ein-Zeichen-Prompt/Antwort-Fälle sind durch Tests abgedeckt.
- agy v1.0.x kann genutzt werden, indem das Modell-Flag via `--no-model` oder `AGY_COMPANION_NO_MODEL` weggelassen wird.

## [1.2.0] - 2026-06-07

### Behoben (Bug-Sweep)
- **Sicherheit:** Ein veralteter temporärer Arbeitsbereich eines abgestürzten Laufs mit derselben PID konnte Berechtigungen an einen neuen Lauf übertragen; er wird nun beim Start bereinigt (`e8c5230`).
- Speicherleck des temporären Verzeichnisses im Sandbox- und Skip-Permissions-Modus, wenn keine benutzerdefinierten Regeln gesetzt sind (`d406299`).
- Race Condition bei der temporären Bereinigung unter Windows: Post-Kill-Verzögerung plus `rmSync`-Wiederholungen für CWD-Locks (`41412d6`).
- ConPTY-Textextraktion: veraltete Cursorposition, falsche Erkennung von fettem SGR und zu enger Entduplizierungsbereich (`c2194bb`).
- False Positives in `isNoiseLine` für Blockzitate (`>`) und Zeilen mit dem Wort "tokens" (`f6a8e7b`).

## [1.2.0-alpha.2] - 2026-06-07

### Geändert
- ASCII-Banner in den README-Dateien linksbündig ausgerichtet.
- Bildquelle auf rohe GitHub-URLs umgestellt, damit das Logo auf npmjs.com korrekt gerendert wird.

### Behoben
- Zusätzliches CLI-Tipp-Rauschen (Zeilen mit `└`) und "Verifying..."-Zeilen im Ausgabe-Parser behandelt.

## [1.2.0-alpha.1] - 2026-06-07

### Geändert
- Paket in `companion-for-agy` umbenannt, um über das "for"-Muster rechtliche und markenbezogene Distanz zu schaffen.
- Hinweis "Inoffiziell" in README und Paketbeschreibung ergänzt.

### Behoben
- Kurze Antworten (2 Zeichen oder weniger, z.B. "4", "42", "ja") wurden fälschlich als Rauschen gefiltert.
- Prompt-Echo-Bug im Modus `--no-tools`: Das Berechtigungspräfix wurde als Antwort zurückgegeben statt der eigentlichen Antwort.
- ConPTY-Leerzeichenverlust beim Prompt-Echo: Whitespace-normalisierter Abgleich verarbeitet nun "Donotuse" gegenüber "Do not use".

### Hinzugefügt
- `stripPromptEcho()` für whitespace-tolerante Entfernung des Prompt-Echos.
- `extractResponse()` akzeptiert den vierten Parameter `effectiveFilter` für vollständiges Prompt-Echo-Stripping.
- 5-Phasen-State-Machine mit automatischer Bestätigung des Trust-Dialogs.
- Banner-Modellerkennung: JSON meldet das tatsächlich erkannte Modell aus agys Banner.
- 26 neue Tests (insgesamt 107): Extraktion kurzer Antworten, Prompt-Echo-Regression und Unit-Tests für `stripPromptEcho`.
- CLI-Alias `companion-for-agy` neben `agy-companion` für Abwärtskompatibilität.

## [1.1.0] - 2026-06-06

### Geändert
- Plattformübergreifende Unterstützung: Windows, macOS, Linux (`node-pty` verarbeitet plattformspezifische PTYs).
- Automatische Erkennung der agy-Binärdatei über PATH, übliche Installationsorte und Umgebungsvariablen.
- `node-pty` wird als normale npm-Abhängigkeit geladen, ohne hartcodierten Pfad zu gemini-cli-Interna.
- Debug-Log schreibt nach `./agy-debug.log` statt nach `~/.claude/scripts/`.
- CLI-Nachrichten und Nutzungstexte auf Englisch für ein internationales Publikum.
- Englische `INIT_DONE_PATTERNS` neben deutschen Patterns ergänzt.
- Einschränkung `"os": ["win32"]` aus `package.json` entfernt.

### Hinzugefügt
- Exportierte Funktion `findAgyPath()` für programmatische agy-Erkennung.
- Testsuite: 81 Tests (Unit, Fixture, Smoke) via `node:test`.
- Skripte `npm run deploy` und `npm run sync` für lokale Kopieverwaltung.
- Umfassende README mit Installation, Fehlerbehebung und Nutzung.

## [1.0.0] - 2026-06-06

### Hinzugefügt
- ConPTY-basierter Wrapper für agy (Antigravity CLI).
- ANSI-farbbasierte Antwortextraktion (`RGB(232,234,237)`).
- Zeilenbasierter Noise-Filter-Fallback.
- 4-Phasen-State-Machine (Startup, Init, Frage, Antwort).
- Adaptives Timing: 10s während Generierung, 2.5s nach Abschluss.
- Berechtigungssystem mit 5 Modi: sandbox, skip-permissions, no-tools, researcher, read-only.
- Benutzerdefinierte Allow-/Deny-Regeln, kompatibel mit agys `settings.json`-Format.
- JSON-Ausgabemodus (`--json`).
- Konfigurierbare Pfade über Umgebungsvariablen.
- Prompt-Sanitisierung gegen PTY-Injection.
- Graceful Shutdown.
- Debug-Modus mit PTY-Output-Log.
