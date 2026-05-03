import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { FilePanel } from "./FilePanel";
import { useSftpStore, type PaneState } from "../../stores/sftpStore";
import { useSftpController } from "../../lib/sftpController";
import type { FileEntry } from "../../lib/sftp";

const sftpHomeMock = vi.hoisted(() => vi.fn(async () => ""));
const sftpDownloadMock = vi.hoisted(() => vi.fn(async () => undefined));
const sftpDownloadDirMock = vi.hoisted(() => vi.fn(async () => undefined));
const setStatusMock = vi.hoisted(() => vi.fn());

vi.mock("../../lib/sftp", async () => {
  const actual = await vi.importActual<typeof import("../../lib/sftp")>(
    "../../lib/sftp",
  );
  return {
    ...actual,
    sftpListRemote: vi.fn(async () => []),
    sftpListLocal: vi.fn(async () => []),
    sftpLocalHome: sftpHomeMock,
    sftpLocalDrives: vi.fn(async () => []),
    sftpAttach: vi.fn(async () => undefined),
    sftpDetach: vi.fn(async () => undefined),
    sftpRealpath: vi.fn(async (_sid: string, p: string) => p),
    sftpDownload: sftpDownloadMock,
    sftpDownloadDir: sftpDownloadDirMock,
    // Stub event subscriptions — they hit Tauri internals which aren't
    // available in the JSDOM test environment.
    listenSftpProgress: vi.fn(async () => () => undefined),
    listenSftpComplete: vi.fn(async () => () => undefined),
    listenSftpPaused: vi.fn(async () => () => undefined),
    listenSftpAttached: vi.fn(async () => () => undefined),
  };
});

vi.mock("../../stores/transferStore", async () => {
  const actual = await vi.importActual<typeof import("../../stores/transferStore")>(
    "../../stores/transferStore",
  );
  return {
    ...actual,
    newTransferId: () => "test-transfer-id",
  };
});

vi.mock("../../stores/appStore", async () => {
  const actual = await vi.importActual<typeof import("../../stores/appStore")>(
    "../../stores/appStore",
  );
  return {
    ...actual,
    useAppStore: Object.assign(
      (selector: (s: { setStatusMessage: typeof setStatusMock }) => unknown) =>
        selector({ setStatusMessage: setStatusMock }),
      actual.useAppStore,
    ),
  };
});

const SESSION_ID = "polish-session";

function makePane(overrides: Partial<PaneState> = {}): PaneState {
  return {
    path: "/work",
    entries: [],
    selection: [],
    loading: false,
    error: null,
    history: ["/work"],
    historyIndex: 0,
    showHidden: false,
    ...overrides,
  };
}

function seed() {
  useSftpStore.setState((state) => ({
    sessions: {
      ...state.sessions,
      [SESSION_ID]: {
        sessionId: SESSION_ID,
        attached: true,
        attaching: false,
        homeDir: "/home/test",
        error: null,
        local: makePane(),
        remote: makePane(),
      },
    },
  }));
}

