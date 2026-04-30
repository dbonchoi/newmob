import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Terminal, type IBufferLine } from "@xterm/xterm";
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
import { useAppStore } from "../../stores/appStore";
import { useContextMenu, type MenuItem } from "../ContextMenu";
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
  tabId?: string;
  tabTitle?: string;
  theme?: string;
  ssh?: SshConnectInfo;
  visible?: boolean;
}

const DEFAULT_FONT_SIZE = 14;
const FONT_OPTIONS = [
  { label: "Consolas", css: "'Consolas', 'Menlo', 'DejaVu Sans Mono', monospace" },
  { label: "JetBrains Mono", css: "'JetBrains Mono', 'Consolas', 'Menlo', monospace" },
  { label: "Cascadia Code", css: "'Cascadia Code', 'Consolas', 'Menlo', monospace" },
];

interface SearchMatch {
  row: number;
  col: number;
  length: number;
}

export function TerminalPanel({
  tabId,
  tabTitle = "Terminal",
  theme = "classic",
  ssh,
  visible = true,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const readOnlyRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const fallbackSearchRef = useRef<{ query: string; index: number }>({ query: "", index: -1 });
  const contextMenu = useContextMenu();
  const setStatusMessage = useAppStore((s) => s.setStatusMessage);
  const updateTabTitle = useAppStore((s) => s.updateTabTitle);

  const [fontFamily, setFontFamily] = useState(FONT_OPTIONS[0].css);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [fontLigatures, setFontLigatures] = useState(false);
  const [showScrollbar, setShowScrollbar] = useState(true);
  const [readOnly, setReadOnly] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [viewportVersion, setViewportVersion] = useState(0);

  const fitVisibleTerminal = useCallback(() => {
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
  }, []);

  const focusTerminal = useCallback(() => {
    termRef.current?.focus();
  }, []);

  const writeInput = useCallback((data: string) => {
    const sid = sessionIdRef.current;
    if (!sid || readOnlyRef.current) return;
    writeTerminal(sid, encodeBase64(data)).catch(console.error);
  }, []);

  const writeBinaryInput = useCallback((data: string) => {
    const sid = sessionIdRef.current;
    if (!sid || readOnlyRef.current) return;
    writeTerminal(sid, encodeBinaryStringBase64(data)).catch(console.error);
  }, []);

  const writeClipboardText = useCallback(async (text: string, successMessage: string) => {
    if (!text) {
      setStatusMessage("Nothing to copy");
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        fallbackCopyText(text);
      }
      setStatusMessage(successMessage);
    } catch (err) {
      if (fallbackCopyText(text)) {
        setStatusMessage(successMessage);
      } else {
        setStatusMessage(err instanceof Error ? err.message : "Clipboard copy failed");
      }
    }
  }, [setStatusMessage]);

  const copySelection = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    void writeClipboardText(term.getSelection(), "Copied selection");
    focusTerminal();
  }, [focusTerminal, writeClipboardText]);

  const copyAll = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    void writeClipboardText(getBufferText(term), "Copied terminal buffer");
    focusTerminal();
  }, [focusTerminal, writeClipboardText]);

  const pasteFromClipboard = useCallback(async () => {
    if (readOnlyRef.current) {
      setStatusMessage("Terminal is read-only");
      return;
    }

    try {
      const text = navigator.clipboard?.readText
        ? await navigator.clipboard.readText()
        : window.prompt("Paste text") ?? "";
      if (!text) return;
      writeInput(normalizePasteText(text));
      focusTerminal();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Clipboard paste failed");
    }
  }, [focusTerminal, setStatusMessage, writeInput]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setSearchStatus("");
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchStatus("");
    setSearchMatches([]);
    setActiveSearchIndex(-1);
    searchAddonRef.current?.clearDecorations();
    termRef.current?.clearSelection();
    focusTerminal();
  }, [focusTerminal]);

  const runSearch = useCallback((direction: "next" | "previous" = "next") => {
    const terminal = termRef.current;
    const term = (searchInputRef.current?.value ?? searchValue).trim();
    if (!terminal || !term) {
      searchAddonRef.current?.clearDecorations();
      setSearchMatches([]);
      setActiveSearchIndex(-1);
      setSearchStatus("");
      return;
    }

    searchAddonRef.current?.clearDecorations();
    const result = findAndSelectBufferText(
      terminal,
      term,
      direction,
      fallbackSearchRef,
    );
    if (result) {
      setSearchMatches(result.matches);
      setActiveSearchIndex(result.index);
      setSearchStatus(`Match ${result.index + 1}/${result.total}`);
    } else {
      setSearchMatches([]);
      setActiveSearchIndex(-1);
      setSearchStatus("No matches");
    }
  }, [searchValue]);

  const renameTerminal = useCallback(() => {
    if (!tabId) return;
    const nextTitle = window.prompt("Set terminal title", tabTitle);
    if (!nextTitle?.trim()) return;
    updateTabTitle(tabId, nextTitle.trim());
    focusTerminal();
  }, [focusTerminal, tabId, tabTitle, updateTabTitle]);

  const resetOutput = useCallback(() => {
    termRef.current?.reset();
    fitVisibleTerminal();
    focusTerminal();
  }, [fitVisibleTerminal, focusTerminal]);

  const clearScrollback = useCallback(() => {
    termRef.current?.clear();
    focusTerminal();
  }, [focusTerminal]);

  const increaseFontSize = useCallback(() => {
    setFontSize((size) => Math.min(size + 1, 32));
  }, []);

  const decreaseFontSize = useCallback(() => {
    setFontSize((size) => Math.max(size - 1, 8));
  }, []);

  const resetFontSize = useCallback(() => {
    setFontSize(DEFAULT_FONT_SIZE);
  }, []);

  const handleShortcutKey = useCallback((event: KeyboardEvent): boolean => {
    if (event.key === "F11") {
      event.preventDefault();
      setFullscreen((v) => !v);
      return false;
    }
    if (event.shiftKey && event.key === "Insert") {
      event.preventDefault();
      void pasteFromClipboard();
      return false;
    }
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      openSearch();
      return false;
    }
    if (event.ctrlKey && (event.key === "+" || event.key === "=")) {
      event.preventDefault();
      increaseFontSize();
      return false;
    }
    if (event.ctrlKey && (event.key === "-" || event.key === "_")) {
      event.preventDefault();
      decreaseFontSize();
      return false;
    }
    if (event.ctrlKey && event.key === "0") {
      event.preventDefault();
      resetFontSize();
      return false;
    }
    if (searchOpen && event.key === "Escape") {
      event.preventDefault();
      closeSearch();
      return false;
    }
    return true;
  }, [
    closeSearch,
    decreaseFontSize,
    increaseFontSize,
    openSearch,
    pasteFromClipboard,
    resetFontSize,
    searchOpen,
  ]);

  const buildContextMenu = useCallback((): MenuItem[] => {
    const hasSelection = termRef.current?.hasSelection() ?? false;

    return [
      { label: "Copy", onClick: copySelection, disabled: !hasSelection },
      { label: "Copy All", onClick: copyAll },
      { label: "Copy formatted text (RTF)", disabled: true },
      { label: "Paste", shortcut: "Shift+Insert", onClick: () => void pasteFromClipboard(), disabled: readOnly },
      { label: "Find", shortcut: "Ctrl+Shift+F", onClick: openSearch },
      { label: "", separator: true },
      {
        label: "Font settings",
        children: [
          ...FONT_OPTIONS.map((font) => ({
            label: `Use font "${font.label}"`,
            checked: fontFamily === font.css,
            onClick: () => setFontFamily(font.css),
          })),
          { label: "Display font ligatures", checked: fontLigatures, onClick: () => setFontLigatures((v) => !v) },
          { label: "", separator: true },
          { label: "Increase font size", shortcut: "Ctrl++ / Ctrl+WheelUp", onClick: increaseFontSize },
          { label: "Decrease font size", shortcut: "Ctrl+- / Ctrl+WheelDown", onClick: decreaseFontSize },
          { label: "Reset font size to default", shortcut: "Ctrl+0", onClick: resetFontSize },
        ],
      },
      {
        label: "Terminal display",
        children: [
          { label: "Reset terminal output", onClick: resetOutput },
          { label: "Clear terminal scrollback", onClick: clearScrollback },
          { label: "Set terminal title", onClick: renameTerminal, disabled: !tabId },
          { label: "Toggle terminal scrollbar", checked: showScrollbar, onClick: () => setShowScrollbar((v) => !v) },
          { label: "Fullscreen terminal", shortcut: "F11", checked: fullscreen, onClick: () => setFullscreen((v) => !v) },
          { label: "Read-only terminal", checked: readOnly, onClick: () => setReadOnly((v) => !v) },
        ],
      },
      {
        label: "Syntax highlighting",
        children: [
          { label: "Default", checked: true },
          { label: "Error/Warning/Success keywords", disabled: true },
          { label: "Unix shell script", disabled: true },
          { label: "Cisco (network configuration)", disabled: true },
          { label: "Perl syntax", disabled: true },
          { label: "SQL syntax", disabled: true },
        ],
      },
      { label: "", separator: true },
      { label: "Execute macro", shortcut: "Ctrl+Space", disabled: true },
      { label: "Record new macro", disabled: true },
      { label: "Record terminal output to file", disabled: true },
      { label: "Save to file", shortcut: "Ctrl+Shift+S", disabled: true },
      { label: "Print", shortcut: "Ctrl+Shift+P", disabled: true },
      { label: "", separator: true },
      { label: "Receive file using Z-modem", disabled: true },
      { label: "Send file using Z-modem", disabled: true },
      { label: "", separator: true },
      { label: "Change current terminal settings...", disabled: true },
      {
        label: "Special Command",
        children: [
          { label: "Break", disabled: true },
          { label: "SIGINT (Interrupt)", onClick: () => writeInput("\x03") },
          { label: "SIGTERM (Terminate)", disabled: true },
          { label: "SIGKILL (Kill)", disabled: true },
          { label: "SIGQUIT (Quit)", onClick: () => writeInput("\x1c") },
          { label: "SIGHUP (Hangup)", disabled: true },
          { label: "More signals", disabled: true },
          { label: "", separator: true },
          { label: "IGNORE message", disabled: true },
        ],
      },
      { label: "Event Log", disabled: true },
    ];
  }, [
    clearScrollback,
    copyAll,
    copySelection,
    decreaseFontSize,
    fontFamily,
    fontLigatures,
    fullscreen,
    increaseFontSize,
    openSearch,
    pasteFromClipboard,
    readOnly,
    renameTerminal,
    resetFontSize,
    resetOutput,
    showScrollbar,
    tabId,
    writeInput,
  ]);

  useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);

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
      fontFamily,
      fontSize,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 10000,
    });
    termRef.current = term;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);

    const searchAddon = new SearchAddon();
    searchAddonRef.current = searchAddon;
    term.loadAddon(searchAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(el);

    try {
      term.loadAddon(new WebglAddon());
    } catch { /* WebGL not available */ }

    fitVisibleTerminal();

    term.onData(writeInput);
    term.onBinary(writeBinaryInput);
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      return handleShortcutKey(event);
    });
    const scrollDisposable = term.onScroll(() => setViewportVersion((v) => v + 1));
    const renderDisposable = term.onRender(() => setViewportVersion((v) => v + 1));
    const resizeDisposable = term.onResize(() => setViewportVersion((v) => v + 1));

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
      scrollDisposable.dispose();
      renderDisposable.dispose();
      resizeDisposable.dispose();
      clearTimeout(resizeTimer);
      unlistenOutput?.();
      unlistenExit?.();
      if (sessionIdRef.current) closeTerminal(sessionIdRef.current).catch(() => {});
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
      sessionIdRef.current = null;
      initializedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    term.options = {
      fontFamily,
      fontSize,
      theme: terminalThemes[theme] ?? terminalThemes.classic,
    };
    window.setTimeout(() => requestAnimationFrame(fitVisibleTerminal), 0);
  }, [fitVisibleTerminal, fontFamily, fontSize, theme]);

  // When a hidden tab becomes visible again, only re-measure and repaint xterm.
  useEffect(() => {
    if (!visible) return;

    const timer = window.setTimeout(() => {
      requestAnimationFrame(fitVisibleTerminal);
    }, 50);

    return () => window.clearTimeout(timer);
  }, [fitVisibleTerminal, fullscreen, showScrollbar, visible]);

  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      handleShortcutKey(event);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleShortcutKey, visible]);

  useEffect(() => {
    if (!visible) return;

    const el = panelRef.current;
    if (!el) return;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.deltaY < 0) {
        increaseFontSize();
      } else if (event.deltaY > 0) {
        decreaseFontSize();
      }
    };

    el.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => el.removeEventListener("wheel", handleWheel, { capture: true });
  }, [decreaseFontSize, increaseFontSize, visible]);

  useEffect(() => {
    if (!searchOpen) return;

    const frame = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });

    return () => cancelAnimationFrame(frame);
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    if (!searchValue.trim()) {
      searchAddonRef.current?.clearDecorations();
      setSearchMatches([]);
      setActiveSearchIndex(-1);
      termRef.current?.clearSelection();
      setSearchStatus("");
      return;
    }

    const timer = window.setTimeout(() => runSearch("next"), 120);
    return () => window.clearTimeout(timer);
  }, [runSearch, searchOpen, searchValue]);

  const searchHighlights = useMemo(
    () => getVisibleSearchHighlights(
      termRef.current,
      panelRef.current,
      containerRef.current,
      searchMatches,
      activeSearchIndex,
    ),
    [activeSearchIndex, fontSize, fullscreen, searchMatches, showScrollbar, viewportVersion],
  );

  const panelClasses = [
    "relative w-full h-full",
    fullscreen ? "fixed inset-0 z-[9000]" : "",
    showScrollbar ? "" : "terminal-hide-scrollbar",
    fontLigatures ? "terminal-font-ligatures" : "terminal-no-font-ligatures",
  ].filter(Boolean).join(" ");

  return (
    <div
      ref={panelRef}
      className={panelClasses}
      style={{ background: terminalThemes[theme]?.background ?? "#1d1f21" }}
      onWheel={(event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        if (event.deltaY < 0) {
          increaseFontSize();
        } else if (event.deltaY > 0) {
          decreaseFontSize();
        }
      }}
      onContextMenu={(event) => contextMenu.show(event, buildContextMenu())}
    >
      <div ref={containerRef} className="w-full h-full" />

      {searchHighlights.length > 0 && (
        <div className="absolute inset-0 z-30 pointer-events-none">
          {searchHighlights.map((highlight) => (
            <div
              key={`${highlight.row}-${highlight.col}-${highlight.active ? "active" : "match"}`}
              className={highlight.active ? "terminal-search-hit terminal-search-hit-active" : "terminal-search-hit"}
              style={{
                left: highlight.left,
                top: highlight.top,
                width: highlight.width,
                height: highlight.height,
              }}
            />
          ))}
        </div>
      )}

      {readOnly && (
        <div className="absolute right-3 bottom-3 z-40 px-2 py-1 rounded border bg-white/90 text-[11px] text-slate-700 shadow-sm pointer-events-none">
          Read-only
        </div>
      )}

      {searchOpen && (
        <div
          className="absolute right-3 top-3 z-50 flex items-center gap-1 rounded border border-slate-400 bg-white p-1 shadow-lg text-[12px]"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
        >
          <input
            ref={searchInputRef}
            className="moba-input h-7 w-56"
            value={searchValue}
            placeholder="Find"
            onChange={(event) => {
              const next = event.target.value;
              setSearchValue(next);
              fallbackSearchRef.current = { query: next.trim(), index: -1 };
              setSearchStatus("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeSearch();
              } else if (event.key === "Enter") {
                event.preventDefault();
                runSearch(event.shiftKey ? "previous" : "next");
              }
            }}
          />
          <button className="moba-btn h-7 px-2" type="button" onClick={() => runSearch("previous")}>
            Prev
          </button>
          <button className="moba-btn h-7 px-2" type="button" onClick={() => runSearch("next")}>
            Next
          </button>
          <button className="moba-btn h-7 px-2" type="button" onClick={closeSearch}>
            Close
          </button>
          {searchStatus && <span className="px-1 text-[11px] text-[#b22222]">{searchStatus}</span>}
        </div>
      )}

      {contextMenu.render}
    </div>
  );
}

