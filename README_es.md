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

> **No oficial** - no está afiliado ni respaldado por Google.

Envoltorio basado en PTY para **agy** (Antigravity CLI / Gemini CLI) que captura respuestas de Gemini desde subprocesos.

## Problema

`agy -p` (modo de impresión) sale con código 0, pero no escribe la respuesta en stdout. El renderizador TUI (`text_drip.go`) escribe en el búfer de la terminal. Issues conocidos:

- [antigravity-cli#76](https://github.com/google-antigravity/antigravity-cli/issues/76)
- [gemini-cli#27466](https://github.com/google-gemini/gemini-cli/issues/27466)
- [antigravity-cli#115](https://github.com/google-antigravity/antigravity-cli/issues/115)

Por eso otros agentes, como Claude Code, Codex o scripts de CI/CD, no pueden leer programáticamente las respuestas de agy.

## Solución

`companion-for-agy` inicia agy dentro de una terminal virtual mediante `node-pty` (ConPTY en Windows, forkpty en macOS/Linux) y extrae la respuesta del flujo de color ANSI. El texto de respuesta de agy usa actualmente `RGB(232,234,237)`, por lo que el envoltorio rastrea el estado de color ANSI y recopila solo el texto con ese color.

> **Nota de plataforma:** La extracción ANSI (`RGB(232,234,237)`) y el flag `--model` se verificaron en **Windows** con agy >= 1.1. macOS y Linux deberían funcionar con `node-pty`, pero el color exacto de respuesta aún debe verificarse allí.
>
> - **agy v1.0.x** (Homebrew `antigravity-cli`) no soporta `--model`; usa `--no-model` o `AGY_COMPANION_NO_MODEL=1`.
> - Si la extracción de color devuelve vacío, ejecuta con `--debug` y revisa `agy-debug.log`.

## Instalación

```bash
npm install -g companion-for-agy
```

### Requisitos

- **Node.js >= 18**
- **agy** ([Gemini CLI](https://github.com/google-gemini/gemini-cli)) instalado y autenticado
- **Herramientas C/C++** para compilar `node-pty`:
  - **Windows:** Visual Studio Build Tools + Python 3
  - **macOS:** `xcode-select --install`
  - **Linux:** `sudo apt install build-essential python3` (Debian/Ubuntu)

Si falla la compilación nativa:

```bash
npm rebuild node-pty
```

## Uso

```bash
companion-for-agy [opciones] "prompt"
```

### Modos de permisos

| Flag | Descripción |
|------|-------------|
| `--sandbox` | Modo sandbox (predeterminado), herramientas en contenedor |
| `--skip-permissions` | Todas las herramientas sin confirmación (YOLO) |
| `--no-tools` | Solo chat, sin ejecución de herramientas |
| `--researcher` | Investigación web permitida, comandos shell y cambios de archivos denegados |
| `--read-only` | Lectura de archivos permitida, comandos shell y modificaciones denegados |

### Reglas personalizadas

```bash
--allow "read_file(/ruta)"    # Regla de permiso (repetible)
--deny "command(rm)"          # Regla de denegación (repetible)
```

Los formatos coinciden con el sistema de permisos de agy (`settings.json`).

### Opciones

| Flag | Descripción |
|------|-------------|
| `--model <modelo>` | Modelo Gemini (predeterminado: `gemini-3.5-flash`) |
| `--no-model` | No pasar `--model` a agy; útil para agy v1.0.x |
| `--timeout <ms>` | Tiempo de espera en ms (predeterminado: `120000`) |
| `--json` | Salida como objeto JSON |
| `--debug` | Guardar salida PTY sin procesar en `agy-debug.log` |
| `--lang <código>` | Idioma de la CLI: `en`, `de`, `es`, `zh-Hans`, `ja`, `ru` |
| `--` | Detener el análisis de opciones; usar antes de prompts que comienzan con `-` |

### Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `AGY_COMPANION_AGY_PATH` | Ruta al binario de agy (se autodetecta si no está definida) |
| `AGY_PATH` | Ruta alternativa al binario de agy |
| `AGY_COMPANION_NO_MODEL` | `1`, `true` o `yes` para omitir `--model` |
| `AGY_COMPANION_RESPONSE_RGB` | Sobrescribir color de respuesta como `R,G,B` o `R;G;B` |

### Ejemplos

```bash
companion-for-agy "¿Cuál es la capital de Baviera?"
companion-for-agy --no-tools "Revisar este código: ..."
companion-for-agy --researcher "Última información sobre Node.js 24"
companion-for-agy --read-only --allow "command(git log)" "prompt"
companion-for-agy --json --model gemini-3.5-pro "prompt"
companion-for-agy --no-model "prompt"
companion-for-agy --lang es --help
companion-for-agy --no-tools -- "-prompt con guion"
```

La salida JSON incluye `response`, `model`, `requestedModel` y `permissionMode`.

## Internacionalización

i18n está separada en tres superficies:

1. **Salida CLI de companion-for-agy:** ayuda, errores y estados.
2. **Documentación:** README, guía de contribución, changelog y ejemplos.
3. **Patrones de reconocimiento de la TUI de agy:** regex internas para diálogo de confianza, arranque, inicialización y final de respuesta.

En Windows, `agy --help` permaneció en inglés con `LANG=en_US`, `de_DE`, `ja_JP` y `zh_CN`. La ayuda CLI de agy parece estar solo en inglés por ahora, pero eso no garantiza que todos los diálogos TUI o versiones futuras sigan igual.

Idiomas de usuario: inglés, alemán, español, chino simplificado, japonés y ruso.

Los patrones de reconocimiento no se traducen a ciegas. El inglés es la base; otros idiomas se agregan solo si agy realmente emite esos textos o si upstream los documenta de forma estable.

## Funcionamiento

```text
companion-for-agy (Node.js)
  -> inicia agy en un PTY
  -> detecta estados de confianza, arranque e inicialización
  -> envía el prompt
  -> captura segmentos ANSI con el color de respuesta
  -> escribe el texto de respuesta en stdout
```

## Casos de uso

- Orquestación multiagente: Claude Code, Codex u otros agentes consultan Gemini mediante agy
- Scripts CI/CD que necesitan salida textual de agy
- Automatización local donde la respuesta TUI de agy debe capturarse como stdout

## Licencia

MIT
