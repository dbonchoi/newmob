import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Home, RefreshCw } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import type { SessionConfig } from "../../lib/ipc";

interface QuickConnectProps {
  onConnectInput: (value: string) => void;
  onConnectSession: (session: SessionConfig) => void;
  onHome?: () => void;
}

export function QuickConnect({ onConnectInput, onConnectSession, onHome }: QuickConnectProps) {
  const [value, setValue] = useState("");
  const { sessions, loadSessions } = useSessionStore();

  const recent = useMemo(
    () =>
      sessions
        .filter((session) => session.last_connected_at)
        .sort((a, b) => (b.last_connected_at ?? 0) - (a.last_connected_at ?? 0))
        .slice(0, 3),
    [sessions],
  );

  const submit = () => {
    const next = value.trim();
    if (!next) return;
    onConnectInput(next);
    setValue("");
  };

  return (
    <div
      className="h-7 flex items-center gap-1 px-2 text-[12px]"
      style={{
        background: "#eef3f9",
        borderBottom: "1px solid var(--moba-divider)",
      }}
    >
      <button className="p-0.5 hover:bg-white/70 rounded" title="Back" onClick={() => window.history.back()} type="button">
        <ArrowLeft className="w-3.5 h-3.5" />
      </button>
      <button className="p-0.5 hover:bg-white/70 rounded" title="Forward" onClick={() => window.history.forward()} type="button">
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
      <button className="p-0.5 hover:bg-white/70 rounded" title="Home" onClick={onHome} type="button">
        <Home className="w-3.5 h-3.5" />
      </button>
      <span className="moba-divider-v h-4 mx-1" />
      <span className="text-[var(--moba-text-muted)]">Quick connect:</span>
      <input
        className="moba-input flex-1 max-w-md"
        placeholder="ssh user@host  •  rdp://host  •  telnet host  •  paste session URL…"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
        }}
      />
      <button className="moba-btn" onClick={submit} type="button">Go</button>
      <span className="moba-divider-v h-4 mx-2" />
      <span className="text-[var(--moba-text-muted)]">Recent:</span>
      {recent.length === 0 ? (
        <span className="text-[var(--moba-text-muted)]">none</span>
      ) : (
        recent.map((session) => (
          <button
            key={session.id}
            className="px-1.5 py-0.5 rounded hover:bg-white/70 underline max-w-[110px] truncate"
            style={{ color: "var(--moba-link)" }}
            onClick={() => onConnectSession(session)}
            title={`${session.name} (${session.session_type})`}
            type="button"
          >
            {session.name}
          </button>
        ))
      )}
      <button className="p-0.5 hover:bg-white/70 rounded" title="Refresh sessions" onClick={() => void loadSessions()} type="button">
        <RefreshCw className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
