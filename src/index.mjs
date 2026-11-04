/**
 * claude-peer
 * Native local Unix Domain Socket (UDS) peer bridge, inter-agent messaging
 * and live session streamer for Claude Code and Claude Desktop.
 *
 * Copyright (c) 2026 ns0bj / nsozturk
 * Licensed under the MIT License.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

export const CLAUDE_CONFIG_DIR =
  (process.env.CLAUDE_CONFIG_DIR ?? "").trim() || path.join(os.homedir(), ".claude");
export const SESSIONS_DIR = path.join(CLAUDE_CONFIG_DIR, "sessions");
export const PROJECTS_DIR = path.join(CLAUDE_CONFIG_DIR, "projects");
export const DEFAULT_SOCK_DIR =
  process.platform === "darwin" ? "/tmp/cc-socks" : path.join(os.tmpdir(), "cc-socks");
export const MACOS_CLOSE_DELAY_MS = 150;

/**
 * Checks whether a process PID is currently alive on the host.
 * @param {number|string} pid
 * @returns {boolean}
 */
export function isPidAlive(pid) {
  const num = Number(pid);
  if (!num || Number.isNaN(num)) return false;
  try {
    process.kill(num, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

/**
 * Gets the process start timestamp from ps, used by Claude Code key validation.
 * @param {number|string} pid
 * @returns {string|undefined}
 */
export function getProcStart(pid) {
  try {
    return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Derives the authentication key file path for a session socket.
 * Formula: ~/.claude/sessions/<pid>.<sha256(path.resolve(socketPath))>.key
 * @param {number|string} pid
 * @param {string} socketPath
 * @param {string} [sessionsDir=SESSIONS_DIR]
 * @returns {string}
 */
export function computeKeyFilePath(pid, socketPath, sessionsDir = SESSIONS_DIR) {
  const resolved = path.resolve(socketPath);
  const hash = crypto.createHash("sha256").update(resolved).digest("hex");
  return path.join(sessionsDir, `${pid}.${hash}.key`);
}

/**
 * Reads peerToken from the session key file without logging sensitive credentials.
 * Checks both resolved and canonical realpath candidates for symlink tolerance (/tmp vs /private/tmp).
 * @param {number|string} pid
 * @param {string} socketPath
 * @param {string} [sessionsDir=SESSIONS_DIR]
 * @returns {string|undefined}
 */
export function readPeerToken(pid, socketPath, sessionsDir = SESSIONS_DIR) {
  const candidates = [computeKeyFilePath(pid, socketPath, sessionsDir)];

  try {
    const real = fs.realpathSync(socketPath);
    if (real !== socketPath) {
      candidates.push(computeKeyFilePath(pid, real, sessionsDir));
    }
  } catch {}

  for (const keyPath of candidates) {
    try {
      if (fs.existsSync(keyPath)) {
        const parsed = JSON.parse(fs.readFileSync(keyPath, "utf8"));
        if (typeof parsed?.peerToken === "string" && parsed.peerToken.length > 0) {
          return parsed.peerToken;
        }
      }
    } catch {
      // Ignore unreadable or corrupt key files
    }
  }
  return undefined;
}

/**
 * Probes a Unix Domain Socket to verify reachability.
 * @param {string} socketPath
 * @param {number} [timeoutMs=250]
 * @returns {Promise<boolean>}
 */
export function probeSocket(socketPath, timeoutMs = 250) {
  return new Promise((resolve) => {
    if (!socketPath || !fs.existsSync(socketPath)) {
      resolve(false);
      return;
    }
    const sock = net.createConnection({ path: socketPath });
    const done = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.on("connect", () => done(true));
    sock.on("error", (err) => done(err?.code === "EBUSY"));
    sock.setTimeout(timeoutMs, () => done(false));
  });
}

/**
 * Discovers all active Claude Code and Claude Desktop sessions.
 * Inspects ~/.claude/sessions/<pid>.json and checks process liveness & socket reachability.
 * @param {object} [options]
 * @param {string} [options.sessionsDir=SESSIONS_DIR]
 * @param {boolean} [options.probeSockets=true]
 * @returns {Promise<Array<object>>}
 */
export async function listLiveSessions(options = {}) {
  const sessionsDir = options.sessionsDir || SESSIONS_DIR;
  const shouldProbe = options.probeSockets !== false;

  if (!fs.existsSync(sessionsDir)) return [];
  const files = fs.readdirSync(sessionsDir).filter((f) => /^\d+\.json$/.test(f));
  const sessions = [];

  for (const file of files) {
    const fullPath = path.join(sessionsDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      if (!data?.pid || !isPidAlive(data.pid)) continue;

      const sock = data.messagingSocketPath || "";
      const sockReachable = sock && shouldProbe ? await probeSocket(sock) : Boolean(sock && fs.existsSync(sock));
      const hasKey = sock ? Boolean(readPeerToken(data.pid, sock, sessionsDir)) : false;

      sessions.push({
        pid: data.pid,
        sessionId: data.sessionId,
        name: data.name || "",
        status: data.status || "unknown",
        entrypoint: data.entrypoint || "cli",
        kind: data.kind || "interactive",
        cwd: data.cwd || "",
        startedAt: data.startedAt || 0,
        messagingSocketPath: sock,
        sockReachable,
        hasKey,
        bridgeSessionId: data.bridgeSessionId || "",
        peerFeatures: data.peerFeatures || [],
      });
    } catch {
      // Ignore malformed or torn JSON records
    }
  }

  sessions.sort((a, b) => b.startedAt - a.startedAt);
  return sessions;
}

/**
 * Resolves a target session by PID, sessionId, partial UUID, session name, or socket path.
 * @param {string|number} query
 * @param {object} [options]
 * @param {string} [options.sessionsDir=SESSIONS_DIR]
 * @returns {Promise<object>}
 */
export async function resolveTargetSession(query, options = {}) {
  if (!query) throw new Error("Missing target session query (--to <pid|sessionId|name|sockPath>)");
  let q = String(query).trim();

  if (q.startsWith("uds:")) {
    q = q.slice(4);
  }

  if (q.endsWith(".sock") && fs.existsSync(q)) {
    const pidMatch = path.basename(q).match(/^(\d+)\.sock$/);
    const pid = pidMatch ? Number(pidMatch[1]) : 0;
    return {
      pid,
      messagingSocketPath: q,
      sessionId: undefined,
      name: q,
    };
  }

  const sessions = await listLiveSessions(options);
  const byPid = sessions.find((s) => String(s.pid) === q);
  if (byPid) return byPid;

  const bySessionId = sessions.find(
    (s) => s.sessionId === q || (s.sessionId && s.sessionId.startsWith(q))
  );
  if (bySessionId) return bySessionId;

  const qLower = q.toLowerCase();
  const byExactName = sessions.find((s) => s.name && s.name.toLowerCase() === qLower);
  if (byExactName) return byExactName;

  const bySubstringName = sessions.find((s) => s.name && s.name.toLowerCase().includes(qLower));
  if (bySubstringName) return bySubstringName;

  throw new Error(
    `Could not resolve active Claude session for query '${query}'. Run 'claude-peer list' to check running sessions.`
  );
}

/**
 * Escapes XML attribute values for cross-session message envelopes.
 * @param {string|number} val
 * @returns {string}
 */
export function escapeXmlAttr(val) {
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Wraps text into Claude Code's native cross-session XML envelope.
 * @param {object} params
 * @param {string} params.text
 * @param {string} [params.fromAddress]
 * @param {string} [params.fromSessionId]
 * @param {string} [params.fromName]
 * @param {string} [params.fromMode] - 'prompting' or 'bypass'
 * @param {string} [params.hopChain]
 * @param {boolean} [params.raw=false]
 * @returns {string}
 */
export function formatCrossSessionEnvelope({
  text,
  fromAddress,
  fromSessionId,
  fromName,
  fromMode,
  hopChain,
  raw = false,
}) {
  if (raw) return text;
  const attrs = [];
  if (fromAddress) attrs.push(`from="${escapeXmlAttr(fromAddress)}"`);
  if (fromSessionId) attrs.push(`from-session="${escapeXmlAttr(fromSessionId)}"`);
  if (fromName) attrs.push(`from-name="${escapeXmlAttr(fromName)}"`);
  if (fromMode) attrs.push(`from-mode="${escapeXmlAttr(fromMode)}"`);
  if (hopChain) attrs.push(`hop-chain="${escapeXmlAttr(hopChain)}"`);
  const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";
  return `<cross-session-message${attrStr}>\n${text}\n</cross-session-message>`;
}

/**
 * Sends a raw JSON frame over Unix Domain Socket with required authentication and macOS timing delay.
 * @param {string} socketPath
 * @param {number|string} pid
 * @param {object} frameObj
 * @param {object} [options]
 * @param {string} [options.sessionsDir=SESSIONS_DIR]
 * @param {number} [options.timeoutMs=5000]
 * @param {number} [options.closeDelayMs=MACOS_CLOSE_DELAY_MS]
 * @returns {Promise<void>}
 */
export async function sendRawUdsFrame(socketPath, pid, frameObj, options = {}) {
  const sessionsDir = options.sessionsDir || SESSIONS_DIR;
  const timeoutMs = options.timeoutMs || 5000;
  const closeDelayMs =
    options.closeDelayMs !== undefined
      ? options.closeDelayMs
      : process.platform === "darwin"
      ? MACOS_CLOSE_DELAY_MS
      : 0;

  const peerToken = pid ? readPeerToken(pid, socketPath, sessionsDir) : undefined;
  const lines = [];
  if (peerToken) {
    lines.push(JSON.stringify({ type: "auth", token: peerToken }));
  }
  lines.push(JSON.stringify(frameObj));
  const payload = lines.join("\n") + "\n";

  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ path: socketPath });
    let failed = false;

    sock.setTimeout(timeoutMs, () => {
      failed = true;
      sock.destroy();
      reject(new Error(`Timed out connecting/writing to socket ${socketPath}`));
    });

    sock.on("error", (err) => {
      failed = true;
      reject(err);
    });

    sock.on("connect", () => {
      sock.write(payload, (err) => {
        if (err) {
          failed = true;
          sock.destroy();
          reject(err);
          return;
        }

        if (closeDelayMs > 0) {
          setTimeout(() => {
            if (!sock.destroyed) sock.end();
          }, closeDelayMs);
        } else {
          sock.end();
        }
      });
    });

    sock.on("close", () => {
      if (!failed) resolve();
    });
  });
}

/**
 * Injects a message into a running Claude Code or Claude Desktop session.
 * @param {object} options
 * @param {string|number|object} options.target - Query string or session object
 * @param {string} options.message - Message body
 * @param {string} [options.fromAddress] - UDS socket address e.g. 'uds:/tmp/cc-socks/1234.sock'
 * @param {string} [options.fromSessionId]
 * @param {string} [options.fromName='external-agent']
 * @param {string} [options.fromMode] - 'prompting' or 'bypass'
 * @param {string} [options.priority='next'] - 'next' or 'now'
 * @param {boolean} [options.raw=false]
 * @returns {Promise<{ msgId: string, target: object }>}
 */
export async function sendMessageToSession({
  target,
  message,
  fromAddress,
  fromSessionId,
  fromName = "external-agent",
  fromMode,
  priority = "next",
  raw = false,
}) {
  const resolved = typeof target === "object" && target !== null && target.messagingSocketPath
    ? target
    : await resolveTargetSession(target);

  if (!resolved.messagingSocketPath) {
    throw new Error(`Target session PID ${resolved.pid} has no messagingSocketPath`);
  }

  const msgId = crypto.randomUUID();
  const content = formatCrossSessionEnvelope({
    text: message,
    fromAddress,
    fromSessionId,
    fromName,
    fromMode,
    raw,
  });

  const frame = {
    msg_id: msgId,
    ts: new Date().toISOString(),
    type: "user",
    message: {
      role: "user",
      content,
    },
    priority,
    ...(fromAddress ? { from: fromAddress } : {}),
  };

  await sendRawUdsFrame(resolved.messagingSocketPath, resolved.pid, frame);
  return { msgId, target: resolved };
}

/**
 * Sends a control frame to a running session (e.g. rename, notify_when_idle).
 * @param {object} options
 * @param {string|number|object} options.target
 * @param {string} options.action - e.g. 'rename' or 'notify_when_idle'
 * @param {object} [options.payload={}]
 * @returns {Promise<{ msgId: string, target: object }>}
 */
export async function sendControlToSession({ target, action, payload = {} }) {
  const resolved = typeof target === "object" && target !== null && target.messagingSocketPath
    ? target
    : await resolveTargetSession(target);

  if (!resolved.messagingSocketPath) {
    throw new Error(`Target session PID ${resolved.pid} has no messagingSocketPath`);
  }

  const msgId = crypto.randomUUID();
  const frame = {
    type: "control",
    action,
    msg_id: msgId,
    ts: new Date().toISOString(),
    ...payload,
  };

  await sendRawUdsFrame(resolved.messagingSocketPath, resolved.pid, frame);
  return { msgId, target: resolved };
}

/**
 * Starts a persistent local UDS peer server and registers ~/.claude/sessions/<pid>.json + .key
 * Allows running Claude sessions to discover this agent via ListPeers and message it via SendMessage.
 * @param {object} [options]
 * @param {string} [options.name='claude-peer-agent']
 * @param {string} [options.cwd=process.cwd()]
 * @param {string} [options.sockDir=DEFAULT_SOCK_DIR]
 * @param {string} [options.sessionsDir=SESSIONS_DIR]
 * @param {function} [options.onMessage]
 * @param {function} [options.onControl]
 * @returns {Promise<object>} Daemon control handle with cleanup() method
 */
export async function startPeerAgentDaemon(options = {}) {
  const {
    name = "claude-peer-agent",
    cwd = process.cwd(),
    sockDir = DEFAULT_SOCK_DIR,
    sessionsDir = SESSIONS_DIR,
    onMessage,
    onControl,
  } = options;

  const pid = process.pid;
  const sessionId = crypto.randomUUID();
  const procStart = getProcStart(pid) || new Date().toUTCString();
  const peerToken = crypto.randomBytes(16).toString("hex");

  fs.mkdirSync(sockDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });

  const socketPath = path.join(sockDir, `${pid}.sock`);
  try {
    fs.unlinkSync(socketPath);
  } catch {}

  const server = net.createServer((conn) => {
    conn.setEncoding("utf8");
    let buf = "";
    conn.on("data", (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "auth") continue;
          if (parsed.type === "user" || parsed.type === "message") {
            onMessage?.(parsed);
          } else if (parsed.type === "control") {
            onControl?.(parsed);
          } else {
            onMessage?.(parsed);
          }
        } catch (err) {
          console.error("[claude-peer] Malformed inbound socket frame:", err.message);
        }
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      fs.chmodSync(socketPath, 0o600);
      resolve();
    });
  });

  const keyFilePath = computeKeyFilePath(pid, socketPath, sessionsDir);
  const sessionFilePath = path.join(sessionsDir, `${pid}.json`);
  const keyData = JSON.stringify({
    peerToken,
    procStart,
    pidDomain: "darwin",
  });

  let realKeyPath = "";
  fs.writeFileSync(keyFilePath, keyData, { mode: 0o600 });
  try {
    const realPath = fs.realpathSync(socketPath);
    realKeyPath = computeKeyFilePath(pid, realPath, sessionsDir);
    if (realKeyPath !== keyFilePath) {
      fs.writeFileSync(realKeyPath, keyData, { mode: 0o600 });
    }
  } catch {}

  const sessionRecord = {
    pid,
    sessionId,
    cwd,
    startedAt: Date.now(),
    procStart,
    version: "2.1.318",
    peerProtocol: 1,
    peerFeatures: ["notify_idle", "reply_across_default_dirs", "artifact_yield"],
    kind: "interactive",
    entrypoint: "cli",
    pidDomain: "darwin",
    messagingSocketPath: socketPath,
    name,
    nameSource: "user",
    nameSince: Date.now(),
    status: "idle",
    statusUpdatedAt: Date.now(),
    updatedAt: Date.now(),
  };

  fs.writeFileSync(sessionFilePath, JSON.stringify(sessionRecord), { mode: 0o600 });

  const cleanup = () => {
    try {
      server.close();
    } catch {}
    for (const f of [socketPath, keyFilePath, realKeyPath, sessionFilePath]) {
      try {
        if (f) fs.unlinkSync(f);
      } catch {}
    }
  };

  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
  process.once("exit", cleanup);

  return {
    pid,
    sessionId,
    name,
    socketPath,
    address: `uds:${socketPath}`,
    cleanup,
  };
}

