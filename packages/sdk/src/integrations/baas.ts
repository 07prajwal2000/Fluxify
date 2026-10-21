/**
 * Backend-as-a-Service (BaaS) adapter interface (Firebase, Supabase, etc.).
 */
export interface BaasAdapter {
	/** Provides access to the underlying BaaS client instance. */
	client(): unknown | Promise<unknown>;
}

export type IBaasAdapter = BaasAdapter;

/** Inspect/metadata shape for BaaS integrations. */
export type BaasInspectResult = {
	services?: string[];
};

export type BaasMetadata = BaasInspectResult;
