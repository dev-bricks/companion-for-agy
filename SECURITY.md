# Sicherheitsrichtlinie / Security Policy

## Deutsch

### Sicherheitslücken melden

Wenn Sie eine Sicherheitslücke finden, melden Sie diese bitte verantwortungsvoll:

1. **Kein öffentliches Issue eröffnen**
2. **GitHub Private Vulnerability Reporting verwenden**
3. Beschreibung, Reproduktionsschritte und potenzielle Auswirkungen angeben

### So melden Sie ein Problem

1. Öffnen Sie im Repository: `Security` → `Advisories` → `New`
2. Tragen Sie Titel, Beschreibung, Schweregrad und betroffene Versionen ein
3. Reichen Sie die Meldung privat ein

Falls Private Vulnerability Reporting im Repository noch nicht aktiviert ist,
kontaktieren Sie die Maintainer direkt über GitHub und veröffentlichen Sie
keine Details in einem öffentlichen Issue.

### Geltungsbereich

- PTY-Prozesse (node-pty spawnt agy als Kindprozess)
- Temporärer Workspace (Permission-Konfiguration in `os.tmpdir()`)
- Pfad-Resolution (agy-Binary-Erkennung via PATH, Umgebungsvariablen)
- Prompt-Injection über PTY-Eingabe (sanitizeForPty filtert Steuerzeichen)

### Reaktionszeit

Bei kleineren Einzelprojekten können Reaktionszeiten variieren. Kritische
Probleme werden priorisiert. Bitte geben Sie ausreichend Zeit, bevor Sie
Details öffentlich machen.

---

## English

### Reporting a Vulnerability

If you find a security vulnerability, please report it responsibly:

1. **Do not open a public issue**
2. **Use GitHub Private Vulnerability Reporting**
3. Include a description, reproduction steps, and potential impact

### How to Report

1. Open: `Security` → `Advisories` → `New`
2. Fill in the title, description, severity, and affected versions
3. Submit the report privately

If private vulnerability reporting is not enabled yet, contact the maintainers
through GitHub and do not publish details in a public issue.

### Scope

- PTY processes (node-pty spawns agy as a child process)
- Temporary workspace (permission configuration in `os.tmpdir()`)
- Path resolution (agy binary detection via PATH, environment variables)
- Prompt injection via PTY input (sanitizeForPty filters control characters)

### Response Time

For smaller solo projects, response times may vary. Critical issues will be
prioritized. Please allow reasonable time before public disclosure.
