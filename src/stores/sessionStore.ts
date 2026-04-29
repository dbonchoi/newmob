import { create } from "zustand";
import {
  listSessions,
  saveSession,
  deleteSession,
  markSessionConnected,
  type SessionConfig,
  type SessionGroup,
  listSessionGroups,
  saveSessionGroup,
} from "../lib/ipc";

interface SessionState {
  sessions: SessionConfig[];
  groups: SessionGroup[];
  loading: boolean;
  selectedSessionId: string | null;
  searchQuery: string;

  loadSessions: () => Promise<void>;
  addSession: (config: SessionConfig) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  updateSession: (config: SessionConfig) => Promise<void>;
  duplicateSession: (id: string) => Promise<void>;
  markConnected: (id: string) => Promise<void>;
  addGroup: (name: string, parentId?: string | null) => Promise<void>;
  setSelectedSession: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  groups: [],
  loading: false,
  selectedSessionId: null,
  searchQuery: "",

  loadSessions: async () => {
    set({ loading: true });
    try {
      const [sessions, groups] = await Promise.all([
        listSessions(),
        listSessionGroups(),
      ]);
      set({ sessions, groups, loading: false });
    } catch (err) {
      console.error("Failed to load sessions:", err);
      set({ loading: false });
    }
  },

  addSession: async (config) => {
    await saveSession(config);
    const [sessions, groups] = await Promise.all([
      listSessions(),
      listSessionGroups(),
    ]);
    set({ sessions, groups, selectedSessionId: config.id });
  },

  removeSession: async (id) => {
    await deleteSession(id);
    set((s) => ({
      sessions: s.sessions.filter((x) => x.id !== id),
      selectedSessionId: s.selectedSessionId === id ? null : s.selectedSessionId,
    }));
  },

  updateSession: async (config) => {
    await saveSession(config);
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === config.id ? config : x)),
    }));
  },

  duplicateSession: async (id) => {
    const source = useSessionStore.getState().sessions.find((s) => s.id === id);
    if (!source) return;
    const now = Math.floor(Date.now() / 1000);
    const copy: SessionConfig = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name} (copy)`,
      created_at: now,
      updated_at: now,
      last_connected_at: null,
    };
    await saveSession(copy);
    const sessions = await listSessions();
    set({ sessions, selectedSessionId: copy.id });
  },

  markConnected: async (id) => {
    if (!useSessionStore.getState().sessions.some((s) => s.id === id)) return;
    const ts = await markSessionConnected(id);
    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === id ? { ...session, last_connected_at: ts } : session,
      ),
    }));
  },

  addGroup: async (name, parentId = null) => {
    const group: SessionGroup = {
      id: crypto.randomUUID(),
      name,
      parent_id: parentId,
      sort_order: 0,
      icon: null,
    };
    await saveSessionGroup(group);
    const groups = await listSessionGroups();
    set({ groups });
  },

  setSelectedSession: (id) => set({ selectedSessionId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),
}));
