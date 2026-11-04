/**
 * Type definitions for claude-peer
 * Native local Unix Domain Socket (UDS) peer bridge, inter-agent messaging
 * and live session streamer for Claude Code and Claude Desktop.
 */

export interface ClaudeSession {
  pid: number;
  sessionId: string;
  name: string;
  status: "idle" | "busy" | string;
  entrypoint: "cli" | "desktop" | string;
  kind: "interactive" | string;
  cwd: string;
  startedAt: number;
  messagingSocketPath: string;
  sockReachable: boolean;
  hasKey: boolean;
  bridgeSessionId?: string;
  peerFeatures?: string[];
}

export interface CrossSessionEnvelopeOptions {
  text: string;
  fromAddress?: string;
  fromSessionId?: string;
  fromName?: string;
  fromMode?: "prompting" | "bypass";
  hopChain?: string;
  raw?: boolean;
}

export interface SendMessageOptions {
  target: string | number | ClaudeSession;
  message: string;
  fromAddress?: string;
  fromSessionId?: string;
  fromName?: string;
  fromMode?: "prompting" | "bypass";
  priority?: "next" | "now";
  raw?: boolean;
}

export interface SendControlOptions {
  target: string | number | ClaudeSession;
  action: "rename" | "notify_when_idle" | string;
  payload?: Record<string, unknown>;
}

export interface StartPeerDaemonOptions {
  name?: string;
  cwd?: string;
  sockDir?: string;
  sessionsDir?: string;
  onMessage?: (frame: unknown) => void;
  onControl?: (frame: unknown) => void;
}

export interface PeerDaemonHandle {
  pid: number;
  sessionId: string;
  name: string;
  socketPath: string;
  address: string;
  cleanup: () => void;
}

export interface TailTranscriptOptions {
  tailLines?: number;
  showAll?: boolean;
  onEntry?: (entry: unknown) => void;
}

export interface ListSessionsOptions {
  sessionsDir?: string;
  probeSockets?: boolean;
}

export interface ResolveSessionOptions {
  sessionsDir?: string;
}

export interface SendRawFrameOptions {
  sessionsDir?: string;
  timeoutMs?: number;
  closeDelayMs?: number;
}

export interface LocateTranscriptOptions {
  projectsDir?: string;
}

export declare const CLAUDE_CONFIG_DIR: string;
export declare const SESSIONS_DIR: string;
export declare const PROJECTS_DIR: string;
export declare const DEFAULT_SOCK_DIR: string;
export declare const MACOS_CLOSE_DELAY_MS: number;

export declare function isPidAlive(pid: number | string): boolean;
export declare function getProcStart(pid: number | string): string | undefined;
export declare function computeKeyFilePath(
  pid: number | string,
  socketPath: string,
  sessionsDir?: string
): string;
export declare function readPeerToken(
  pid: number | string,
  socketPath: string,
  sessionsDir?: string
): string | undefined;
export declare function probeSocket(socketPath: string, timeoutMs?: number): Promise<boolean>;

export declare function listLiveSessions(options?: ListSessionsOptions): Promise<ClaudeSession[]>;
export declare function resolveTargetSession(
  query: string | number,
  options?: ResolveSessionOptions
): Promise<ClaudeSession>;

export declare function escapeXmlAttr(val: string | number): string;
export declare function formatCrossSessionEnvelope(params: CrossSessionEnvelopeOptions): string;

export declare function sendRawUdsFrame(
  socketPath: string,
  pid: number | string,
  frameObj: unknown,
  options?: SendRawFrameOptions
): Promise<void>;

export declare function sendMessageToSession(
  options: SendMessageOptions
): Promise<{ msgId: string; target: ClaudeSession }>;

export declare function sendControlToSession(
  options: SendControlOptions
): Promise<{ msgId: string; target: ClaudeSession }>;

export declare function startPeerAgentDaemon(
  options?: StartPeerDaemonOptions
): Promise<PeerDaemonHandle>;

export declare function locateTranscriptFile(
  sessionId: string,
  cwd?: string,
  options?: LocateTranscriptOptions
): string | null;

export declare function tailTranscript(
  transcriptPath: string,
  options?: TailTranscriptOptions
): Promise<() => void>;
