import { create } from "zustand";
import type { Tab } from "../types";

export type SideTab = "sessions" | "tools" | "macros" | "games";

interface AppState {
  tabs: Tab[];
  activeTabId: string | null;
  sidebarCollapsed: boolean;
  activeSideTab: SideTab;
  xServerEnabled: boolean;
  statusMessage: string;

  addTab: (tab: Tab) => void;
  removeTab: (id: string) => void;
  removeTabs: (ids: string[]) => void;
  setActiveTab: (id: string) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setActiveSideTab: (tab: SideTab) => void;
  toggleXServer: () => void;
  setStatusMessage: (message: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  tabs: [
    {
      id: "welcome",
      type: "welcome",
      title: "Welcome",
      closable: false,
    },
  ],
  activeTabId: "welcome",
  sidebarCollapsed: false,
  activeSideTab: "sessions",
  xServerEnabled: false,
  statusMessage: "Ready",

  addTab: (tab) =>
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
      statusMessage: `Opened ${tab.title}`,
    })),

  removeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      const next = s.tabs.filter((t) => t.id !== id);
      let activeId = s.activeTabId;
      if (activeId === id) {
        activeId = next[Math.min(idx, next.length - 1)]?.id ?? null;
      }
      return { tabs: next, activeTabId: activeId, statusMessage: "Closed tab" };
    }),

  removeTabs: (ids) =>
    set((s) => {
      const idSet = new Set(ids);
      const activeIndex = s.tabs.findIndex((t) => t.id === s.activeTabId);
      const next = s.tabs.filter((t) => !idSet.has(t.id));
      let activeId = s.activeTabId;
      if (!activeId || idSet.has(activeId)) {
        activeId = next[Math.min(activeIndex, next.length - 1)]?.id ?? null;
      }
      return { tabs: next, activeTabId: activeId, statusMessage: "Closed tabs" };
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setActiveSideTab: (tab) => set({ activeSideTab: tab, sidebarCollapsed: false }),

  toggleXServer: () =>
    set((s) => ({
      xServerEnabled: !s.xServerEnabled,
      statusMessage: `X server ${!s.xServerEnabled ? "enabled" : "disabled"}`,
    })),

  setStatusMessage: (message) => set({ statusMessage: message }),
}));
