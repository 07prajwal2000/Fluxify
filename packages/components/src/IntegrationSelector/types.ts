import type { ReactNode } from "react";

/**
 * A single integration item returned by the consumer's `loadIntegrations` function.
 * Mirrors the server DTO shape without introducing a server/zod dependency.
 */
export interface Integration {
	id: string;
	name: string;
	group: string;
	variant: string;
	config: Record<string, unknown>;
	tags?: string[];
}

/** Internal async-load state. */
export type LoadStatus = "idle" | "loading" | "success" | "error";

/** Internal test-connection state per run. */
export type TestStatus = "idle" | "testing" | "success" | "error";

export interface IntegrationSelectorProps {
	/** Currently selected integration id. Pass empty string for none. */
	selectedId: string;
	/**
	 * Async function provided by the consumer to fetch the list of integrations
	 * to display in the picker modal. Called on mount and whenever the reference
	 * identity changes.
	 */
	loadIntegrations: () => Promise<Integration[]>;
	/** Called with the selected integration id, or empty string to clear. */
	onSelect?: (id: string) => void;
	/**
	 * Optional async function to test the connection for the currently selected
	 * integration. Receives the integration id. Should throw on failure so the
	 * component can show the error state.
	 */
	onTestConnection?: (id: string) => Promise<void>;
	/**
	 * URL opened in a new tab when the "open in new tab" icon is clicked.
	 * Consumer is responsible for constructing this (e.g. pointing to the
	 * integrations settings page with a deep-link query param).
	 */
	openInNewTabUrl?: string;
	/**
	 * URL opened in a new tab when the user clicks "Create Integration" in the
	 * empty-state view inside the picker modal.
	 */
	createIntegrationUrl?: string;
	/** Label text for the "Choose" button. Defaults to "Choose". */
	selectBtnLabel?: string;
	/** Field label rendered above the selector. */
	label?: string | ReactNode;
	/** Helper description rendered below the label. */
	description?: string;
	/** Additional CSS class applied to the root element. */
	className?: string;
}
