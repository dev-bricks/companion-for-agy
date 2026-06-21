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
> - macOS/Linux では、live smoke の前に `companion-for-agy --platform-smoke --json` を実行してください。`--doctor` と `--pty-smoke` を 1 つの pre-live レポートにまとめます。

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
| `--doctor` | agy、node-pty、helper artifact のプラットフォーム診断を表示 |
| `--platform-smoke` | `--doctor` と `--pty-smoke` を pre-live gate として実行 |
| `--pty-smoke` | 認証不要の node-pty truecolor smoke を実行 |
| `--live-smoke` | 実際の agy マーカー smoke を実行。デフォルトは `no-tools` |
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
companion-for-agy --platform-smoke --json
companion-for-agy --lang ja --help
companion-for-agy --no-tools -- "-ハイフンで始まるプロンプト"
```

JSON 出力には `response`、`model`、`requestedModel`、`permissionMode` が含まれます。
`--doctor`、`--platform-smoke`、`--pty-smoke`、`--live-smoke` は、`--json` と組み合わせると `status`、`blockers`、`warnings` を含むプラットフォームレポートを出力します。

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

## ベストプラクティス: 2 つの応答取得経路

companion-for-agy には agy から結果を受け取る方法が 2 つあります。用途に応じて選択してください。

### 経路 1 — stdout (短いメッセージ、タスクの委譲)

デフォルトの経路です。companion-for-agy は PTY から agy の応答を取得し、自身の stdout に書き出します。**短い応答や ASCII テキスト**では確実に動作し、短い `-p` プロンプトでタスクを委譲してコンパクトな回答だけを受け取りたい場合に適しています。

```bash
companion-for-agy --no-tools "2 + 2 は？"
```

**制限 (Windows で確認):** 応答が長い場合や、非 ASCII 文字 (中国語・日本語・韓国語などの CJK 文字) を含む場合、stdout 経由の取得で出力が文字化けし、文字が置換文字 (U+FFFD) に置き換わることがあります。これは agy 自体ではなく、PTY/ANSI 抽出層の特性です。

### 経路 2 — `--add-dir` によるファイル出力 (大きな応答、非 ASCII、CJK)

agy に結果を直接ファイルへ書き込ませます。agy 自身がディスクへ書き込むため、データが PTY の色抽出を通りません。この経路は完全な CJK テキストを含む**あらゆる内容**で確実に動作します。

**パターン:** 短い指示ファイルを用意し、短い `-p` プロンプトで agy にそれを参照させ、結果をディスクから読み取ります。

```bash
# agy 自身が結果を /my/output/result.json に書き込む — CJK を含むクリーンな UTF-8
companion-for-agy --skip-permissions --add-dir "/my/output" \
  "Read /my/output/task.txt and follow it exactly."
# その後 /my/output/result.json を読む (またはタスクで指定されたパス)
```

> **目安:**
> - **タスクを委譲し、短いプロンプトを渡す** → stdout で十分。
> - **応答全体を確実に取得する必要がある** (長文、非 ASCII、CJK) → `--add-dir` を使い、agy にファイルを書かせる。

**根拠:** タスクの送信 (インバウンド) は確実です。agy は CJK を含む指示も正しく受け取ります。`--add-dir` によるファイル出力もクリーンです (Windows で CJK 内容を確認済み)。stdout 経由の取得経路が、非 ASCII や大きな内容で信頼できない箇所です。

## ライセンス

MIT
