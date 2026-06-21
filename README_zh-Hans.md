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

> **非官方** - 本项目不隶属于 Google，也未获得 Google 背书。

**companion-for-agy** 是一个基于 PTY 的 **agy** (Antigravity CLI / Gemini CLI) 包装器，用于从子进程中捕获 Gemini 响应。

## 问题

`agy -p` (打印模式) 会以退出码 0 结束，但不会把响应写入 stdout。TUI 渲染器 (`text_drip.go`) 会把文本写入终端缓冲区。相关上游问题：

- [antigravity-cli#76](https://github.com/google-antigravity/antigravity-cli/issues/76)
- [gemini-cli#27466](https://github.com/google-gemini/gemini-cli/issues/27466)
- [antigravity-cli#115](https://github.com/google-antigravity/antigravity-cli/issues/115)

因此 Claude Code、Codex 或 CI/CD 脚本等其他代理无法以编程方式读取 agy 的响应。

## 解决方案

`companion-for-agy` 通过 `node-pty` 在虚拟终端中启动 agy (Windows 使用 ConPTY，macOS/Linux 使用 forkpty)，并从 ANSI 颜色流中提取响应。agy 当前的响应文本使用 `RGB(232,234,237)`，因此包装器会跟踪 ANSI 颜色状态，只收集该颜色的文本。

> **平台说明:** ANSI 颜色提取 (`RGB(232,234,237)`) 和 `--model` 参数已在 **Windows** 与 agy >= 1.1 中验证。macOS 和 Linux 预计可通过 `node-pty` 工作，但仍需独立确认准确的响应颜色。
>
> - **agy v1.0.x** (Homebrew `antigravity-cli`) 不支持 `--model`；请使用 `--no-model` 或 `AGY_COMPANION_NO_MODEL=1`。
> - 如果颜色提取结果为空，请使用 `--debug` 并检查 `agy-debug.log`。
> - 在 macOS/Linux 上，请先运行 `companion-for-agy --platform-smoke --json`。它把 `--doctor` 和 `--pty-smoke` 合并为一个 pre-live 平台报告。

## 安装

```bash
npm install -g companion-for-agy
```

### 前提条件

- **Node.js >= 18**
- 已安装并完成认证的 **agy** ([Gemini CLI](https://github.com/google-gemini/gemini-cli))
- 用于编译 `node-pty` 的 **C/C++ 构建工具**:
  - **Windows:** Visual Studio Build Tools + Python 3
  - **macOS:** `xcode-select --install`
  - **Linux:** `sudo apt install build-essential python3` (Debian/Ubuntu)

如果原生模块编译失败:

```bash
npm rebuild node-pty
```

## 用法

```bash
companion-for-agy [选项] "提示词"
```

### 权限模式

| 参数 | 说明 |
|------|------|
| `--sandbox` | 沙箱模式 (默认)，工具在容器中运行 |
| `--skip-permissions` | 所有工具无需确认 (YOLO) |
| `--no-tools` | 纯聊天，不执行工具 |
| `--researcher` | 允许网页/搜索研究，禁止 shell 命令和文件修改 |
| `--read-only` | 允许读取文件，禁止 shell 命令和修改 |

### 自定义规则

```bash
--allow "read_file(/路径)"    # 允许规则 (可重复)
--deny "command(rm)"          # 拒绝规则 (可重复)
```

格式与 agy 自身的权限系统 (`settings.json`) 一致。

### 选项

| 参数 | 说明 |
|------|------|
| `--model <模型>` | Gemini 模型 (默认: `gemini-3.5-flash`) |
| `--no-model` | 不向 agy 传递 `--model`；适用于 agy v1.0.x |
| `--timeout <毫秒>` | 超时时间 (默认: `120000`) |
| `--json` | 以 JSON 对象输出 |
| `--debug` | 将原始 PTY 输出保存到 `agy-debug.log` |
| `--doctor` | 输出 agy、node-pty 和 helper artifact 的平台预检 |
| `--platform-smoke` | 将 `--doctor` 和 `--pty-smoke` 作为一个 pre-live gate 运行 |
| `--pty-smoke` | 运行无需认证的 node-pty truecolor smoke |
| `--live-smoke` | 运行真实 agy 标记 smoke；默认使用 `no-tools` |
| `--lang <代码>` | CLI 输出语言: `en`, `de`, `es`, `zh-Hans`, `ja`, `ru` |
| `--` | 停止解析选项；用于以 `-` 开头的提示词 |

### 环境变量

| 变量 | 说明 |
|------|------|
| `AGY_COMPANION_AGY_PATH` | agy 二进制文件路径 (未设置时自动检测) |
| `AGY_PATH` | agy 二进制文件备用路径 |
| `AGY_COMPANION_NO_MODEL` | 设置为 `1`、`true` 或 `yes` 以省略 `--model` |
| `AGY_COMPANION_RESPONSE_RGB` | 以 `R,G,B` 或 `R;G;B` 覆盖响应颜色 |

### 示例

```bash
companion-for-agy "巴伐利亚的首都是哪里？"
companion-for-agy --no-tools "审查这段代码: ..."
companion-for-agy --researcher "关于 Node.js 24 的最新信息"
companion-for-agy --read-only --allow "command(git log)" "提示词"
companion-for-agy --json --model gemini-3.5-pro "提示词"
companion-for-agy --no-model "提示词"
companion-for-agy --platform-smoke --json
companion-for-agy --lang zh-Hans --help
companion-for-agy --no-tools -- "-以短横线开头的提示词"
```

JSON 输出包含 `response`、`model`、`requestedModel` 和 `permissionMode`。
`--doctor`、`--platform-smoke`、`--pty-smoke` 和 `--live-smoke` 搭配 `--json` 时会输出包含 `status`、`blockers` 和 `warnings` 的平台报告。

## 国际化

i18n 分为三个独立层面：

1. **companion-for-agy CLI 输出:** 帮助文本、错误和状态行。
2. **文档:** README、贡献指南、变更日志和示例。
3. **agy TUI 识别模式:** 用于检测信任对话框、启动、初始化和响应结束的内部正则表达式。

Windows 本地检查显示，`agy --help` 在 `LANG=en_US`、`de_DE`、`ja_JP` 和 `zh_CN` 下仍为英文。这说明 agy CLI 帮助目前似乎只有英文，但不能证明所有 TUI 对话、未来版本、插件或平台流程都会保持英文。

用户语言: 英语、德语、西班牙语、简体中文、日语和俄语。

识别模式不会盲目翻译。英文保持为基线；只有当 agy 实际输出这些文本，或上游稳定记录这些字符串时，才添加其他语言模式。

## 工作方式

```text
companion-for-agy (Node.js)
  -> 在 PTY 中启动 agy
  -> 检测信任、启动和初始化状态
  -> 发送提示词
  -> 捕获响应颜色对应的 ANSI 片段
  -> 将响应文本写入 stdout
```

## 使用场景

- 多代理编排: Claude Code、Codex 或其他代理通过 agy 查询 Gemini
- 需要 agy 文本输出的 CI/CD 脚本
- 需要把 agy TUI 响应捕获为 stdout 的本地自动化

## 最佳实践: 两条返回路径

companion-for-agy 提供两种从 agy 获取结果的方式，请根据需求选择：

### 路径 1 — stdout (短消息、任务委派)

默认路径：companion-for-agy 从 PTY 捕获 agy 的响应，并写入自身的 stdout。它对**短响应和 ASCII 文本**工作可靠，适用于通过简短的 `-p` 提示词委派任务、只需获取紧凑回答的场景。

```bash
companion-for-agy --no-tools "2 + 2 等于几？"
```

**限制 (在 Windows 上观察到):** 当响应较长或包含非 ASCII 内容 (例如中文、日文、韩文等 CJK 字符) 时，stdout 返回路径可能损坏输出，将字符替换为替换字符 (U+FFFD)。这是 PTY/ANSI 提取层的特性，而非 agy 本身的问题。

### 路径 2 — 通过 `--add-dir` 输出到文件 (大体量响应、非 ASCII、CJK)

让 agy 直接把结果写入文件。agy 自己写入磁盘，数据不经过 PTY 颜色提取。该路径对**任意内容**都可靠，包括完整的 CJK 文本。

**模式:** 写一个简短的指令文件，用简短的 `-p` 提示词让 agy 指向它，然后从磁盘读取结果。

```bash
# agy 自己把结果写入 /my/output/result.json — 干净的 UTF-8，包含 CJK
companion-for-agy --skip-permissions --add-dir "/my/output" \
  "Read /my/output/task.txt and follow it exactly."
# 然后读取 /my/output/result.json (或任务中指定的路径)
```

> **经验法则:**
> - **委派任务、传递简短提示词** → stdout 即可。
> - **需要可靠地获取完整响应** (长文本、非 ASCII、CJK) → 使用 `--add-dir`，让 agy 写入文件。

**依据:** 任务下发 (入站) 是可靠的——agy 能正确接收指令，包括 CJK 内容。通过 `--add-dir` 的文件输出同样干净 (已在 Windows 上用 CJK 内容验证)。stdout 返回路径才是非 ASCII 和大体量内容的薄弱环节。

## 许可证

MIT