function getBufferText(term: Terminal): string {
  const buffer = term.buffer.active;
  const lines: string[] = [];

  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (!line) continue;

    const text = line.translateToString(true);
    if (line.isWrapped && lines.length > 0) {
      lines[lines.length - 1] += text;
    } else {
      lines.push(text);
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}

function findAndSelectBufferText(
  term: Terminal,
  query: string,
  direction: "next" | "previous",
  searchRef: MutableRefObject<{ query: string; index: number }>,
): { index: number; total: number; matches: SearchMatch[] } | null {
  const matches = collectBufferMatches(term, query);
  if (matches.length === 0) {
    return null;
  }

  const sameQuery = searchRef.current.query === query;
  let nextIndex = sameQuery ? searchRef.current.index : -1;

  if (nextIndex < 0) {
    nextIndex = firstVisibleMatchIndex(term, matches, direction);
  } else {
    nextIndex = direction === "next"
      ? (nextIndex + 1) % matches.length
      : (nextIndex - 1 + matches.length) % matches.length;
  }

  const match = matches[nextIndex];
  term.scrollToLine(Math.max(0, match.row - Math.floor(term.rows / 2)));
  term.select(match.col, match.row, match.length);
  term.refresh(0, term.rows - 1);
  searchRef.current = { query, index: nextIndex };
  return { index: nextIndex, total: matches.length, matches };
}

function collectBufferMatches(term: Terminal, query: string): SearchMatch[] {
  const buffer = term.buffer.active;
  const matches: SearchMatch[] = [];
  const needle = query.toLocaleLowerCase();

  for (let row = 0; row < buffer.length; row++) {
    const line = buffer.getLine(row);
    if (!line) continue;

    const { text, stringIndexToCell } = lineToSearchText(line);
    const haystack = text.toLocaleLowerCase();
    let stringIndex = haystack.indexOf(needle);
    while (stringIndex !== -1) {
      const startCell = stringIndexToCell[stringIndex];
      const lastCell = stringIndexToCell[stringIndex + Math.max(needle.length - 1, 0)];
      if (typeof startCell === "number" && typeof lastCell === "number") {
        const lastWidth = line.getCell(lastCell)?.getWidth() || 1;
        matches.push({
          row,
          col: startCell,
          length: Math.max(1, lastCell + lastWidth - startCell),
        });
      }
      stringIndex = haystack.indexOf(needle, stringIndex + Math.max(needle.length, 1));
    }
  }

  return matches;
}

function lineToSearchText(line: IBufferLine): { text: string; stringIndexToCell: number[] } {
  let text = "";
  const stringIndexToCell: number[] = [];

  for (let cellIndex = 0; cellIndex < line.length; cellIndex++) {
    const cell = line.getCell(cellIndex);
    if (!cell || cell.getWidth() === 0) continue;

    const chars = cell.getChars() || " ";
    for (let offset = 0; offset < chars.length; offset++) {
      stringIndexToCell[text.length + offset] = cellIndex;
    }
    text += chars;
  }

  const trimmedLength = text.trimEnd().length;
  return {
    text: text.slice(0, trimmedLength),
    stringIndexToCell: stringIndexToCell.slice(0, trimmedLength),
  };
}

function getVisibleSearchHighlights(
  term: Terminal | null,
  panel: HTMLDivElement | null,
  container: HTMLDivElement | null,
  matches: SearchMatch[],
  activeIndex: number,
) {
  if (!term || !panel || !container || matches.length === 0) return [];

  const screen = container.querySelector<HTMLElement>(".xterm-screen");
  if (!screen) return [];

  const screenRect = screen.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  if (screenRect.width === 0 || screenRect.height === 0 || term.cols === 0 || term.rows === 0) {
    return [];
  }

  const cellWidth = screenRect.width / term.cols;
  const cellHeight = screenRect.height / term.rows;
  const viewportTop = term.buffer.active.viewportY;
  const viewportBottom = viewportTop + term.rows - 1;
  const baseLeft = screenRect.left - panelRect.left;
  const baseTop = screenRect.top - panelRect.top;

  return matches
    .map((match, index) => ({ ...match, index }))
    .filter((match) => match.row >= viewportTop && match.row <= viewportBottom)
    .map((match) => ({
      row: match.row,
      col: match.col,
      active: match.index === activeIndex,
      left: baseLeft + match.col * cellWidth,
      top: baseTop + (match.row - viewportTop) * cellHeight,
      width: Math.max(cellWidth, match.length * cellWidth),
      height: cellHeight,
    }));
}

function firstVisibleMatchIndex(
  term: Terminal,
  matches: SearchMatch[],
  direction: "next" | "previous",
): number {
  const viewportTop = term.buffer.active.viewportY;
  const viewportBottom = viewportTop + term.rows - 1;

  if (direction === "next") {
    const visible = matches.findIndex((match) => match.row >= viewportTop);
    return visible === -1 ? 0 : visible;
  }

  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i].row <= viewportBottom) return i;
  }
  return matches.length - 1;
}

function normalizePasteText(text: string): string {
  return text.replace(/\r?\n/g, "\r");
}

function fallbackCopyText(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

function encodeBinaryStringBase64(str: string): string {
  let binary = "";
  for (let i = 0; i < str.length; i++) {
    binary += String.fromCharCode(str.charCodeAt(i) & 0xff);
  }
  return btoa(binary);
}
