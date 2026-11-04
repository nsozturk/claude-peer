/**
 * Example: send-message.mjs
 * Sends a message directly into a running Claude Code or Claude Desktop session.
 */

import { listLiveSessions, sendMessageToSession } from "../src/index.mjs";

async function main() {
  const sessions = await listLiveSessions();

  if (sessions.length === 0) {
    console.log("No active Claude Code sessions found. Start a Claude session first!");
    process.exit(1);
  }

  // Pick target session (latest or specified PID)
  const target = sessions[0];
  console.log(`Sending message to PID ${target.pid} ('${target.name || "unnamed"}')...`);

  const result = await sendMessageToSession({
    target,
    message: "Hello from claude-peer! This message was injected via local Unix Domain Socket.",
    fromName: "Autonomous-Orchestrator",
    fromMode: "prompting",
    priority: "next",
  });

  console.log(`✓ Injected successfully! Message ID: ${result.msgId}`);
  console.log(`Check Claude Desktop or your Claude Code terminal to see the received message.`);
}

main().catch(console.error);
