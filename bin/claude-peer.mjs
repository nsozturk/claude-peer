#!/usr/bin/env node
/**
 * claude-peer CLI
 * Native Unix Domain Socket peer bridge, inter-agent messaging,
 * and live session streamer for Claude Code and Claude Desktop.
 *
 * Copyright (c) 2026 ns0bj / nsozturk
 * Licensed under the MIT License.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {
  listLiveSessions,
  resolveTargetSession,
  sendMessageToSession,
  sendControlToSession,
  startPeerAgentDaemon,
  locateTranscriptFile,
  tailTranscript,
} from "../src/index.mjs";

const VERSION = "1.0.0";

// ANSI Colors
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const WHITE = "\x1b[37m";
const BG_CYAN = "\x1b[46m\x1b[30m";

function printHelp() {
  console.log(`
${BOLD}claude-peer${RESET} v${VERSION}
Native local Unix Domain Socket (UDS) peer bridge & streamer for Claude Code.

${BOLD}USAGE:${RESET}
  claude-peer <command> [options]

${BOLD}COMMANDS:${RESET}
  ${CYAN}list${RESET}                                Discover all active Claude Code / Desktop sessions
  ${CYAN}send${RESET} --to <target> --message <text>   Send a cross-session message to a running session
  ${CYAN}stream${RESET} [--to <target>]                Live-tail Claude's thoughts, tools, and responses
  ${CYAN}agent${RESET} --name <name>                  Run a persistent UDS peer daemon Claude can message
  ${CYAN}rename${RESET} --to <target> --name <name>    Live-rename a running session's title

${BOLD}OPTIONS:${RESET}
  ${GREEN}list:${RESET}
    --json                    Output sessions as raw JSON

  ${GREEN}send:${RESET}
    --to <pid|id|name|sock>   Target session identifier
    --message, -m <text>      Message content to send
    --from-name <name>        Sender display name (default: "claude-peer")
    --from-mode <mode>        Permission mode: "prompting" (default) or "bypass"
    --priority <priority>     "next" (default) or "now"
    --raw                     Send as raw user input without XML wrapper

  ${GREEN}stream:${RESET}
    --to <pid|id|name>        Target session (defaults to most recently active)
    --tail <n>                Number of initial lines to replay (default: 5)
    --all                     Replay entire session transcript from start
    --raw-json                Output raw transcript JSON records

  ${GREEN}agent:${RESET}
    --name <name>             Agent name shown in Claude's ListPeers (default: "claude-peer-agent")
    --to <target>             Optionally send an initial message to a session upon start
    --message <text>          Initial message text
    --from-mode <mode>        "prompting" or "bypass"
    --notify-idle             Subscribe to notify_when_idle event on the target session

  ${GREEN}rename:${RESET}
    --to <target>             Target session identifier
    --name <new-name>         New title for the session

  -h, --help                  Show this help message
  -v, --version               Show version
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else if (a.startsWith("-")) {
      const key = a.slice(1);
      if (key === "m") {
        args.message = argv[++i];
      } else if (key === "h") {
        args.help = true;
      } else if (key === "v") {
        args.version = true;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function printFormatted(tag, header, body = "", color = WHITE) {
  const time = new Date().toLocaleTimeString();
  const banner = `${DIM}[${time}]${RESET} ${color}${BOLD}${tag}${RESET} ${header}`;
  console.log(banner);

  if (body) {
    const indented = body
      .split("\n")
      .map((line) => `  ${color}│${RESET} ${line}`)
      .join("\n");
    console.log(indented);
  }
}

function formatTranscriptEntry(entry) {
  const type = entry.type;
  const msg = entry.message || {};
  const role = msg.role || type;
  const content = msg.content;

  if (type === "api-request") {
    printFormatted(
      "⚡ [API REQUEST]",
      `${DIM}model=${entry.model || "claude"} id=${entry.id || ""} ts=${entry.timestamp || ""}${RESET}`,
      "",
      CYAN
    );
    return;
  }

  if (role === "user") {
    if (typeof content === "string") {
      printFormatted("👤 [USER INPUT]", "", content, CYAN);
      return;
    }
    if (Array.isArray(content)) {
      for (const item of content) {
        if (item.type === "text") {
          printFormatted("👤 [USER INPUT]", "", item.text, CYAN);
        } else if (item.type === "tool_result") {
          let toolText = "";
          if (typeof item.content === "string") {
            toolText = item.content;
          } else if (Array.isArray(item.content)) {
            toolText = item.content.map((c) => c.text || JSON.stringify(c)).join("\n");
          } else {
            toolText = JSON.stringify(item.content, null, 2);
          }
          if (toolText.length > 800) {
            toolText = toolText.slice(0, 800) + `\n... [truncated ${toolText.length - 800} chars]`;
          }
          printFormatted(
            "⚡ [TOOL RESULT]",
            `${DIM}id=${item.tool_use_id} is_error=${item.is_error || false}${RESET}`,
            toolText,
            BLUE
          );
        }
      }
      return;
    }
  }

  if (role === "assistant") {
    if (typeof content === "string") {
      printFormatted("🤖 [ASSISTANT]", "", content, GREEN);
      return;
    }
    if (Array.isArray(content)) {
      for (const item of content) {
        if (item.type === "thinking" && item.thinking && item.thinking.trim()) {
          printFormatted("🧠 [THINKING]", `${DIM}(Internal reasoning)${RESET}`, item.thinking, MAGENTA);
        } else if (item.type === "text") {
          printFormatted("🤖 [ASSISTANT]", "", item.text, GREEN);
        } else if (item.type === "tool_use") {
          const inputStr = JSON.stringify(item.input, null, 2);
          printFormatted(
            `🛠️  [TOOL CALL: ${item.name}]`,
            `${DIM}id=${item.id}${RESET}`,
            inputStr,
            YELLOW
          );
        }
      }
      return;
    }
  }

  if (type === "system" && entry.subtype === "stop_hook_summary") {
    printFormatted("🛑 [TURN COMPLETE]", `Hooks executed: ${entry.hookCount || 0}`, "", DIM);
  }
}

async function handleList(args) {
  const sessions = await listLiveSessions();
  if (args.json) {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }
  if (sessions.length === 0) {
    console.log("No running Claude Code or Claude Desktop sessions found in ~/.claude/sessions/");
    return;
  }
  console.log(`Found ${sessions.length} live Claude Code session(s):\n`);
  for (const s of sessions) {
    const reachable = s.sockReachable ? `${GREEN}READY${RESET}` : `${YELLOW}UNREACHABLE${RESET}`;
    const key = s.hasKey ? `${GREEN}AUTH-KEY-OK${RESET}` : `${DIM}NO-KEY${RESET}`;
    console.log(
      `- PID: ${BOLD}${String(s.pid).padEnd(6)}${RESET} | Status: ${s.status.padEnd(7)} | Sock: ${reachable} | Key: ${key} | Name: ${GREEN}${s.name || "(unnamed)"}${RESET}`
    );
    console.log(`  sessionId: ${DIM}${s.sessionId}${RESET}`);
    console.log(`  cwd:       ${s.cwd}`);
    console.log(`  socket:    ${s.messagingSocketPath}`);
    if (s.bridgeSessionId) console.log(`  bridge:    bridge:${s.bridgeSessionId}`);
    console.log("");
  }
}

async function handleSend(args) {
  const to = args.to || args._[1];
  const message = args.message || args._[2];
  if (!to || !message) {
    console.error("Error: --to and --message are required.\nRun 'claude-peer --help' for usage.");
    process.exit(1);
  }

  const res = await sendMessageToSession({
    target: to,
    message,
    fromAddress: args["from-address"],
    fromSessionId: args["from-session"],
    fromName: args["from-name"] || "claude-peer",
    fromMode: args["from-mode"],
    priority: args.priority || "next",
    raw: Boolean(args.raw),
  });

  console.log(
    `✓ Sent message (msg_id=${res.msgId}) to PID ${res.target.pid} (${res.target.name || res.target.messagingSocketPath})`
  );
}

async function handleRename(args) {
  const to = args.to || args._[1];
  const name = args.name || args._[2];
  if (!to || !name) {
    console.error("Error: --to and --name are required.\nRun 'claude-peer --help' for usage.");
    process.exit(1);
  }

  const res = await sendControlToSession({
    target: to,
    action: "rename",
    payload: { name },
  });

  console.log(`✓ Renamed session PID ${res.target.pid} to '${name}' (msg_id=${res.msgId})`);
}

async function handleStream(args) {
  let targetQuery = args.to || args._[1];

  if (!targetQuery) {
    const sessions = await listLiveSessions();
    if (sessions.length === 0) {
      console.error("No active Claude sessions found. Start a Claude Code session first.");
      process.exit(1);
    }
    targetQuery = String(sessions[0].pid);
    console.log(`Auto-selected latest session: PID ${sessions[0].pid} ('${sessions[0].name || "unnamed"}')`);
  }

  const target = await resolveTargetSession(targetQuery);
  const transcriptPath = locateTranscriptFile(target.sessionId, target.cwd);

  if (!transcriptPath) {
    console.error(`Could not locate transcript file for session ${target.sessionId} in ~/.claude/projects/`);
    process.exit(1);
  }

  console.log(`\n${BOLD}================================================================${RESET}`);
  console.log(`${BG_CYAN}         CLAUDE CODE LIVE STREAM & REVERSE IPC MONITOR          ${RESET}`);
  console.log(`${BOLD}================================================================${RESET}`);
  console.log(`Session PID:     ${CYAN}${target.pid}${RESET}`);
  console.log(`Session ID:      ${CYAN}${target.sessionId}${RESET}`);
  console.log(`Session Name:    ${GREEN}${target.name || "(unnamed)"}${RESET}`);
  console.log(`Directory (cwd): ${target.cwd}`);
  console.log(`Transcript File: ${transcriptPath}`);
  console.log(`Socket Path:     ${target.messagingSocketPath || "(none)"}`);
  console.log(`${DIM}Type any text and press Enter to inject a prompt live into this session.${RESET}`);
  console.log(`${BOLD}----------------------------------------------------------------${RESET}\n`);

  const tailLines = args.all ? 0 : args.tail ? parseInt(args.tail, 10) : 5;
  const showAll = Boolean(args.all);

  const stopTail = await tailTranscript(transcriptPath, {
    tailLines,
    showAll,
    onEntry: (entry) => {
      if (args["raw-json"]) {
        console.log(JSON.stringify(entry));
      } else {
        formatTranscriptEntry(entry);
      }
    },
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on("line", async (line) => {
    const text = line.trim();
    if (!text) return;
    try {
      console.log(`\n${DIM}Injecting live into PID ${target.pid}...${RESET}`);
      await sendMessageToSession({
        target,
        message: text,
        fromName: "claude-peer-stream",
        priority: "next",
        raw: false,
      });
      printFormatted("🚀 [INJECTED PROMPT]", `to PID ${target.pid}`, text, CYAN);
    } catch (err) {
      console.error(`Failed to inject: ${err.message}`);
    }
  });

  const cleanup = () => {
    stopTail();
    rl.close();
    console.log(`\n${DIM}Live stream disconnected.${RESET}`);
    process.exit(0);
  };

  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
}

async function handleAgent(args) {
  const agentName = args.name || "claude-peer-agent";

  const daemon = await startPeerAgentDaemon({
    name: agentName,
    onMessage: (frame) => {
      console.log(`\n${GREEN}${BOLD}[INBOUND MESSAGE]${RESET} (${new Date().toLocaleTimeString()}):`);
      console.log(JSON.stringify(frame, null, 2));
    },
    onControl: (frame) => {
      console.log(`\n${YELLOW}${BOLD}[INBOUND CONTROL]${RESET} (${new Date().toLocaleTimeString()}):`);
      console.log(JSON.stringify(frame, null, 2));
    },
  });

  console.log(`✓ Registered live peer agent '${BOLD}${daemon.name}${RESET}' at ${daemon.address} (PID ${daemon.pid})`);
  console.log(`Running Claude Code sessions can now see '${daemon.name}' via ListPeers and message it via SendMessage.`);

  if (args.to && args.message) {
    const res = await sendMessageToSession({
      target: args.to,
      message: args.message,
      fromAddress: daemon.address,
      fromSessionId: daemon.sessionId,
      fromName: daemon.name,
      fromMode: args["from-mode"],
      priority: args.priority || "next",
    });
    console.log(`✓ Sent initial message (msg_id=${res.msgId}) to PID ${res.target.pid}`);

    if (args["notify-idle"]) {
      const sub = await sendControlToSession({
        target: res.target,
        action: "notify_when_idle",
        payload: {
          from: daemon.address,
          ...(args["from-mode"] ? { from_mode: args["from-mode"] } : {}),
        },
      });
      console.log(`✓ Subscribed to notify_when_idle on PID ${res.target.pid} (msg_id=${sub.msgId})`);
    }
  }

  console.log(`${DIM}Listening for incoming peer messages... (Press Ctrl+C to stop)${RESET}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    console.log(VERSION);
    return;
  }

  if (args.help || args._.length === 0) {
    printHelp();
    return;
  }

  const cmd = args._[0];

  switch (cmd) {
    case "list":
    case "ls":
      await handleList(args);
      break;
    case "send":
    case "msg":
      await handleSend(args);
      break;
    case "stream":
    case "monitor":
    case "tail":
      await handleStream(args);
      break;
    case "agent":
    case "daemon":
    case "peer":
      await handleAgent(args);
      break;
    case "rename":
      await handleRename(args);
      break;
    default:
      console.error(`Unknown command: '${cmd}'. Run 'claude-peer --help' for available commands.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${YELLOW}Error:${RESET} ${err.message}`);
  process.exit(1);
});
