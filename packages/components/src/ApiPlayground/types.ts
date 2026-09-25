export type ApiSchemaRule = {
	type: string;
	value?: unknown;
	message?: string;
	[key: string]: unknown;
};

export type ApiSchemaProperty = {
	key: string;
	dataType?: string;
	required?: boolean;
	properties?: ApiSchemaProperty[];
	items?: ApiSchemaProperty;
	rules?: ApiSchemaRule[];
};

/** Supports Fluxify validation schemas and standard JSON Schema property maps. */
export type ApiSchema =
	| {
			properties?: ApiSchemaProperty[];
			required?: string[];
			type?: string;
			dataType?: string;
			rules?: ApiSchemaRule[];
	  }
	| {
			properties?: Record<
				string,
				{ type?: string; dataType?: string; required?: boolean; rules?: ApiSchemaRule[] }
			>;
			dataType?: string;
			rules?: ApiSchemaRule[];
	  };

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

/** A multipart `file[]` field holds several files, sent under one repeated key. */
export type ApiFormValue = string | File | File[];

/** A form field typed in by hand, for routes that declare no body fields. */
export type ApiFormRow = {
	id: string;
	key: string;
	value: string | File;
	/** multipart only: the value is picked as a file */
	isFile?: boolean;
};

/**
 * One request body, in every shape a content type can take. Only the slice for
 * the current content type is sent; the rest survives switching back.
 */
export type ApiRequestBody = {
	/** JSON or plain text */
	raw: string;
	/** form fields the body schema declares */
	form: Record<string, ApiFormValue>;
	/** form fields typed in by hand when the schema declares none */
	formRows: ApiFormRow[];
	/** octet-stream: a picked file, or base64 text */
	binary: File | string;
};

export type ApiPlaygroundRequest = {
	method: string;
	/** URL after path-variable and query-string expansion. */
	url: string;
	path: string;
	pathParams: Record<string, string>;
	query: Record<string, string>;
	headers: Record<string, string>;
	body?: string | FormData | Blob;
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

export type ApiPlaygroundState = {
	pathRows?: ApiKeyValue[];
	queryRows?: ApiKeyValue[];
	headerRows?: ApiKeyValue[];
	contentType?: string;
	requestBody?: ApiRequestBody;
	response?: ApiPlaygroundResponse;
	validateBeforeSend?: boolean;
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
	/** Preserved snapshot of playground inputs and output. */
	initialState?: ApiPlaygroundState;
	defaultValidate?: boolean;
	/** Called after an editable request field changes. Useful for persisted drafts. */
	onRequestChange?: (request: Omit<ApiPlaygroundRequest, "url" | "body">) => void;
	/** Called after playground input or output state changes. */
	onStateChange?: (state: ApiPlaygroundState) => void;
};
