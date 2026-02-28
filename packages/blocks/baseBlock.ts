import jwt from "jsonwebtoken";
import { DbFactory } from "@fluxify/adapters";
import { AbstractLogger, HttpClient } from "@fluxify/lib";
import { JsVM } from "@fluxify/lib";
import z from "zod";
import type dayjs from "dayjs";

export interface Context {
	vm: JsVM;
	route: string;
	projectId: string;
	apiId: string;
	vars: ContextVarsType & Record<string, any>;
	requestBody?: any;
	dbFactory?: DbFactory;
	httpClient?: HttpClient;
	stopper: {
		timeoutEnd: number;
		duration: number;
	};
}

export enum HttpCookieSameSite {
	Empty = "",
	Lax = "Lax",
	Strict = "Strict",
	None = "None",
}

export interface HttpCookieSettings {
	name: string;
	value: string | number;
	domain?: string;
	path?: string;
	expiry?: Date | string;
	httpOnly?: boolean;
	secure?: boolean;
	samesite?: HttpCookieSameSite;
}

export interface ContextVarsType {
	getQueryParam: (key: string) => string;
	getRouteParam: (key: string) => string;
	getHeader: (key: string) => string;
	setHeader: (key: string, value: string) => void;
	getCookie: (key: string) => string;
	setCookie(
		name: string,
		value: {
			value: string | number;
			domain: string;
			path: string;
			expiry: string;
			httpOnly: boolean;
			secure: boolean;
			samesite: HttpCookieSameSite;
		},
	): void;
	httpRequestMethod: string;
	httpRequestRoute: string;
	getRequestBody: () => any;
	httpClient: HttpClient;
	libs: {
		dayjs: dayjs.Dayjs;
		_: unknown;
	};
	/**
	 * get the value of the app config
	 * @param key app config key name
	 */
	getConfig(key: string): string | number | boolean;
	/**
	 * run database query inside DB Native block
	 * @param query SQL supported query
	 * @returns
	 */
	dbQuery?: (query: string) => Promise<unknown>;
	logger: AbstractLogger;
	jwt: {
		sign(payload: object, secretKey: string, options?: jwt.SignOptions): string;
		verify(
			token: string,
			secretKey: string,
			options?: jwt.VerifyOptions,
		): { success: boolean; payload: Record<string, string> | null };
		decode(
			token: string,
			options?: jwt.DecodeOptions,
		): Record<string, string> | null;
	};
}

export const contextVarsAiDescription = `<js_runtime_context>
// Global variables and functions available in the JS Engine

// 1. Request Context
const httpRequestMethod: string; // e.g., "GET", "POST"
const httpRequestRoute: string;  // e.g., "/api/users/:id"
const input: any;                // The output data from the previous connected block

// 2. Request Helpers
function getQueryParam(key: string): string;
function getRouteParam(key: string): string;
function getHeader(key: string): string;
function getRequestBody(): any;  // Returns body object for POST/PUT, else undefined

// 3. Response Helpers
function setHeader(key: string, value: string): void;
function setCookie(name: string, options: { 
  value: string | number; 
  domain?: string; 
  path?: string; 
  expiry?: string; 
  httpOnly?: boolean; 
  secure?: boolean; 
  samesite?: 'Strict' | 'Lax' | 'None'; 
}): void;

// 4. System & Utilities
	function getConfig(key: string): string | number | boolean | undefined;
	function dbQuery(query: string): Promise<unknown>; // Only available in DB Native block
	const logger: { 
		logInfo(...args: any[]): void; 
		logError(...args: any[]): void; 
		logWarn(...args: any[]): void; 
	};
	const httpClient: {
		get<T = any>(
			url: string,
			headers?: HttpHeaders
		): Promise<AxiosResponse<T>>;

		post<T = any>(
			url: string,
			data?: any,
			headers?: HttpHeaders
		): Promise<AxiosResponse<T>>;

		put<T = any>(
			url: string,
			data?: any,
			headers?: HttpHeaders
		): Promise<AxiosResponse<T>>;

		delete<T = any>(
			url: string,
			headers?: HttpHeaders
		): Promise<AxiosResponse<T>>;

		patch<T = any>(
			url: string,
			data?: any,
			headers?: HttpHeaders
		): Promise<AxiosResponse<T>>;

		native(): AxiosInstance;
	}
	const libs: {
		dayjs: dayjs() // full dayjs library access with utc extended.
		_: underscore // supports full underscore.js library. 
	}
// 5. JWT
const jwt: {
	// retuns signed JWT token
	sign(payload: object, secretKey: string, options?: object): string;
	// verifies if the token, if valid, returns the payload and success=true else false and null payload. 
	verify(
		token: string,
		secretKey: string,
		options?: object,
	): { success: boolean; payload: Record<string, string> | null };
	// just decodes the token and returns the payload
	decode(
		token: string,
		options?: object,
	): Record<string, string> | null;
};

// 6. Execution Rules
// - State Sharing: Assign values to global variables (e.g., \`myVar = 123\`) to pass them to the next block.
// - Constraints: No external libraries (npm/require). Pure ES6+ JavaScript only.
</js_runtime_context>`;

export interface BlockOutput {
	output?: any;
	next?: string;
	error?: string;
	successful: boolean;
	continueIfFail: boolean;
}

export const baseBlockDataSchema = z.object({
	blockName: z.string().optional().default("Name"),
	blockDescription: z.string().optional().default("Description"),
});

export type BlockOptions = {
	timedOut: boolean;
};

export abstract class BaseBlock {
	constructor(
		protected readonly context: Context,
		protected readonly input?: any,
		public readonly next?: string,
	) {}
	public abstract executeAsync(
		params?: any,
		options?: BlockOptions,
	): Promise<BlockOutput>;
}
