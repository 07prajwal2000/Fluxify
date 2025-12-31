import type { AccessControlRole } from "@fluxify/server/src/db/schema";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

type SidebarType = "projectMembers" | "npmPackages" | "projectInfo";

type State = {
  sidebar: {
    active: SidebarType;
  };
  members: {
    filter: {
      name: string;
      role: AccessControlRole | "";
    };
    pagination: {
      perPage: number;
      page: number;
    };
  };
};

type Actions = {
  actions: {
    setSidebarActive(active: SidebarType): void;
    setMembersFilter(name: string, role: AccessControlRole): void;
    setMembersPagination(perPage: number, page: number): void;
    resetMembersFilter(): void;
  };
};

const projectSettingsStore = create<State & Actions>()(
  immer((set) => ({
    sidebar: {
      active: "projectInfo",
    },
    members: {
      filter: {
        name: "",
        role: "",
      },
      pagination: {
        page: 1,
        perPage: 10,
      },
    },
    actions: {
      resetMembersFilter() {
        set((state) => {
          state.members.filter = {
            name: "",
            role: "",
          };
        });
      },
      setSidebarActive: (active: SidebarType) => {
        set((state) => {
          state.sidebar.active = active;
        });
      },
      setMembersFilter(name, role) {
        set((state) => {
          state.members.filter.name = name;
          state.members.filter.role = role;
        });
      },
      setMembersPagination(perPage, page) {
        set((state) => {
          state.members.pagination.page = page;
          state.members.pagination.perPage = perPage;
        });
      },
    },
  }))
);

export function useProjectSettingsSidebarStore() {
  return projectSettingsStore((state) => state.sidebar);
}

export function useProjectSettingsMembersStore() {
  return projectSettingsStore((state) => state.members);
}

export function useProjectSettingsActions() {
  return projectSettingsStore((state) => state.actions);
}
