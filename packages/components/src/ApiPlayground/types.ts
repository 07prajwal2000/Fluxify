export type ApiSchemaProperty = {
	key: string;
	dataType?: string;
	required?: boolean;
	properties?: ApiSchemaProperty[];
	items?: ApiSchemaProperty;
};

/** Supports Fluxify validation schemas and standard JSON Schema property maps. */
export type ApiSchema =
	| { properties?: ApiSchemaProperty[]; required?: string[]; type?: string }
	| { properties?: Record<string, { type?: string; required?: boolean }> };

export type ApiPlaygroundRoute = {
	/** The unexpanded route path, for example `/users/:id`. */
	path: string;
	method: string;
	paramsSchema?: ApiSchema | null;
	querySchema?: ApiSchema | null;
	bodySchema?: ApiSchema | null;
	acceptedContentTypes?: string[];
};

export type ApiKeyValue = {
	id: string;
	key: string;
	value: string;
	/** Schema-backed rows cannot be removed. */
	required?: boolean;
};

export type ApiFormValue = string | File;

export type ApiPlaygroundRequest = {
	method: string;
	/** URL after path-variable and query-string expansion. */
	url: string;
	path: string;
	pathParams: Record<string, string>;
	query: Record<string, string>;
	headers: Record<string, string>;
	body?: string | FormData;
	contentType?: string;
};

export type ApiPlaygroundResponse = {
	status: number;
	statusText?: string;
	headers?: Headers | Record<string, string>;
	body?: string;
	/** Used by Monaco to select a response language. Derived from headers when absent. */
	mimeType?: string;
	durationMs?: number;
	bytes?: number;
};

export type ApiPlaygroundProps = {
	route: ApiPlaygroundRoute;
	/** Origin or base URL, such as `http://localhost:8000`. */
	baseUrl?: string;
	/** A caller owns transport, auth, CORS policy, and response parsing. */
	onSend: (request: ApiPlaygroundRequest) => Promise<ApiPlaygroundResponse>;
	className?: string;
	/** Set false when the host (for example a modal) already supplies the frame. */
	isFramed?: boolean;
	initialPathParams?: Record<string, string>;
	initialQuery?: Record<string, string>;
	initialHeaders?: Record<string, string>;
	initialBody?: string;
	/** Called after an editable request field changes. Useful for persisted drafts. */
	onRequestChange?: (request: Omit<ApiPlaygroundRequest, "url" | "body">) => void;
};
