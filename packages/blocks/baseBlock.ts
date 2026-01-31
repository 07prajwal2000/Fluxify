import { DbFactory } from "@fluxify/adapters";
import { AbstractLogger, HttpClient } from "@fluxify/lib";
import { JsVM } from "@fluxify/lib";
import z from "zod";

export interface Context {
  vm: JsVM;
  route: string;
  apiId: string;
  vars: ContextVarsType & Record<string, any>;
  requestBody?: any;
  dbFactory?: DbFactory;
  httpClient?: HttpClient;
  abortController: AbortController;
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
}

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

export abstract class BaseBlock {
  constructor(
    protected readonly context: Context,
    protected readonly input?: any,
    public readonly next?: string,
  ) {}
  public abstract executeAsync(params?: any): Promise<BlockOutput>;
}
