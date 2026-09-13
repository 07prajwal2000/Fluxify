export type SnippetCategory =
	| "pagination"
	| "params"
	| "request"
	| "response"
	| "auth"
	| "http"
	| "database"
	| "validation"
	| "config"
	| "logging"
	| "utils"
	| "variables"
	| (string & {});

export type CodeSnippet = {
	id: string;
	title: string;
	description: string;
	category: SnippetCategory;
	code: string;
	tags?: string[];
};

export type ApiDocItem = {
	id: string;
	name: string;
	kind: "property" | "function" | "object" | "lib";
	signature: string;
	description: string;
	category: SnippetCategory;
	example?: string;
	returns?: string;
};

export type ApiDocCategoryGroup = {
	category: SnippetCategory;
	title: string;
	items: ApiDocItem[];
};
