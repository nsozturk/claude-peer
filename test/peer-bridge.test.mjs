/**
 * Tests for claude-peer core functionality.
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";

import {
  computeKeyFilePath,
  formatCrossSessionEnvelope,
  escapeXmlAttr,
  isPidAlive,
  resolveTargetSession,
  locateTranscriptFile,
} from "../src/index.mjs";

test("isPidAlive checks process liveness", () => {
  assert.equal(isPidAlive(process.pid), true);
  assert.equal(isPidAlive(0), false);
  assert.equal(isPidAlive("invalid"), false);
  // Unlikely high PID
  assert.equal(isPidAlive(999999999), false);
});

test("computeKeyFilePath correctly derives sha256 key path", () => {
  const pid = 12345;
  const socketPath = "/tmp/cc-socks/12345.sock";
  const customSessionsDir = "/fake/claude/sessions";

  const keyPath = computeKeyFilePath(pid, socketPath, customSessionsDir);
  const resolved = path.resolve(socketPath);
  const expectedHash = crypto.createHash("sha256").update(resolved).digest("hex");
  const expectedPath = path.join(customSessionsDir, `12345.${expectedHash}.key`);

  assert.equal(keyPath, expectedPath);
});

test("escapeXmlAttr properly sanitizes XML special characters", () => {
  assert.equal(escapeXmlAttr('hello & "world" <test>'), "hello &amp; &quot;world&quot; &lt;test&gt;");
  assert.equal(escapeXmlAttr(1234), "1234");
});

test("formatCrossSessionEnvelope formats XML envelope with attributes", () => {
  const envelope = formatCrossSessionEnvelope({
    text: "Sample instruction",
    fromAddress: "uds:/tmp/cc-socks/9999.sock",
    fromSessionId: "uuid-123",
    fromName: "Orchestrator <bot>",
    fromMode: "prompting",
    hopChain: "hop1",
  });

  assert.ok(envelope.startsWith("<cross-session-message"));
  assert.ok(envelope.includes('from="uds:/tmp/cc-socks/9999.sock"'));
  assert.ok(envelope.includes('from-session="uuid-123"'));
  assert.ok(envelope.includes('from-name="Orchestrator &lt;bot&gt;"'));
  assert.ok(envelope.includes('from-mode="prompting"'));
  assert.ok(envelope.includes('hop-chain="hop1"'));
  assert.ok(envelope.includes("Sample instruction"));
  assert.ok(envelope.endsWith("</cross-session-message>"));
});

test("formatCrossSessionEnvelope returns raw text when raw: true", () => {
  const rawText = "Just pure command";
  const res = formatCrossSessionEnvelope({
    text: rawText,
    fromName: "Should be ignored",
    raw: true,
  });
  assert.equal(res, rawText);
});

test("locateTranscriptFile resolves cwd slug correctly", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-peer-test-"));
  const cwd = "/Users/test/my-project";
  const slug = cwd.replace(/\//g, "-");
  const projectFolder = path.join(tmpDir, slug);
  fs.mkdirSync(projectFolder, { recursive: true });

  const sessionId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  const transcriptPath = path.join(projectFolder, `${sessionId}.jsonl`);
  fs.writeFileSync(transcriptPath, '{"type":"test"}\n');

  const located = locateTranscriptFile(sessionId, cwd, { projectsDir: tmpDir });
  assert.equal(located, transcriptPath);

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("resolveTargetSession resolves direct socket paths", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sock-test-"));
  const sockPath = path.join(tmpDir, "8888.sock");
  fs.writeFileSync(sockPath, "");

  const res = await resolveTargetSession(sockPath);
  assert.equal(res.pid, 8888);
  assert.equal(res.messagingSocketPath, sockPath);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