/**
 * Locates the JSONL transcript file for a given session.
 * @param {string} sessionId
 * @param {string} [cwd]
 * @param {object} [options]
 * @param {string} [options.projectsDir=PROJECTS_DIR]
 * @returns {string|null}
 */
export function locateTranscriptFile(sessionId, cwd, options = {}) {
  const projectsDir = options.projectsDir || PROJECTS_DIR;

  if (cwd) {
    const slug = cwd.replace(/\//g, "-");
    const primaryCandidate = path.join(projectsDir, slug, `${sessionId}.jsonl`);
    if (fs.existsSync(primaryCandidate)) return primaryCandidate;
  }

  if (fs.existsSync(projectsDir)) {
    const projectDirs = fs.readdirSync(projectsDir);
    for (const pDir of projectDirs) {
      const candidate = path.join(projectsDir, pDir, `${sessionId}.jsonl`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Tails a Claude Code session transcript (.jsonl) in real-time.
 * @param {string} transcriptPath
 * @param {object} [options]
 * @param {number} [options.tailLines=10]
 * @param {boolean} [options.showAll=false]
 * @param {function} [options.onEntry]
 * @returns {Promise<function>} Stop watching function
 */
export async function tailTranscript(transcriptPath, options = {}) {
  const { tailLines = 10, showAll = false, onEntry } = options;

  if (!fs.existsSync(transcriptPath)) {
    throw new Error(`Transcript file not found: ${transcriptPath}`);
  }

  let filePos = 0;
  const stat = fs.statSync(transcriptPath);

  if (showAll) {
    filePos = 0;
  } else if (tailLines > 0) {
    const content = fs.readFileSync(transcriptPath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const startIdx = Math.max(0, lines.length - tailLines);
    for (let i = startIdx; i < lines.length; i++) {
      try {
        const parsed = JSON.parse(lines[i]);
        onEntry?.(parsed);
      } catch {}
    }
    filePos = stat.size;
  } else {
    filePos = stat.size;
  }

  let lineBuffer = "";

  const checkNewData = () => {
    try {
      const currentStat = fs.statSync(transcriptPath);
      if (currentStat.size < filePos) {
        filePos = 0;
      }
      if (currentStat.size > filePos) {
        const readLen = currentStat.size - filePos;
        const buf = Buffer.alloc(readLen);
        const fd = fs.openSync(transcriptPath, "r");
        fs.readSync(fd, buf, 0, readLen, filePos);
        fs.closeSync(fd);
        filePos = currentStat.size;

        lineBuffer += buf.toString("utf8");
        let idx;
        while ((idx = lineBuffer.indexOf("\n")) !== -1) {
          const line = lineBuffer.slice(0, idx).replace(/\r$/, "").trim();
          lineBuffer = lineBuffer.slice(idx + 1);
          if (!line) continue;
          try {
            const parsed = JSON.parse(line);
            onEntry?.(parsed);
          } catch {}
        }
      }
    } catch {}
  };

  const watcher = fs.watch(transcriptPath, checkNewData);
  const interval = setInterval(checkNewData, 200);

  return () => {
    try {
      watcher.close();
      clearInterval(interval);
    } catch {}
  };
}
