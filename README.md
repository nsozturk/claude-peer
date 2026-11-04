<div align="center">

# ⚡ claude-peer

**Native local Unix Domain Socket (UDS) peer bridge, inter-agent messaging, and live session streamer for Claude Code & Claude Desktop.**

[![npm version](https://img.shields.io/badge/npm-v1.0.0-blue.svg)](https://github.com/nsozturk/claude-peer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-success.svg)](https://github.com/nsozturk/claude-peer)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/nsozturk/claude-peer)

[**Quick Start**](#-quick-start) •
[**CLI Reference**](#-cli-reference) •
[**JavaScript / TypeScript SDK**](#-javascript--typescript-sdk) •
[**Reverse Engineering Discovery**](#-the-reverse-engineering-discovery) •
[**Architecture**](#-architecture--protocol-internals) •
[**Use Cases**](#-real-world-use-cases)

</div>

---

## 🚀 Overview

`claude-peer` is a zero-dependency, production-grade toolkit that reverse-engineers the private Unix Domain Socket (UDS) IPC architecture inside **Claude Code** (`@anthropic-ai/claude-code` v2.1.318+) and the **Claude Desktop** macOS app (`Claude.dmg`).

Without wrapping CLI processes, spawning synthetic pty terminals, or relying on external HTTP relays, `claude-peer` communicates **directly** with active Claude sessions at wire speed:

- 🔍 **Live Session Discovery:** Discovers all active Claude Code and Desktop instances via `~/.claude/sessions/`.
- 💬 **Direct Message Injection:** Injects user prompts and cross-session commands directly into Claude's queue.
- 🤝 **Bi-directional Agent Daemon:** Registers your custom scripts/agents as peers in Claude's internal `ListPeers` registry, enabling Claude to invoke its native `SendMessage` tool back to your process.
- 📺 **Real-Time Streamer:** Live-tails Claude's thoughts (`item.thinking`), tool calls, and assistant replies straight from disk transcripts.
- 🏷️ **Dynamic Session Renaming:** Live-renames running Claude session titles on the fly.
- 🔒 **Full Auth Emulation:** Handles the SHA-256 peer token handshake and macOS socket closure timing contracts.

---

## 📦 Installation

### Global CLI
```bash
npm install -g claude-peer
```
*(or run directly via npx)*
```bash
npx claude-peer list
```

### Local Project Dependency
```bash
npm install claude-peer
```

---

## ⚡ Quick Start

### 1. List all active Claude Code and Desktop sessions
```bash
claude-peer list
```
```text
Found 3 live Claude Code session(s):

- PID: 72160  | Status: idle    | Sock: READY | Key: AUTH-KEY-OK | Name: Research & Planning
  sessionId: fba11159-1043-418e-9909-4d20a85b92d0
  cwd:       /Users/developer/Projects/senatus
  socket:    /tmp/cc-socks/72160.sock
  bridge:    bridge:session_01319CukV3N8oHM8hGcNyXSQ
```

### 2. Inject a message into a running Claude session
```bash
claude-peer send --to 72160 --message "Summarize test coverage for auth.ts" --from-name "MyAgent"
```

### 3. Stream Claude's internal monologue and tool calls in real time
```bash
claude-peer stream --to 72160
```
```text
================================================================
         CLAUDE CODE LIVE STREAM & REVERSE IPC MONITOR          
================================================================
Session PID:     72160
Session ID:      fba11159-1043-418e-9909-4d20a85b92d0
Session Name:    Research & Planning
----------------------------------------------------------------

[10:42:15 PM] 👤 [USER INPUT] 
  │ Summarize test coverage for auth.ts
[10:42:16 PM] 🧠 [THINKING] (Internal reasoning)
  │ The user wants a summary of test coverage for auth.ts. Let me check existing tests...
[10:42:17 PM] 🛠️  [TOOL CALL: Bash] id=toolu_01ABC...
  │ { "command": "npm test -- auth.test.ts" }
[10:42:18 PM] 🤖 [ASSISTANT] 
  │ The auth module currently has 94% statement coverage across 14 unit tests.
```

### 4. Run a persistent two-way peer agent
```bash
claude-peer agent --name "orchestrator" --to 72160 --message "Please notify me when complete."
```

---

## 🛠️ CLI Reference

```text
claude-peer <command> [options]
```

| Command | Arguments / Flags | Description |
|---|---|---|
| `list` | `[--json]` | Discovers all active Claude Code & Desktop sessions |
| `send` | `--to <target>`<br>`--message <text>`<br>`[--from-name <name>]`<br>`[--from-mode prompting\|bypass]`<br>`[--priority next\|now]`<br>`[--raw]` | Injects a message into Claude's message loop |
| `stream` | `[--to <target>]`<br>`[--tail <n>]`<br>`[--all]`<br>`[--raw-json]` | Live-monitors thinking, tool invocations, and answers |
| `agent` | `--name <name>`<br>`[--to <target>]`<br>`[--message <text>]`<br>`[--from-mode prompting\|bypass]`<br>`[--notify-idle]` | Starts a UDS socket daemon that Claude can reply to via `SendMessage` |
| `rename` | `--to <target>`<br>`--name <new-name>` | Sends a control frame to rename the session title |

`<target>` can be:
- Process PID (e.g., `72160`)
- Session UUID or prefix (e.g., `fba11159`)
- Case-insensitive session name substring (e.g., `research`)
- Direct socket path (e.g., `/tmp/cc-socks/72160.sock`)

---

## 💻 JavaScript / TypeScript SDK

`claude-peer` is distributed as native ES Modules with complete TypeScript definitions.

### 1. Send Message
```javascript
import { sendMessageToSession } from "claude-peer";

const { msgId, target } = await sendMessageToSession({
  target: 72160, // PID or session name
  message: "Verify the production build artifacts.",
  fromName: "ReleaseBot",
  fromMode: "prompting",
});

console.log(`Message ${msgId} delivered to PID ${target.pid}`);
```

### 2. Autonomous Two-Way Agent Daemon
```javascript
import { startPeerAgentDaemon, sendMessageToSession } from "claude-peer";

// 1. Start daemon and register in ~/.claude/sessions/
const daemon = await startPeerAgentDaemon({
  name: "linter-daemon",
  onMessage: (frame) => {
    console.log("Inbound cross-session frame from Claude:", frame);
  },
  onControl: (frame) => {
    console.log("Inbound control frame:", frame);
  },
});

console.log(`Daemon active at ${daemon.address} (PID: ${daemon.pid})`);

// 2. Claude can now find 'linter-daemon' in ListPeers and call SendMessage!
```

### 3. Real-Time Transcript Streaming
```javascript
import { listLiveSessions, locateTranscriptFile, tailTranscript } from "claude-peer";

const [session] = await listLiveSessions();
const transcriptPath = locateTranscriptFile(session.sessionId, session.cwd);

const stopWatching = await tailTranscript(transcriptPath, {
  tailLines: 10,
  onEntry: (entry) => {
    if (entry.type === "assistant") {
      console.log("Claude update:", entry.message?.content);
    }
  },
});

// To stop listening:
// stopWatching();
```

---

## 🔬 The Reverse-Engineering Discovery

Anthropic's `@anthropic-ai/claude-code` and `Claude.dmg` include an undocumented local peer communication subsystem designed for multi-agent delegation.

### 1. Session Registry (`~/.claude/sessions/<pid>.json`)
Whenever Claude Code or Desktop initializes, it registers its state in a JSON record:
```json
{
  "pid": 72160,
  "sessionId": "fba11159-1043-418e-9909-4d20a85b92d0",
  "cwd": "/Users/developer/Projects/senatus",
  "startedAt": 1730752810000,
  "procStart": "Wed Nov 4 18:40:10 2026",
  "version": "2.1.318",
  "peerProtocol": 1,
  "peerFeatures": ["notify_idle", "reply_across_default_dirs", "artifact_yield"],
  "messagingSocketPath": "/tmp/cc-socks/72160.sock",
  "name": "Research & Planning",
  "status": "idle"
}
```

### 2. Authentication Handshake & Key Derivation
To prevent unauthorized processes from writing arbitrary commands into the socket, Claude implements a deterministic key file check:
1. Normalizes the socket path: `resolvedPath = path.resolve(socketPath)`
2. Computes the SHA-256 digest: `hash = sha256(resolvedPath).hex`
3. Reads `~/.claude/sessions/<pid>.<hash>.key`:
   ```json
   {
     "peerToken": "4a9d7f8e12c3b5...",
     "procStart": "Wed Nov 4 18:40:10 2026",
     "pidDomain": "darwin"
   }
   ```
4. On establishing a UDS connection, the peer must transmit the auth packet on the first line:
   ```json
   {"type": "auth", "token": "4a9d7f8e12c3b5..."}
   ```
5. On macOS, Claude verifies socket peer credentials using the `LOCAL_PEERPID` socket option.

### 3. macOS Socket Timing Contract
On Darwin (macOS), closing a Unix Domain Socket immediately after writing causes the kernel to discard buffered unread bytes on the receiver end. `claude-peer` incorporates an automatic 150ms graceful flush window (`MACOS_CLOSE_DELAY_MS`) to guarantee 100% transmission fidelity.

### 4. Protocol Frames
Inbound frames are line-delimited JSON (`\n` separated):

#### A. User / Cross-Session Message
```json
{
  "msg_id": "8b5dc431-4c12-4cf4-912f-927d65b16f39",
  "ts": "2026-11-04T19:40:10.000Z",
  "type": "user",
  "message": {
    "role": "user",
    "content": "<cross-session-message from=\"uds:/tmp/cc-socks/90061.sock\" from-name=\"Orchestrator\" from-mode=\"prompting\">\nPlease review PR #42\n</cross-session-message>"
  },
  "priority": "next"
}
```

#### B. Native Desktop UI Badge
When sent with `<cross-session-message>`, Claude Desktop renders an interactive native UI badge in the chat window:
```text
┌────────────────────────────────────────────────────────────────────────┐
│ 💬 Message from another session               [Start a side chat] [Reply]
│ Please review PR #42                                                   │
└────────────────────────────────────────────────────────────────────────┘
```

#### C. Control Frame (Live Rename)
```json
{
  "type": "control",
  "action": "rename",
  "msg_id": "f8a02c31-...",
  "ts": "2026-11-04T19:40:10.000Z",
  "name": "New Session Title"
}
```

#### D. Control Frame (Idle Notification)
```json
{
  "type": "control",
  "action": "notify_when_idle",
  "msg_id": "c1a93e42-...",
  "ts": "2026-11-04T19:40:10.000Z",
  "from": "uds:/tmp/cc-socks/90061.sock"
}
```

---

## 🏛️ Architecture & Protocol Internals

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                           macOS Local IPC Topology                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   [ Claude Desktop / Claude Code ]             [ claude-peer Daemon ]       │
│          (PID: 72160)                               (PID: 90061)             │
│                │                                          │                 │
│                ├───────► ~/.claude/sessions/*.json ◄──────┤                 │
│                │         (Session Discovery)              │                 │
│                │                                          │                 │
│                ├───────► ~/.claude/sessions/*.key  ◄──────┤                 │
│                │         (SHA-256 Peer Auth)              │                 │
│                │                                          │                 │
│    /tmp/cc-socks/72160.sock                   /tmp/cc-socks/90061.sock      │
│        (Target Inbound)                           (Peer Daemon)             │
│                ▲                                          │                 │
│                └──────────── JSON UDS Frame ──────────────┘                 │
│                        <cross-session-message>                              │
│                                                                             │
│                ┌──────────────────────────────────────────┐                 │
│                │      macOS Claude Desktop UI Card        │                 │
│                │  💬 Message from another session         │                 │
│                │  [Start a side chat]  [Reply]            │                 │
│                └──────────────────────────────────────────┘                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 💡 Real-World Use Cases

1. **Multi-Agent Orchestration Swarms:** Connect Claude Code with Google Antigravity, OpenAI Codex, or local Ollama models in an automated round-robin or supervisory hierarchy.
2. **IDE & GUI Extensions:** Build VS Code extensions or status bar menus that show active Claude sessions, inject instant prompts, and monitor tasks without opening a terminal.
3. **Headless CI/CD & Automated Testing:** Stream Claude's tool execution to assert whether it ran the expected commands or touched forbidden files.
4. **Session Management:** Dynamically label and organize background worktree sessions.

---

## 🧪 Testing

`claude-peer` includes a built-in Node.js test suite with zero test dependencies:

```bash
npm test
```

---

## 📄 License

MIT License • Copyright (c) 2026 ns0bj / nsozturk
