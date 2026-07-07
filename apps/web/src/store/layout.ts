import { create } from "zustand";

interface LayoutState {
  sidebarOpened: boolean;
  setSidebarOpened: (opened: boolean) => void;
  toggleSidebar: () => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  sidebarOpened: true,
  setSidebarOpened: (opened) => set({ sidebarOpened: opened }),
  toggleSidebar: () => set((state) => ({ sidebarOpened: !state.sidebarOpened })),
}));
