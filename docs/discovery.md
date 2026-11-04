# Claude Code Native IPC & Cross-Session Protocol: Reverse Engineering & Deep Technical Discovery

> **Author:** Antigravity AI & ns0bj (nsozturk)  
> **Date:** November 2026  
> **Target:** `@anthropic-ai/claude-code` (v2.1.318+), `Claude.dmg` macOS Desktop Application (v4.16336.0+), Unix Domain Socket (UDS) Inter-Process Communication.

---

## 1. Executive Summary

Anthropic's **Claude Code** CLI and the **Claude Desktop** application utilize a private, local Inter-Process Communication (IPC) architecture based on Unix Domain Sockets (UDS) for cross-session discovery, state synchronization, and sub-agent delegation.

By reverse-engineering both the npm distribution (`@anthropic-ai/claude-code`) and the unpacked Electron desktop application (`Claude.app` / `Claude.dmg`), we uncovered:
1. **Peer Discovery:** How instances announce themselves in `~/.claude/sessions/<pid>.json`.
2. **Deterministic Cryptographic Handshake:** How socket access is gated via `~/.claude/sessions/<pid>.<sha256>.key` and validated against macOS kernel process credentials (`LOCAL_PEERPID`).
3. **Desktop UI Integration:** How cross-session envelopes trigger native `"Message from another session"` interactive cards inside Claude Desktop.
4. **Bidirectional Autonomy:** How external agents (e.g. Google Antigravity, OpenAI Codex, or standalone Node scripts) can register as full peers, enabling Claude to discover them via `ListPeers` and send structured replies back via its internal `SendMessage` tool.

---

## 2. Architecture & File Layout

### A. Session Registration (`~/.claude/sessions/<pid>.json`)

On startup, each Claude instance writes a registration file to the user's config directory:

```json
{
  "pid": 72160,
  "sessionId": "fba11159-1043-418e-9909-4d20a85b92d0",
  "cwd": "/Users/developer/Projects/senatus",
  "startedAt": 1730752810000,
  "procStart": "Wed Nov 4 18:40:10 2026",
  "version": "2.1.318",
  "peerProtocol": 1,
  "peerFeatures": [
    "notify_idle",
    "reply_across_default_dirs",
    "artifact_yield"
  ],
  "kind": "interactive",
  "entrypoint": "cli",
  "pidDomain": "darwin",
  "messagingSocketPath": "/tmp/cc-socks/72160.sock",
  "name": "Research & Planning",
  "nameSource": "user",
  "nameSince": 1730752810000,
  "status": "idle",
  "statusUpdatedAt": 1730752815000,
  "updatedAt": 1730752815000
}
```

### B. Socket Authentication (`~/.claude/sessions/<pid>.<hash>.key`)

To ensure rogue or unprivileged local processes cannot execute arbitrary instructions, Claude validates every socket connection with a token matching the socket's canonical path:

1. Target socket path is resolved: `resolved = path.resolve(socketPath)`
2. SHA-256 digest is generated: `hash = crypto.createHash('sha256').update(resolved).digest('hex')`
3. A key file is saved at `~/.claude/sessions/<pid>.<hash>.key`:
   ```json
   {
     "peerToken": "4a9d7f8e12c3b5a79012345678abcdef",
     "procStart": "Wed Nov 4 18:40:10 2026",
     "pidDomain": "darwin"
   }
   ```
4. Inbound connections must immediately send an authentication header on the first line:
   ```json
   {"type": "auth", "token": "4a9d7f8e12c3b5a79012345678abcdef"}
   ```
5. On macOS, the receiver also inspects the connection's `LOCAL_PEERPID` to confirm kernel-level PID identity.

### C. macOS UDS Socket Timing Contract

On macOS Darwin kernels, calling `.end()` or `.destroy()` immediately after `.write()` on a Unix Domain Socket can lead to silent data loss if the receiver has not yet scheduled a read cycle. A 150ms delay between write completion and stream shutdown ensures that packets are delivered reliably without EOF truncation.

---

## 3. Protocol Wire Format

All packets sent over the Unix Domain Socket are line-delimited JSON strings (`\n`).

### 1. Cross-Session Message Packet
```json
{
  "msg_id": "8b5dc431-4c12-4cf4-912f-927d65b16f39",
  "ts": "2026-11-04T19:40:10.000Z",
  "type": "user",
  "message": {
    "role": "user",
    "content": "<cross-session-message from=\"uds:/tmp/cc-socks/90061.sock\" from-session=\"local_uuid\" from-name=\"ExternalAgent\" from-mode=\"prompting\">\nExecute tests for module X\n</cross-session-message>"
  },
  "priority": "next",
  "from": "uds:/tmp/cc-socks/90061.sock"
}
```

### 2. Rename Control Packet
```json
{
  "type": "control",
  "action": "rename",
  "msg_id": "f8a02c31-4c12-4cf4-912f-927d65b16f39",
  "ts": "2026-11-04T19:40:10.000Z",
  "name": "New Dynamic Session Title"
}
```

### 3. Idle Subscription Packet
```json
{
  "type": "control",
  "action": "notify_when_idle",
  "msg_id": "c1a93e42-4c12-4cf4-912f-927d65b16f39",
  "ts": "2026-11-04T19:40:10.000Z",
  "from": "uds:/tmp/cc-socks/90061.sock"
}
```

---

## 4. Verification and Proof of Bidirectional Operation

During our verification tests:
1. `claude-peer` registered as daemon `AGY-Peer` on `/tmp/cc-socks/90061.sock`.
2. A cross-session envelope was dispatched to Claude Desktop (`PID: 72160`).
3. Claude Desktop displayed a native prompt card:
   ```text
   ┌────────────────────────────────────────────────────────────────────────┐
   │ 💬 Message from another session               [Start a side chat] [Reply]
   │ AGY-Peer has connected to the socket mesh. Please acknowledge.         │
   └────────────────────────────────────────────────────────────────────────┘
   ```
4. Claude processed the message and called its built-in tool `SendMessage`:
   ```json
   {
     "tool": "SendMessage",
     "input": {
       "to": "uds:/tmp/cc-socks/90061.sock",
       "message": "Message received! Ack from session fba11159...",
       "summary": "Ack to AGY-Peer"
     }
   }
   ```
5. The reply frame landed directly in `AGY-Peer`'s socket listener, proving **100% native, unassisted bi-directional communication**.
