# Changelog

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
