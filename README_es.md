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
> - Para macOS/Linux, ejecuta `companion-for-agy --platform-smoke --json` antes del live smoke. Agrupa `--doctor` y `--pty-smoke` en un único informe pre-live.

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
| `--doctor` | Mostrar preflight de plataforma para agy, node-pty y artefactos helper |
| `--platform-smoke` | Ejecutar `--doctor` y `--pty-smoke` como gate pre-live |
| `--pty-smoke` | Ejecutar smoke truecolor de node-pty sin autenticación |
| `--live-smoke` | Ejecutar un smoke real de agy con marcador; usa `no-tools` por defecto |
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
companion-for-agy --platform-smoke --json
companion-for-agy --lang es --help
companion-for-agy --no-tools -- "-prompt con guion"
```

La salida JSON incluye `response`, `model`, `requestedModel` y `permissionMode`.
Los modos `--doctor`, `--platform-smoke`, `--pty-smoke` y `--live-smoke` emiten informes de plataforma con `status`, `blockers` y `warnings` cuando se usan con `--json`.

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

## Buenas prácticas: dos vías de retorno

companion-for-agy ofrece dos formas de recibir resultados de agy. Elige según lo que necesites:

### Vía 1 — stdout (mensajes cortos, delegación de tareas)

La vía predeterminada: companion-for-agy captura la respuesta de agy desde el PTY y la escribe en su propio stdout. Funciona de forma fiable con **respuestas cortas y texto ASCII**, y es la opción adecuada cuando delegas una tarea con un prompt `-p` breve y solo esperas una respuesta compacta.

```bash
companion-for-agy --no-tools "¿Cuánto es 2 + 2?"
```

**Limitación (observada en Windows):** Cuando la respuesta es larga o contiene caracteres no ASCII (por ejemplo, caracteres CJK como chino, japonés o coreano), la vía de stdout puede corromper la salida, sustituyendo caracteres por el carácter de reemplazo (U+FFFD). Es una propiedad de la capa de extracción PTY/ANSI, no de agy en sí.

### Vía 2 — salida a archivo mediante `--add-dir` (respuestas grandes, no ASCII, CJK)

Deja que agy escriba su resultado directamente en un archivo. agy escribe en disco por sí mismo; los datos nunca pasan por la extracción de color del PTY. Esta vía es fiable para **cualquier contenido**, incluido texto CJK completo.

**Patrón:** escribe un archivo de instrucciones breve, apunta agy hacia él con un prompt `-p` corto y lee el resultado desde el disco.

```bash
# agy escribe el resultado en /my/output/result.json por sí mismo — UTF-8 limpio, incluido CJK
companion-for-agy --skip-permissions --add-dir "/my/output" \
  "Read /my/output/task.txt and follow it exactly."
# luego lee /my/output/result.json (o la ruta que indique la tarea)
```

> **Regla práctica:**
> - **Delegar tareas, pasar prompts cortos** → stdout es suficiente.
> - **Necesitas la respuesta completa de forma fiable** (texto largo, no ASCII, CJK) → usa `--add-dir` y deja que agy escriba el archivo.

**Evidencia:** La entrega de tareas (entrante) es fiable: agy recibe las instrucciones correctamente, incluido contenido CJK. La salida a archivo mediante `--add-dir` también es limpia (probado en Windows con contenido CJK). La vía de retorno por stdout es el eslabón poco fiable para contenido no ASCII o voluminoso.

## Licencia

MIT
