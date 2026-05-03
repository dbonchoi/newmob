import { useEffect, useMemo, useState } from "react";
import {
  X,
  Save as SaveIcon,
  XCircle,
  Users,
  Monitor,
  Flame,
  Server,
  Link as LinkIcon,
  ArrowRight,
  ArrowLeft,
  Globe,
} from "lucide-react";
import type { TunnelConfig, TunnelKind } from "../../lib/tunnel";
import { defaultTunnel } from "../../lib/tunnel";
import type { SessionConfig } from "../../lib/ipc";

interface Props {
  initial?: TunnelConfig;
  sessions: SessionConfig[];
  onSave: (config: TunnelConfig) => Promise<void> | void;
  onCancel: () => void;
}

const KIND_OPTIONS: { id: TunnelKind; label: string; description: string }[] = [
  { id: "Local",   label: "Local port forwarding",  description: "Connection from local applications to remote server" },
  { id: "Remote",  label: "Remote port forwarding", description: "Connection from remote applications to a local server" },
  { id: "Dynamic", label: "Dynamic port forwarding (SOCKS proxy)", description: "Generic SOCKS5 proxy tunnelled over SSH" },
];

export function TunnelEditor({ initial, sessions, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<TunnelConfig>(() => initial ?? defaultTunnel("Local"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) setDraft(initial);
  }, [initial]);

  const sshSessionOptions = useMemo(
    () => sessions.filter((s) => s.session_type === "SSH" || s.session_type === "SFTP"),
    [sessions],
  );

  const update = <K extends keyof TunnelConfig>(key: K, value: TunnelConfig[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };
  const updateSsh = <K extends keyof TunnelConfig["ssh"]>(key: K, value: TunnelConfig["ssh"][K]) => {
    setDraft((prev) => ({ ...prev, ssh: { ...prev.ssh, [key]: value } }));
  };

  const pickSshSession = (id: string) => {
    if (id === "") {
      update("sshSessionId", null);
      return;
    }
    const session = sshSessionOptions.find((s) => s.id === id);
    if (!session) return;
    setDraft((prev) => ({
      ...prev,
      sshSessionId: id,
      ssh: {
        ...prev.ssh,
        host: session.host,
        port: session.port || 22,
        username: session.username ?? "",
        authMethod:
          typeof session.auth_method === "string"
            ? (session.auth_method as "Password" | "Agent")
            : "PrivateKey",
        authData:
          typeof session.auth_method === "object" && "PrivateKey" in session.auth_method
            ? session.auth_method.PrivateKey.key_path
            : prev.ssh.authData,
      },
    }));
  };

  const validate = (): string | null => {
    if (!draft.name.trim()) return "Tunnel name is required";
    if (!draft.ssh.host.trim()) return "SSH server host is required";
    if (!draft.ssh.username.trim()) return "SSH login is required";
    if (!Number.isFinite(draft.ssh.port) || draft.ssh.port <= 0) return "SSH port must be > 0";
    if (!Number.isFinite(draft.listenPort) || draft.listenPort <= 0)
      return draft.kind === "Remote" ? "Remote port must be > 0" : "Forwarded port must be > 0";
    if (draft.kind !== "Dynamic") {
      if (!draft.destHost.trim()) return "Remote server is required";
      if (!Number.isFinite(draft.destPort) || draft.destPort <= 0) return "Remote port must be > 0";
    }
    return null;
  };

  const handleSave = async () => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSave(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const isLocal = draft.kind === "Local";
  const isRemote = draft.kind === "Remote";
  const isDynamic = draft.kind === "Dynamic";

  // Mode-specific labels (mirrors MobaSSHTunnel diagram)
  const forwardedLabel = isRemote ? "Local port" : "Forwarded port";
  const destLabel = isRemote ? "Bind address" : "Remote server";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(20,30,45,0.45)" }}>
      <div
        className="w-[940px] max-w-[96%] max-h-[92vh] flex flex-col rounded-[6px] shadow-2xl border overflow-hidden"
        style={{ background: "var(--moba-panel-bg)", borderColor: "var(--moba-chrome-border)", color: "var(--moba-text)" }}
      >
        {/* Title bar */}
        <div
          className="h-7 flex items-center px-2 rounded-t-[5px] shrink-0"
          style={{ background: "linear-gradient(to bottom,#5895c8,#2b5d8b)", color: "white" }}
        >
          <LinkIcon className="w-3.5 h-3.5 mr-1.5" />
          <div className="text-[12px] font-semibold">{initial ? "Edit SSH tunnel" : "New SSH tunnel"}</div>
          <button
            title="Close"
            className="ml-auto hover:bg-red-500 rounded p-0.5"
            onClick={onCancel}
            type="button"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Mode picker */}
        <div className="px-4 py-3 border-b shrink-0 grid grid-cols-3 gap-3" style={{ borderColor: "var(--moba-divider)" }}>
          {KIND_OPTIONS.map((opt) => (
            <label
              key={opt.id}
              className="flex items-start gap-2 cursor-pointer p-2 rounded border"
              style={{
                borderColor: draft.kind === opt.id ? "var(--moba-accent)" : "var(--moba-divider)",
                background: draft.kind === opt.id ? "var(--moba-selected)" : "transparent",
              }}
            >
              <input
                type="radio"
                className="moba-radio mt-0.5"
                checked={draft.kind === opt.id}
                onChange={() => update("kind", opt.id)}
              />
              <div className="text-[12px] leading-tight">
                <div className="font-semibold" style={{ color: draft.kind === opt.id ? "var(--moba-accent)" : "var(--moba-text)" }}>
                  {opt.label}
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: "var(--moba-text-muted)" }}>
                  {opt.description}
                </div>
              </div>
            </label>
          ))}
        </div>

        {/* Diagram */}
        <div
          className="flex-1 min-h-0 overflow-auto px-4 py-4"
          style={{ background: "var(--moba-bg)" }}
        >
          {/* Name / saved-session row */}
          <div className="flex items-center gap-2 mb-4">
            <label className="text-[12px] w-28 text-right">Tunnel name *</label>
            <input
              className="moba-input w-64"
              placeholder="e.g. postgres-replica"
              value={draft.name}
              onChange={(e) => update("name", e.target.value)}
            />
            <label className="text-[12px] w-32 text-right ml-3">Use saved session</label>
            <select
              className="moba-input w-64 appearance-none"
              value={draft.sshSessionId ?? ""}
              onChange={(e) => pickSshSession(e.target.value)}
            >
              <option value="">— None (fill below) —</option>
              {sshSessionOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || `${s.username ?? "user"}@${s.host}`}
                </option>
              ))}
            </select>
          </div>

          {/* Diagram-style three columns */}
          <div
            className="grid items-stretch gap-3"
            style={{ gridTemplateColumns: "1fr 0.8fr 1fr" }}
          >
            {/* Left column: Local clients / My computer */}
            <DiagramCard
              icon={isRemote ? <Server className="w-7 h-7" style={{ color: "#2b5d8b" }} /> : <Users className="w-7 h-7" style={{ color: "#c97a23" }} />}
              title={isRemote ? "Remote clients" : "Local clients"}
              subtitle={isRemote ? "On the SSH server side" : "Apps on this computer"}
            >
              {!isRemote && (
                <Field label={forwardedLabel}>
                  <input
                    className="moba-input w-24"
                    type="number"
                    placeholder="0"
                    value={draft.listenPort || ""}
                    onChange={(e) => update("listenPort", parseInt(e.target.value || "0", 10) || 0)}
                  />
                  <span className="text-[11px] ml-1" style={{ color: "var(--moba-text-muted)" }}>
                    (listen)
                  </span>
                </Field>
              )}
              {!isRemote && (
                <Field label="Listen address">
                  <input
                    className="moba-input w-32"
                    placeholder="127.0.0.1"
                    value={draft.listenHost}
                    onChange={(e) => update("listenHost", e.target.value)}
                  />
                </Field>
              )}
              {isRemote && (
                <div className="text-[11px] mt-2" style={{ color: "var(--moba-text-muted)" }}>
                  Remote applications will connect to <strong>{draft.listenHost || "0.0.0.0"}:{draft.listenPort || "<port>"}</strong> on the SSH server.
                </div>
              )}
              <div className="flex items-center justify-end mt-2">
                <ArrowRight className="w-5 h-5" style={{ color: "var(--moba-accent)" }} />
              </div>
            </DiagramCard>

            {/* Middle column: SSH tunnel through firewall */}
            <DiagramCard
              icon={<Flame className="w-7 h-7" style={{ color: "#d35a2c" }} />}
              title="SSH tunnel"
              subtitle="Through the firewall"
            >
              <Field label="SSH server *">
                <input
                  className="moba-input w-44"
                  placeholder="ssh.example.com"
                  value={draft.ssh.host}
                  onChange={(e) => updateSsh("host", e.target.value)}
                />
              </Field>
              <Field label="SSH login *">
                <input
                  className="moba-input w-32"
                  placeholder="user"
                  value={draft.ssh.username}
                  onChange={(e) => updateSsh("username", e.target.value)}
                />
              </Field>
              <Field label="SSH port">
                <input
                  className="moba-input w-20"
                  type="number"
                  placeholder="22"
                  value={draft.ssh.port || ""}
                  onChange={(e) => updateSsh("port", parseInt(e.target.value || "22", 10) || 22)}
                />
              </Field>
              <Field label="Auth">
                <select
                  className="moba-input w-32 appearance-none"
                  value={draft.ssh.authMethod}
                  onChange={(e) => updateSsh("authMethod", e.target.value as "Password" | "PrivateKey" | "Agent")}
                >
                  <option value="Password">Password</option>
                  <option value="PrivateKey">Private key</option>
                  <option value="Agent">SSH agent</option>
                </select>
              </Field>
              {draft.ssh.authMethod === "Password" && (
                <Field label="Password">
                  <input
                    className="moba-input w-44"
                    type="password"
                    value={draft.ssh.authData ?? ""}
                    onChange={(e) => updateSsh("authData", e.target.value)}
                  />
                </Field>
              )}
              {draft.ssh.authMethod === "PrivateKey" && (
                <Field label="Key path">
                  <input
                    className="moba-input w-44"
                    placeholder="~/.ssh/id_ed25519"
                    value={draft.ssh.authData ?? ""}
                    onChange={(e) => updateSsh("authData", e.target.value)}
                  />
                </Field>
              )}
              {draft.ssh.authMethod !== "Agent" && (
                <Field label="Vault">
                  <label className="flex items-center gap-1.5 text-[11px]">
                    <input
                      type="checkbox"
                      className="moba-checkbox"
                      checked={!!draft.ssh.saveAuth}
                      onChange={(e) => updateSsh("saveAuth", e.target.checked)}
                    />
                    Save credentials to disk
                  </label>
                </Field>
              )}
            </DiagramCard>

            {/* Right column: Remote/SOCKS endpoint */}
            <DiagramCard
              icon={
                isDynamic ? (
                  <Globe className="w-7 h-7" style={{ color: "#1e6db8" }} />
                ) : isRemote ? (
                  <Monitor className="w-7 h-7" style={{ color: "#2b5d8b" }} />
                ) : (
                  <Server className="w-7 h-7" style={{ color: "#1e6db8" }} />
                )
              }
              title={isDynamic ? "SOCKS5 proxy" : isRemote ? "This computer" : "Remote server"}
              subtitle={
                isDynamic
                  ? "Apps reach any host through the SSH server"
                  : isRemote
                    ? "Local service the SSH server reaches"
                    : "Reachable from the SSH server"
              }
            >
              <div className="flex items-center justify-start mb-1">
                <ArrowLeft className="w-5 h-5" style={{ color: "var(--moba-accent)" }} />
              </div>
              {isRemote && (
                <>
                  <Field label="Local target *">
                    <input
                      className="moba-input w-44"
                      placeholder="127.0.0.1"
                      value={draft.destHost}
                      onChange={(e) => update("destHost", e.target.value)}
                    />
                  </Field>
                  <Field label="Local port *">
                    <input
                      className="moba-input w-20"
                      type="number"
                      placeholder="5432"
                      value={draft.destPort || ""}
                      onChange={(e) => update("destPort", parseInt(e.target.value || "0", 10) || 0)}
                    />
                  </Field>
                </>
              )}
              {isLocal && (
                <>
                  <Field label={`${destLabel} *`}>
                    <input
                      className="moba-input w-44"
                      placeholder="db.internal"
                      value={draft.destHost}
                      onChange={(e) => update("destHost", e.target.value)}
                    />
                  </Field>
                  <Field label="Remote port *">
                    <input
                      className="moba-input w-20"
                      type="number"
                      placeholder="5432"
                      value={draft.destPort || ""}
                      onChange={(e) => update("destPort", parseInt(e.target.value || "0", 10) || 0)}
                    />
                  </Field>
                </>
              )}
              {isDynamic && (
                <div className="text-[11px]" style={{ color: "var(--moba-text-muted)" }}>
                  No fixed destination — point your applications at{" "}
                  <strong>
                    socks5://{draft.listenHost || "127.0.0.1"}:{draft.listenPort || "<port>"}
                  </strong>{" "}
                  and they'll reach any host the SSH server can.
                </div>
              )}
            </DiagramCard>
          </div>

          {/* Description / autostart */}
          <div className="mt-4 grid grid-cols-12 gap-3 items-center">
            <label className="col-span-2 text-[12px] text-right">Description</label>
            <input
              className="moba-input col-span-7"
              placeholder="Optional description shown in the tunnels table"
              value={draft.description ?? ""}
              onChange={(e) => update("description", e.target.value)}
            />
            <label className="col-span-3 flex items-center gap-1.5 text-[12px] justify-end">
              <input
                type="checkbox"
                className="moba-checkbox"
                checked={!!draft.autostart}
                onChange={(e) => update("autostart", e.target.checked)}
              />
              Auto-start on app launch
            </label>
          </div>

          {error && (
            <div
              className="mt-3 px-3 py-2 rounded text-[12px]"
              style={{ background: "#fff1f0", color: "#9b1c1c", border: "1px solid #f5b3b3" }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="h-12 flex items-center justify-center gap-3 border-t shrink-0"
          style={{ background: "var(--moba-quick-bg)", borderColor: "var(--moba-divider)" }}
        >
          <button
            type="button"
            className="moba-btn flex items-center gap-1.5"
            data-primary="true"
            onClick={handleSave}
            disabled={busy}
          >
            <SaveIcon className="w-3.5 h-3.5" /> {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" className="moba-btn flex items-center gap-1.5" onClick={onCancel} disabled={busy}>
            <XCircle className="w-3.5 h-3.5" /> Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function DiagramCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-md border p-3 flex flex-col gap-1.5"
      style={{ borderColor: "var(--moba-divider)", background: "var(--moba-panel-bg)" }}
    >
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <div>
          <div className="text-[12px] font-semibold">{title}</div>
          <div className="text-[10.5px]" style={{ color: "var(--moba-text-muted)" }}>{subtitle}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <label className="w-24 text-right shrink-0" style={{ color: "var(--moba-text-muted)" }}>{label}</label>
      <div className="flex items-center gap-1 flex-wrap">{children}</div>
    </div>
  );
}
