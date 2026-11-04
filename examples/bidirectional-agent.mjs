/**
 * Example: bidirectional-agent.mjs
 * Starts a persistent peer daemon registered in ~/.claude/sessions/
 * Claude sessions can discover this agent via ListPeers and reply via SendMessage.
 */

import { startPeerAgentDaemon, sendMessageToSession, listLiveSessions } from "../src/index.mjs";

async function main() {
  console.log("Starting Claude Peer Agent daemon...");

  const agent = await startPeerAgentDaemon({
    name: "external-worker-bot",
    onMessage: (frame) => {
      console.log("\n==============================================");
      console.log("📨 INCOMING MESSAGE FROM CLAUDE CODE/DESKTOP:");
      console.log(JSON.stringify(frame, null, 2));
      console.log("==============================================\n");
    },
    onControl: (frame) => {
      console.log("\n⚡ INCOMING CONTROL FRAME:", frame);
    },
  });

  console.log(`✓ Agent online: '${agent.name}' (PID: ${agent.pid})`);
  console.log(`✓ Socket bound: ${agent.socketPath}`);
  console.log(`✓ Address:      ${agent.address}`);
  console.log("Claude can now see this agent in 'ListPeers' and send messages using 'SendMessage'.\n");

  // Optionally find another session and invite it to talk:
  const liveSessions = await listLiveSessions();
  const claudeSession = liveSessions.find((s) => s.pid !== agent.pid);

  if (claudeSession) {
    console.log(`Found running Claude session PID ${claudeSession.pid} ('${claudeSession.name}'). Sending ping...`);
    await sendMessageToSession({
      target: claudeSession,
      message: `Hello Claude! I am '${agent.name}' listening at ${agent.address}. You can reply to me with SendMessage!`,
      fromAddress: agent.address,
      fromSessionId: agent.sessionId,
      fromName: agent.name,
      fromMode: "prompting",
    });
    console.log("Ping sent! Awaiting Claude's reply... (Press Ctrl+C to stop)");
  } else {
    console.log("Listening for incoming messages... (Press Ctrl+C to stop)");
  }
}

main().catch(console.error);
