/**
 * Example: live-monitor.mjs
 * Streams real-time thinking, tool calls, and assistant responses from an active session.
 */

import { listLiveSessions, locateTranscriptFile, tailTranscript } from "../src/index.mjs";

async function main() {
  const sessions = await listLiveSessions();

  if (sessions.length === 0) {
    console.log("No running Claude Code sessions found.");
    process.exit(1);
  }

  const target = sessions[0];
  const transcriptPath = locateTranscriptFile(target.sessionId, target.cwd);

  if (!transcriptPath) {
    console.error(`Could not find transcript file for session ${target.sessionId}`);
    process.exit(1);
  }

  console.log(`Streaming session: PID ${target.pid} ('${target.name || "unnamed"}')`);
  console.log(`Transcript file: ${transcriptPath}\n`);

  const stop = await tailTranscript(transcriptPath, {
    tailLines: 5,
    onEntry: (entry) => {
      const role = entry.message?.role || entry.type;
      const content = entry.message?.content;

      if (role === "assistant" && Array.isArray(content)) {
        for (const item of content) {
          if (item.type === "thinking") {
            console.log(`\n🧠 [THINKING]:\n${item.thinking}\n`);
          } else if (item.type === "text") {
            console.log(`\n🤖 [ASSISTANT]: ${item.text}`);
          } else if (item.type === "tool_use") {
            console.log(`\n🛠️  [TOOL]: ${item.name} (${JSON.stringify(item.input)})`);
          }
        }
      } else if (role === "user") {
        console.log(`\n👤 [USER]: ${typeof content === "string" ? content : JSON.stringify(content)}`);
      }
    },
  });

  process.on("SIGINT", () => {
    stop();
    console.log("\nMonitor stopped.");
    process.exit(0);
  });
}

main().catch(console.error);
