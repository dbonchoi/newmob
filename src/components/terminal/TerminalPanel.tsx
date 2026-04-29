import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { terminalThemes } from "../../lib/themes";
import {
  createLocalTerminal,
  createSshTerminal,
  writeTerminal,
  resizeTerminal,
  closeTerminal,
  listenTerminalOutput,
  listenTerminalExit,
  encodeBase64,
  decodeBase64,
} from "../../lib/ipc";
import type { UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

export interface SshConnectInfo {
  host: string;
  port: number;
  username: string;
  authMethod: string;
  authData: string | null;
}

interface TerminalPanelProps {
  theme?: string;
  ssh?: SshConnectInfo;
  visible?: boolean;
}

export function TerminalPanel({ theme = "classic", ssh, visible = true }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const initializedRef = useRef(false);

  const fitVisibleTerminal = () => {
    const el = containerRef.current;
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    if (!el || !term || !fitAddon || el.clientWidth === 0 || el.clientHeight === 0) {
      return;
    }

    try {
      fitAddon.fit();
      term.refresh(0, term.rows - 1);
      const sid = sessionIdRef.current;
      if (sid) {
        resizeTerminal(sid, term.cols, term.rows).catch(() => {});
      }
    } catch {
      // Hidden tabs can briefly report invalid dimensions while switching.
    }
  };

  // Initialize once for the lifetime of this tab. Visibility changes must not
  // dispose the terminal, otherwise PTY/SSH sessions reconnect on tab switch.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || initializedRef.current) return;

    initializedRef.current = true;

    let destroyed = false;
    let unlistenOutput: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;
    let resizeTimer: ReturnType<typeof setTimeout>;

    const term = new Terminal({
      theme: terminalThemes[theme] ?? terminalThemes.classic,
      fontFamily: "'Consolas', 'Menlo', 'DejaVu Sans Mono', monospace",
      fontSize: 14,
      cursorBlink: true,
      scrollback: 10000,
    });
    termRef.current = term;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.loadAddon(new SearchAddon());
    term.loadAddon(new WebLinksAddon());
    term.open(el);

    try {
      term.loadAddon(new WebglAddon());
    } catch { /* WebGL not available */ }

    fitVisibleTerminal();

    term.onData((data) => {
      if (sessionIdRef.current) {
        writeTerminal(sessionIdRef.current, encodeBase64(data)).catch(console.error);
      }
    });

    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        fitVisibleTerminal();
      }, 100);
    });
    observer.observe(el);

    const { cols, rows } = term;

    const connectPromise = ssh
      ? createSshTerminal(ssh.host, ssh.port, ssh.username, ssh.authMethod, ssh.authData, cols, rows)
      : createLocalTerminal(cols, rows);

    if (ssh) {
      term.write(`\x1b[33mConnecting to ${ssh.username}@${ssh.host}:${ssh.port}...\x1b[0m\r\n`);
    }

    connectPromise
      .then(async (sid) => {
        if (destroyed) {
          closeTerminal(sid).catch(() => {});
          return;
        }
        sessionIdRef.current = sid;

        unlistenOutput = await listenTerminalOutput(sid, (b64) => {
          term.write(decodeBase64(b64));
        });

        unlistenExit = await listenTerminalExit(sid, () => {
          term.write("\r\n\x1b[33m[Session ended]\x1b[0m\r\n");
        });
      })
      .catch((err) => {
        console.error("Failed to create terminal:", err);
        term.write(`\x1b[31mConnection failed: ${err}\x1b[0m\r\n`);
      });

    return () => {
      destroyed = true;
      observer.disconnect();
      clearTimeout(resizeTimer);
      unlistenOutput?.();
      unlistenExit?.();
      if (sessionIdRef.current) closeTerminal(sessionIdRef.current).catch(() => {});
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      sessionIdRef.current = null;
      initializedRef.current = false;
    };
  }, []);

  // When a hidden tab becomes visible again, only re-measure and repaint xterm.
  useEffect(() => {
    if (!visible) return;

    const timer = window.setTimeout(() => {
      requestAnimationFrame(fitVisibleTerminal);
    }, 50);

    return () => window.clearTimeout(timer);
  }, [visible]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ background: terminalThemes[theme]?.background ?? "#1d1f21" }}
    />
  );
}
