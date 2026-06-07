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

> **Неофициально** - проект не связан с Google и не одобрен Google.

**companion-for-agy** - PTY-оболочка для **agy** (Antigravity CLI / Gemini CLI), которая захватывает ответы Gemini из подпроцессов.

## Проблема

`agy -p` (режим печати) завершается с кодом 0, но не пишет ответ в stdout. Вместо этого TUI-рендерер (`text_drip.go`) пишет текст в буфер терминала. Известные upstream issues:

- [antigravity-cli#76](https://github.com/google-antigravity/antigravity-cli/issues/76)
- [gemini-cli#27466](https://github.com/google-gemini/gemini-cli/issues/27466)
- [antigravity-cli#115](https://github.com/google-antigravity/antigravity-cli/issues/115)

Поэтому другие агенты, например Claude Code, Codex или CI/CD-скрипты, не могут программно читать ответы agy.

## Решение

`companion-for-agy` запускает agy внутри виртуального терминала через `node-pty` (ConPTY в Windows, forkpty в macOS/Linux) и извлекает ответ из ANSI-потока цветов. Текст ответа agy сейчас использует `RGB(232,234,237)`, поэтому оболочка отслеживает состояние ANSI-цвета и собирает только текст этого цвета.

> **Примечание по платформам:** ANSI-извлечение (`RGB(232,234,237)`) и флаг `--model` проверены на **Windows** с agy >= 1.1. macOS и Linux должны работать через `node-pty`, но точный цвет ответа там еще нужно подтвердить отдельно.
>
> - **agy v1.0.x** (Homebrew `antigravity-cli`) не поддерживает `--model`; используйте `--no-model` или `AGY_COMPANION_NO_MODEL=1`.
> - Если извлечение цвета возвращает пустой результат, запустите с `--debug` и проверьте `agy-debug.log`.

## Установка

```bash
npm install -g companion-for-agy
```

### Требования

- **Node.js >= 18**
- Установленный и авторизованный **agy** ([Gemini CLI](https://github.com/google-gemini/gemini-cli))
- **Инструменты сборки C/C++** для компиляции `node-pty`:
  - **Windows:** Visual Studio Build Tools + Python 3
  - **macOS:** `xcode-select --install`
  - **Linux:** `sudo apt install build-essential python3` (Debian/Ubuntu)

Если native-компиляция не удалась:

```bash
npm rebuild node-pty
```

## Использование

```bash
companion-for-agy [опции] "промпт"
```

### Режимы прав доступа

| Флаг | Описание |
|------|----------|
| `--sandbox` | Режим песочницы (по умолчанию), инструменты в контейнере |
| `--skip-permissions` | Все инструменты без подтверждения (YOLO) |
| `--no-tools` | Только чат, без выполнения инструментов |
| `--researcher` | Веб/поиск разрешен, shell-команды и изменения файлов запрещены |
| `--read-only` | Чтение файлов разрешено, shell-команды и изменения запрещены |

### Пользовательские правила

```bash
--allow "read_file(/путь)"    # Разрешающее правило (можно повторять)
--deny "command(rm)"          # Запрещающее правило (можно повторять)
```

Форматы совпадают с системой прав agy (`settings.json`).

### Опции

| Флаг | Описание |
|------|----------|
| `--model <модель>` | Модель Gemini (по умолчанию: `gemini-3.5-flash`) |
| `--no-model` | Не передавать `--model` в agy; полезно для agy v1.0.x |
| `--timeout <мс>` | Тайм-аут в мс (по умолчанию: `120000`) |
| `--json` | Вывод как JSON-объект |
| `--debug` | Сохранить необработанный PTY-вывод в `agy-debug.log` |
| `--lang <код>` | Язык вывода CLI: `en`, `de`, `es`, `zh-Hans`, `ja`, `ru` |
| `--` | Остановить разбор опций; используйте перед промптами, начинающимися с `-` |

### Переменные окружения

| Переменная | Описание |
|------------|----------|
| `AGY_COMPANION_AGY_PATH` | Путь к бинарному файлу agy (автообнаружение, если не задано) |
| `AGY_PATH` | Альтернативный путь к бинарному файлу agy |
| `AGY_COMPANION_NO_MODEL` | `1`, `true` или `yes`, чтобы пропустить `--model` |
| `AGY_COMPANION_RESPONSE_RGB` | Переопределить цвет ответа как `R,G,B` или `R;G;B` |

### Примеры

```bash
companion-for-agy "Какая столица Баварии?"
companion-for-agy --no-tools "Проверь этот код: ..."
companion-for-agy --researcher "Последняя информация о Node.js 24"
companion-for-agy --read-only --allow "command(git log)" "промпт"
companion-for-agy --json --model gemini-3.5-pro "промпт"
companion-for-agy --no-model "промпт"
companion-for-agy --lang ru --help
companion-for-agy --no-tools -- "-промпт с дефисом"
```

JSON-вывод содержит `response`, `model`, `requestedModel` и `permissionMode`.

## Интернационализация

i18n разделена на три поверхности:

1. **CLI-вывод companion-for-agy:** справка, ошибки и статусные строки.
2. **Документация:** README, руководство для участников, changelog и примеры.
3. **Шаблоны распознавания TUI agy:** внутренние regex для диалога доверия, запуска, инициализации и завершения ответа.

Локальная проверка Windows показала, что `agy --help` остается английским при `LANG=en_US`, `de_DE`, `ja_JP` и `zh_CN`. Это говорит о том, что CLI-справка agy сейчас, вероятно, только английская, но не доказывает, что все TUI-диалоги, будущие версии, плагины или платформенные сценарии останутся английскими.

Пользовательские языки: английский, немецкий, испанский, упрощенный китайский, японский и русский.

Шаблоны распознавания не переводятся вслепую. Английский остается базой; другие языки добавляются только если agy реально выводит эти строки или upstream стабильно документирует их.

## Как это работает

```text
companion-for-agy (Node.js)
  -> запускает agy в PTY
  -> распознает состояния trust/startup/init
  -> отправляет промпт
  -> захватывает ANSI-сегменты цвета ответа
  -> пишет текст ответа в stdout
```

## Сценарии использования

- Многоагентная оркестрация: Claude Code, Codex или другие агенты запрашивают Gemini через agy
- CI/CD-скрипты, которым нужен текстовый вывод agy
- Локальная автоматизация, где TUI-ответ agy нужно получить как stdout

## Лицензия

MIT
