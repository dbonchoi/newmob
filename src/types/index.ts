import type { SshConnectInfo } from "../components/terminal/TerminalPanel";

export type TabKind = "terminal" | "sftp" | "rdp" | "vnc" | "nettools" | "welcome" | "placeholder";

export interface Tab {
  id: string;
  type: TabKind;
  title: string;
  sessionId?: string;
  connectionId?: string;
  closable: boolean;
  ssh?: SshConnectInfo;
  message?: string;
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";
