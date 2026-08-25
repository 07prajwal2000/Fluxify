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
	/**
	 * Not a real integration row: a placeholder whose concrete integration is
	 * chosen elsewhere (a custom block's input parameter, resolved by the caller).
	 * These sort first, carry a badge, and expose no test/open actions — there is
	 * nothing on this side to test or open.
	 */
	external?: boolean;
	/** Explains an `external` entry in the picker and under the field. */
	hint?: string;
}

/** Internal async-load state. */
export type LoadStatus = "idle" | "loading" | "success" | "error";

/** Internal test-connection state per run. */
export type TestStatus = "idle" | "testing" | "success" | "error";

/** Modal size options */
export type ModalSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "full";

export interface IntegrationSelectorProps {
	/** Currently selected integration id. Pass empty string for none. */
	selectedId: string;
	/**
	 * Async function provided by the consumer to fetch the list of integrations
	 * to display in the picker modal. Called on mount and whenever the reference
	 * identity changes.
	 */
	loadIntegrations: () => Promise<Integration[]>;
	/**
	 * Entries injected ahead of the loaded ones without a fetch — used for
	 * `external` placeholders. Listed first in the picker.
	 */
	injectedIntegrations?: Integration[];
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
	/** Integration group (e.g. 'observability', 'database') to filter or append as query param. */
	group?: string;
	/** Label text for the "Choose" button. Defaults to "Choose". */
	selectBtnLabel?: string;
	/** Modal size: "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "full". Defaults to "lg". */
	modalSize?: ModalSize;
	/** Custom exact modal height (e.g. "580px" or "70vh"). Overrides default height for the size. */
	modalHeight?: string;
	/** Field label rendered above the selector. */
	label?: string | ReactNode;
	/** Helper description rendered below the label. */
	description?: string;
	/** Additional CSS class applied to the root element. */
	className?: string;
	/** Disables the select and clear buttons, making it read-only. */
	readonly?: boolean;
}