beforeEach(() => {
  localStorage.clear();
  useSftpStore.setState({ sessions: {} });
  setStatusMock.mockReset();
  sftpHomeMock.mockReset();
  sftpDownloadMock.mockReset();
  sftpDownloadDirMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SFTP file-list column width persistence", () => {
  it("persists per-side widths to localStorage and reloads them", async () => {
    seed();

    // Render the LOCAL pane and shrink the Size column via the resize
    // handle on the Name header (it controls the *next* column).
    const { unmount } = render(
      <FilePanel
        sessionId={SESSION_ID}
        side="local"
        onItemDoubleClick={vi.fn()}
        onEmptyContext={vi.fn(() => [])}
      />,
    );

    const nameHandle = document.querySelector(
      '[data-testid="col-resize-name"]',
    ) as HTMLElement;
    expect(nameHandle).toBeTruthy();

    fireEvent.mouseDown(nameHandle, { clientX: 200 });
    fireEvent(window, new MouseEvent("mousemove", { clientX: 250 }));
    fireEvent(window, new MouseEvent("mouseup"));

    const stored = JSON.parse(
      localStorage.getItem("newmob.sftp.cols.local") ?? "{}",
    );
    expect(stored.size).toBeGreaterThan(80);

    // The remote pane key must remain untouched (per-side independence).
    expect(localStorage.getItem("newmob.sftp.cols.remote")).toBeNull();

    unmount();

    // Re-mount and confirm the previously-stored width is restored.
    render(
      <FilePanel
        sessionId={SESSION_ID}
        side="local"
        onItemDoubleClick={vi.fn()}
        onEmptyContext={vi.fn(() => [])}
      />,
    );
    const reloaded = JSON.parse(
      localStorage.getItem("newmob.sftp.cols.local") ?? "{}",
    );
    expect(reloaded.size).toBe(stored.size);
  });

  it("double-clicking a resize handle restores the affected column to its default width", () => {
    seed();
    // Pre-seed a non-default width.
    localStorage.setItem(
      "newmob.sftp.cols.remote",
      JSON.stringify({ size: 240, mtime: 240, type: 240 }),
    );

    render(
      <FilePanel
        sessionId={SESSION_ID}
        side="remote"
        subtitle="u@h"
        onItemDoubleClick={vi.fn()}
        onEmptyContext={vi.fn(() => [])}
      />,
    );

    const nameHandle = document.querySelector(
      '[data-testid="col-resize-name"]',
    ) as HTMLElement;
    fireEvent.doubleClick(nameHandle);

    const stored = JSON.parse(
      localStorage.getItem("newmob.sftp.cols.remote") ?? "{}",
    );
    // Name handle resets the *next* column (Size). Default is 80.
    expect(stored.size).toBe(80);
    // Other columns are untouched.
    expect(stored.mtime).toBe(240);
    expect(stored.type).toBe(240);
  });
});

describe("Local Windows drives navigation", () => {
  it("navigates from a drive root to the virtual drives root via navigateUp", async () => {
    seed();
    // Put the local pane at C:\ so navigateUp should land on the
    // virtual drives root.
    useSftpStore.setState((state) => ({
      sessions: {
        ...state.sessions,
        [SESSION_ID]: {
          ...state.sessions[SESSION_ID],
          local: makePane({ path: "C:\\", history: ["C:\\"], historyIndex: 0 }),
        },
      },
    }));

    await act(async () => {
      await useSftpStore.getState().navigateUp(SESSION_ID, "local");
    });

    expect(useSftpStore.getState().sessions[SESSION_ID].local.path).toBe("\\\\");
  });
});

describe("sftpController.download empty-local-dir fallback", () => {
  function entry(): FileEntry {
    return {
      name: "remote.txt",
      path: "/srv/remote.txt",
      size: 10,
      mtime: 0,
      mode: 0o644,
      fileType: "file",
      isHidden: false,
    };
  }

  it("falls back to the local home when no destination directory is provided", async () => {
    sftpHomeMock.mockResolvedValue("/home/me");
    const { result } = renderHook(() => useSftpController(SESSION_ID));

    await act(async () => {
      await result.current.download(entry(), "");
    });

    expect(sftpHomeMock).toHaveBeenCalledTimes(1);
    expect(sftpDownloadMock).toHaveBeenCalledTimes(1);
    const [, , , localPath] = sftpDownloadMock.mock.calls[0];
    expect(localPath).toBe("/home/me/remote.txt");
    expect(setStatusMock).not.toHaveBeenCalledWith(
      expect.stringContaining("Download failed"),
    );
  });

  it("surfaces a clear status error if neither localDir nor home resolves", async () => {
    sftpHomeMock.mockRejectedValue(new Error("no home"));
    const { result } = renderHook(() => useSftpController(SESSION_ID));

    await act(async () => {
      await result.current.download(entry(), "");
    });

    expect(sftpDownloadMock).not.toHaveBeenCalled();
    expect(setStatusMock).toHaveBeenCalledWith(
      expect.stringContaining("Download failed"),
    );
  });
});
