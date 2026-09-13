import type { ApiPlaygroundState } from "@fluxify/components";
import { create } from "zustand";

type CanvasPlaygroundCacheStore = {
	cache: Record<string, ApiPlaygroundState>;
	setPlaygroundState: (routeId: string, state: ApiPlaygroundState) => void;
	getPlaygroundState: (routeId: string) => ApiPlaygroundState | undefined;
	clearPlaygroundState: (routeId: string) => void;
	clearAll: () => void;
};

export const useCanvasPlaygroundCacheStore = create<CanvasPlaygroundCacheStore>((set, get) => ({
	cache: {},
	setPlaygroundState: (routeId, state) =>
		set((prev) => ({
			cache: { ...prev.cache, [routeId]: state },
		})),
	getPlaygroundState: (routeId) => get().cache[routeId],
	clearPlaygroundState: (routeId) =>
		set((prev) => {
			const { [routeId]: _, ...rest } = prev.cache;
			return { cache: rest };
		}),
	clearAll: () => set({ cache: {} }),
}));
