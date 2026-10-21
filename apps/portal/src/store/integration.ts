import type { AnyIntegrationGroup } from "@fluxify/sdk/integrations";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

/** a built-in group, or a plugin's `<namespace>/<group>`; the list itself comes from the API */
export type IntegrationGroup = AnyIntegrationGroup;

type State = {
	state: {
		selectedMenu: IntegrationGroup;
		searchQuery: string;
		filterVariant: string;
		filterHidden: boolean;
	};
};

type Actions = {
	actions: {
		setSelectedMenu: (selectedMenu: IntegrationGroup) => void;
		setSearchQuery: (searchQuery: string) => void;
		setFilterVariant: (filterVariant: string) => void;
		setFilterHidden: (filterHidden: boolean) => void;
		toggleFilterVisibility: () => void;
	};
};

const store = create<State & Actions>()(
	immer((set) => ({
		state: {
			selectedMenu: "database",
			searchQuery: "",
			filterVariant: "",
			filterHidden: false,
		},
		actions: {
			setSelectedMenu: (selectedMenu: IntegrationGroup) =>
				set((state) => {
					state.state.selectedMenu = selectedMenu;
				}),
			setSearchQuery: (searchQuery: string) =>
				set((state) => {
					state.state.searchQuery = searchQuery;
				}),
			setFilterVariant(filterVariant) {
				set((state) => {
					state.state.filterVariant = filterVariant;
				});
			},
			setFilterHidden(filterHidden) {
				set((state) => {
					state.state.filterHidden = filterHidden;
				});
			},
			toggleFilterVisibility() {
				set((state) => {
					state.state.filterHidden = !state.state.filterHidden;
				});
			},
		},
	})),
);

export function useIntegrationState() {
	return store((state) => state.state);
}

export function useIntegrationActions() {
	return store((state) => state.actions);
}
