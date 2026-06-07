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

> **非公式** - Google とは提携しておらず、Google による承認も受けていません。

**companion-for-agy** は、サブプロセスから Gemini の応答を取得するための **agy** (Antigravity CLI / Gemini CLI) 向け PTY ベースのラッパーです。

## 問題

`agy -p` (print モード) は終了コード 0 で終了しますが、応答を stdout に書き込みません。代わりに TUI レンダラー (`text_drip.go`) が端末バッファへ書き込みます。関連する既知の issue:

- [antigravity-cli#76](https://github.com/google-antigravity/antigravity-cli/issues/76)
- [gemini-cli#27466](https://github.com/google-gemini/gemini-cli/issues/27466)
- [antigravity-cli#115](https://github.com/google-antigravity/antigravity-cli/issues/115)

そのため Claude Code、Codex、CI/CD スクリプトなどの他のエージェントは、agy の応答をプログラムから読み取れません。

## 解決策

`companion-for-agy` は `node-pty` を使って仮想端末内で agy を起動し (Windows は ConPTY、macOS/Linux は forkpty)、ANSI カラーストリームから応答を抽出します。agy の応答テキストは現在 `RGB(232,234,237)` を使うため、ラッパーは ANSI の色状態を追跡し、その色のテキストだけを収集します。

> **プラットフォーム注意:** ANSI 色抽出 (`RGB(232,234,237)`) と `--model` フラグは、agy >= 1.1 の **Windows** で検証済みです。macOS と Linux も `node-pty` 経由で動作する見込みですが、正確な応答色は未検証です。
>
> - **agy v1.0.x** (Homebrew `antigravity-cli`) は `--model` をサポートしません。`--no-model` または `AGY_COMPANION_NO_MODEL=1` を使用してください。
> - 色抽出が空になる場合は `--debug` を指定し、`agy-debug.log` を確認してください。

## インストール

```bash
npm install -g companion-for-agy
```

### 前提条件

- **Node.js >= 18**
- インストール済みで認証済みの **agy** ([Gemini CLI](https://github.com/google-gemini/gemini-cli))
- `node-pty` のネイティブコンパイル用 **C/C++ ビルドツール**:
  - **Windows:** Visual Studio Build Tools + Python 3
  - **macOS:** `xcode-select --install`
  - **Linux:** `sudo apt install build-essential python3` (Debian/Ubuntu)

ネイティブコンパイルが失敗する場合:

```bash
npm rebuild node-pty
```

## 使い方

```bash
companion-for-agy [オプション] "プロンプト"
```

### 権限モード

| フラグ | 説明 |
|--------|------|
| `--sandbox` | サンドボックスモード (デフォルト)、コンテナ内でツール実行 |
| `--skip-permissions` | すべてのツールを確認なしで実行 (YOLO) |
| `--no-tools` | チャットのみ、ツール実行なし |
| `--researcher` | Web/検索調査を許可し、shell コマンドとファイル変更は禁止 |
| `--read-only` | ファイル読み取りを許可し、shell コマンドと変更は禁止 |

### カスタムルール

```bash
--allow "read_file(/path)"    # 許可ルール (繰り返し可)
--deny "command(rm)"          # 拒否ルール (繰り返し可)
```

形式は agy の権限システム (`settings.json`) と同じです。

### オプション

| フラグ | 説明 |
|--------|------|
| `--model <モデル>` | Gemini モデル (デフォルト: `gemini-3.5-flash`) |
| `--no-model` | agy に `--model` を渡さない。agy v1.0.x に有用 |
| `--timeout <ms>` | タイムアウト (ミリ秒、デフォルト: `120000`) |
| `--json` | JSON オブジェクトとして出力 |
| `--debug` | 生の PTY 出力を `agy-debug.log` に保存 |
| `--lang <コード>` | CLI 出力言語: `en`, `de`, `es`, `zh-Hans`, `ja`, `ru` |
| `--` | オプション解析を停止。`-` で始まるプロンプトの前に使用 |

### 環境変数

| 変数 | 説明 |
|------|------|
| `AGY_COMPANION_AGY_PATH` | agy バイナリへのパス (未設定なら自動検出) |
| `AGY_PATH` | agy バイナリへの代替パス |
| `AGY_COMPANION_NO_MODEL` | `1`、`true`、`yes` で `--model` を省略 |
| `AGY_COMPANION_RESPONSE_RGB` | 応答色を `R,G,B` または `R;G;B` で上書き |

### 例

```bash
companion-for-agy "バイエルンの首都はどこですか？"
companion-for-agy --no-tools "このコードをレビューしてください: ..."
companion-for-agy --researcher "Node.js 24 の最新情報"
companion-for-agy --read-only --allow "command(git log)" "プロンプト"
companion-for-agy --json --model gemini-3.5-pro "プロンプト"
companion-for-agy --no-model "プロンプト"
companion-for-agy --lang ja --help
companion-for-agy --no-tools -- "-ハイフンで始まるプロンプト"
```

JSON 出力には `response`、`model`、`requestedModel`、`permissionMode` が含まれます。

## 国際化

i18n は 3 つの対象に分かれます。

1. **companion-for-agy の CLI 出力:** ヘルプ、エラー、状態行。
2. **ドキュメント:** README、コントリビューションガイド、変更履歴、例。
3. **agy TUI 認識パターン:** 信頼ダイアログ、起動、初期化、応答完了を検出する内部正規表現。

Windows のローカル確認では、`agy --help` は `LANG=en_US`、`de_DE`、`ja_JP`、`zh_CN` でも英語のままでした。現時点では agy の CLI ヘルプは英語のみと考えられますが、すべての TUI ダイアログ、将来の agy リリース、プラグイン、OS 固有フローが英語のままとは限りません。

ユーザー向け言語: 英語、ドイツ語、スペイン語、簡体字中国語、日本語、ロシア語。

認識パターンは推測で翻訳しません。英語を基準にし、agy が実際にその文字列を出力した場合、または upstream が安定した文字列として文書化した場合のみ追加します。

## 動作概要

```text
companion-for-agy (Node.js)
  -> PTY 内で agy を起動
  -> trust/startup/init 状態を検出
  -> プロンプトを送信
  -> 応答色の ANSI セグメントを取得
  -> 応答テキストを stdout に書き出す
```

## ユースケース

- マルチエージェント連携: Claude Code、Codex、その他のエージェントが agy 経由で Gemini に問い合わせる
- agy のテキスト出力を必要とする CI/CD スクリプト
- agy の TUI 応答を stdout として捕捉するローカル自動化

## ライセンス

MIT
