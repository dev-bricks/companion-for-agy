# Roadmap

## Planned

### Color Fallback / Auto-Probe
The current ANSI color extraction relies on `RGB(232,234,237)` as the response color. This has been verified on Windows (ConPTY). If agy changes its color scheme or uses different values on macOS/Linux, extraction silently fails.

**Ideas:**
- `--probe-color`: Run a known-answer prompt ("What is 2+2?"), scan the raw ANSI stream for the color that wraps "4", and cache it per platform
- Platform-specific RGB override via environment variable (`AGY_COMPANION_RESPONSE_RGB`)
- Heuristic: find the most frequent non-UI color in the stream

### Multi-Turn Mode
Currently, each invocation spawns a fresh agy process (one question, one answer). A persistent mode that keeps the PTY alive across multiple prompts would reduce startup overhead for batch workloads.

### Streaming Output
Emit response tokens as they arrive (line-by-line or chunk-by-chunk) instead of buffering until completion. Useful for long responses where the caller wants progressive output.

### Response Format Detection
Detect whether agy's response is Markdown, JSON, or plain text and expose this in the JSON output (`"format": "markdown"`).

## Completed (v1.2.0)

- Trust dialog auto-confirmation (5-phase state machine)
- Banner model detection (actual model from agy's banner)
- Short response noise filter fix (answers like "4" or "42")
- Prompt-echo stripping in no-tools mode (ConPTY space-loss tolerant)
- Cross-platform agy binary auto-detection
- node-pty as standard npm dependency
