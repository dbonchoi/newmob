import { useEffect, useState } from "react";
import {
  Terminal as TerminalIcon,
  Monitor,
  Folder,
  Wifi,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  Clock,
  Play,
  Edit3,
  Copy,
  Trash2,
} from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useContextMenu } from "../ContextMenu";
import type { SessionConfig } from "../../lib/ipc";

interface SessionTreeProps {
  onConnectSession?: (session: SessionConfig) => void;
  onEditSession?: (session: SessionConfig) => void;
}

export function SessionTree({ onConnectSession, onEditSession }: SessionTreeProps) {
  const {
    sessions,
    searchQuery,
    selectedSessionId,
    loadSessions,
    removeSession,
    addSession,
    updateSession,
    setSelectedSession,
    loading,
  } = useSessionStore();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const ctx = useContextMenu();

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const filteredSessions = filterSessions(sessions, searchQuery);
  const grouped = groupByPath(filteredSessions);
  const recentSessions = [...filteredSessions]
    .filter((s) => s.last_connected_at)
    .sort((a, b) => (b.last_connected_at ?? 0) - (a.last_connected_at ?? 0))
    .slice(0, 5);

  const toggle = (key: string) =>
    setExpanded((e) => ({ ...e, [key]: !e[key] }));

  const moveSessionToGroup = (sessionId: string, groupPath: string | null) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    void updateSession({
      ...session,
      group_path: groupPath,
      updated_at: Math.floor(Date.now() / 1000),
    });
  };

  const handleDrop = (event: React.DragEvent, groupPath: string | null) => {
    event.preventDefault();
    const sessionId = event.dataTransfer.getData("application/x-newmob-session");
    setDragOverGroup(null);
    if (sessionId) moveSessionToGroup(sessionId, groupPath);
  };

  const sessionContextMenu = (e: React.MouseEvent, s: SessionConfig) => {
    setSelectedSession(s.id);
    ctx.show(e, [
      { label: "Connect", icon: <Play className="w-3 h-3" />, onClick: () => onConnectSession?.(s) },
      { label: "Edit…", icon: <Edit3 className="w-3 h-3" />, onClick: () => onEditSession?.(s) },
      { label: "Duplicate", icon: <Copy className="w-3 h-3" />, onClick: () => {
        const dup = { ...s, id: crypto.randomUUID(), name: s.name + " (copy)", created_at: Math.floor(Date.now() / 1000), updated_at: Math.floor(Date.now() / 1000) };
        addSession(dup);
      }},
      { label: "", separator: true, onClick: () => {} },
      { label: "Delete", icon: <Trash2 className="w-3 h-3" />, danger: true, onClick: () => removeSession(s.id) },
    ]);
  };

  return (
    <div className="flex-1 moba-scroll-y text-[12px]">
      {ctx.render}
      <TreeFolder
        icon={<FolderOpen className="w-3.5 h-3.5 text-amber-600" />}
        label="User sessions"
        count={filteredSessions.length}
        open={expanded["root"] !== false}
        onToggle={() => toggle("root")}
        onDrop={(event) => handleDrop(event, null)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOverGroup("__root__");
        }}
        onDragLeave={() => setDragOverGroup(null)}
        dragOver={dragOverGroup === "__root__"}
      >
        {Object.entries(grouped).map(([group, items]) =>
          group === "__ungrouped__" ? (
            items.map((s) => (
              <SessionItem
                key={s.id}
                session={s}
                selected={selectedSessionId === s.id}
                onClick={() => setSelectedSession(s.id)}
                onDoubleClick={() => onConnectSession?.(s)}
                onContextMenu={(e) => sessionContextMenu(e, s)}
              />
            ))
          ) : (
            <TreeFolder
              key={group}
              icon={
                expanded[group] ? (
                  <FolderOpen className="w-3.5 h-3.5 text-amber-600" />
                ) : (
                  <Folder className="w-3.5 h-3.5 text-amber-600" />
                )
              }
              label={group}
              count={items.length}
              open={!!expanded[group]}
              onToggle={() => toggle(group)}
              onDrop={(event) => handleDrop(event, group)}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOverGroup(group);
              }}
              onDragLeave={() => setDragOverGroup(null)}
              dragOver={dragOverGroup === group}
            >
              {items.map((s) => (
                <SessionItem
                  key={s.id}
                  session={s}
                  selected={selectedSessionId === s.id}
                  onClick={() => setSelectedSession(s.id)}
                  onDoubleClick={() => onConnectSession?.(s)}
                  onContextMenu={(e) => sessionContextMenu(e, s)}
                />
              ))}
            </TreeFolder>
          ),
        )}
        {filteredSessions.length === 0 && !loading && (
          <div className="pl-6 py-2 text-[11px] text-[var(--moba-text-muted)]">
            {searchQuery ? "No matching sessions." : "No sessions yet. Click + to create one."}
          </div>
        )}
      </TreeFolder>

      {recentSessions.length > 0 && (
        <>
          <div className="px-2 mt-3 mb-1 text-[11px] uppercase tracking-wide text-[var(--moba-text-muted)]">
            Recent
          </div>
          {recentSessions.map((s) => (
            <div
              key={`recent-${s.id}`}
              className="flex items-center gap-1 px-1 py-0.5 cursor-pointer hover:bg-[var(--moba-hover)]"
              onDoubleClick={() => onConnectSession?.(s)}
              onClick={() => setSelectedSession(s.id)}
            >
              <span className="w-3" />
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span className="flex-1 truncate">{s.name}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function TreeFolder({
  icon,
  label,
  count,
  open,
  onToggle,
  children,
  onDrop,
  onDragOver,
  onDragLeave,
  dragOver,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
  onDrop?: (event: React.DragEvent) => void;
  onDragOver?: (event: React.DragEvent) => void;
  onDragLeave?: () => void;
  dragOver?: boolean;
}) {
  return (
    <div>
      <div
        className="flex items-center gap-1 px-1 py-0.5 cursor-pointer hover:bg-[var(--moba-hover)]"
        data-drag-over={dragOver}
        style={dragOver ? { background: "var(--moba-selected)" } : undefined}
        onClick={onToggle}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-slate-500" />
        ) : (
          <ChevronRight className="w-3 h-3 text-slate-500" />
        )}
        {icon}
        <span className="flex-1 font-medium">{label}</span>
        {count !== undefined && (
          <span className="text-[10px] text-slate-500">({count})</span>
        )}
      </div>
      {open && <div className="pl-4">{children}</div>}
    </div>
  );
}

function SessionItem({
  session,
  selected,
  onClick,
  onDoubleClick,
  onContextMenu,
}: {
  session: SessionConfig;
  selected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const icon = sessionIcon(session.session_type);

  return (
    <div
      className="flex items-center gap-1 px-1 py-0.5 cursor-pointer hover:bg-[var(--moba-hover)] group"
      data-selected={selected}
      style={selected ? { background: "var(--moba-selected)" } : undefined}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-newmob-session", session.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <span className="w-3" />
      {icon}
      <span className="flex-1 truncate">
        {session.name}
        {session.username && session.host && (
          <span className="text-[var(--moba-text-muted)]">
            {" "}({session.username}@{session.host})
          </span>
        )}
      </span>
      <span
        className="text-[10px] px-1 rounded"
        style={{ background: "#e1ecfa", color: "#1e3a5f" }}
      >
        {session.session_type}
      </span>
    </div>
  );
}

function sessionIcon(type: string) {
  switch (type) {
    case "SSH":
      return <TerminalIcon className="w-3.5 h-3.5" style={{ color: "#2b5d8b" }} />;
    case "RDP":
      return <Monitor className="w-3.5 h-3.5" style={{ color: "#a04b9c" }} />;
    case "VNC":
      return <Monitor className="w-3.5 h-3.5" style={{ color: "#c97a23" }} />;
    case "SFTP":
    case "FTP":
      return <Folder className="w-3.5 h-3.5" style={{ color: "#3b7ac2" }} />;
    case "Serial":
      return <Wifi className="w-3.5 h-3.5" style={{ color: "#236a98" }} />;
    case "LocalShell":
      return <TerminalIcon className="w-3.5 h-3.5" style={{ color: "#62d36f" }} />;
    default:
      return <TerminalIcon className="w-3.5 h-3.5" style={{ color: "#2b5d8b" }} />;
  }
}

function groupByPath(sessions: SessionConfig[]): Record<string, SessionConfig[]> {
  const result: Record<string, SessionConfig[]> = {};
  for (const s of sessions) {
    const key = s.group_path ?? "__ungrouped__";
    if (!result[key]) result[key] = [];
    result[key].push(s);
  }
  return result;
}

function filterSessions(sessions: SessionConfig[], query: string): SessionConfig[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter((session) => {
    const haystack = [
      session.name,
      session.session_type,
      session.group_path ?? "",
      session.host,
      session.username ?? "",
    ].join(" ").toLowerCase();
    return haystack.includes(q);
  });
}
