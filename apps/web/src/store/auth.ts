import type { AccessControlRole, AuthACL } from "@fluxify/server/src/db/schema";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

type UserData = {
  id: string;
  name: string;
  email: string;
  image?: string;
  isSystemAdmin?: boolean;
};

type State = {
  state: {
    userData: UserData;
    acl: Record<string, AccessControlRole>; // projectId -> role
  };
};
type Actions = {
  actions: {
    setUserData: (data: UserData) => void;
    setACL: (acl: AuthACL[]) => void;
  };
};

export const authStore = create<State & Actions>()(
  immer((set, get) => ({
    state: {
      userData: {
        id: "",
        name: "",
        email: "",
        image: "",
      },
      acl: {},
    },
    actions: {
      setUserData(data: UserData) {
        set((state) => {
          state.state.userData = data;
        });
      },
      setACL(acl: AuthACL[]) {
        set((state) => {
          state.state.acl = {};
          acl.forEach((entry) => {
            state.state.acl[entry.projectId] = entry.role;
          });
          if (state.state.userData.isSystemAdmin === undefined)
            state.state.userData.isSystemAdmin = "*" in state.state.acl;
        });
      },
    },
  }))
);

export function useAuthStore() {
  return authStore((state) => state.state);
}

export function useAuthStoreActions() {
  return authStore((state) => state.actions);
}
