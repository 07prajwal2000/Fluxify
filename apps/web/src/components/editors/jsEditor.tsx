import { Editor, Monaco } from "@monaco-editor/react";

type CodeEditorProps = {
	defaultValue?: string;
	onChange?: (value: string) => void;
	value?: string;
	readonly?: boolean;
	height?: number;
	showLineNumbers?: boolean;
};

const JsEditor = (props: CodeEditorProps) => {
	const showLineNumbers = props.showLineNumbers ?? true;
	const height = props.height ? `${props.height}px` : "350px";

	function setupMonaco(monaco: Monaco) {
		monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
			target: monaco.languages.typescript.ScriptTarget.ES2020,
			lib: ["es2020"],
			strict: true,
			allowNonTsExtensions: true,
		});
		monaco.languages.typescript.javascriptDefaults.addExtraLib(
			`
      declare function getQueryParam(key: string): string;
      declare function getRouteParam(key: string): string;
      declare function getHeader(key: string): string;
      declare function setHeader(key: string, value: string): void;
      declare function setCookie(
          name: string,
          value: {
            value: string | number;
            domain: string;
            path: string;
            expiry: string;
            httpOnly: boolean;
            secure: boolean;
            samesite: "Lax" | "Strict" | "None";
          }
        ): void;
      /**
       * get http request body
       */
      declare function getRequestBody(): any;
      /**
       * get the value of the app config
       * @param key app config key name
       */
      declare function getConfig(key: string): string | number | boolean;
      declare const httpRequestMethod: string;
      declare const httpRequestRoute: string;
      /**
       * run database query inside DB Native block
       * @param query SQL supported query
       * @returns
       */
      declare function dbQuery(query: string): Promise<unknown>;
      /**
       * The output of the previous block
       */
      declare const input: any;
      declare const logger: {
        logInfo(value: any): void;
        logWarn(value: any): void;
        logError(value: any): void;
      };
      // JWT
      declare const jwt: {
        sign(payload: object, secretKey: string, options?: object): string;
        verify(
          token: string,
          secretKey: string,
          options?: object,
        ): { success: boolean; payload: Record<string, string> | null };
        decode(
          token: string,
          options?: object,
        ): Record<string, string> | null;
      };
      declare type HttpHeaders = Record<string, string>;
      
      declare interface AxiosResponse<T = any> {
        data: T;
        status: number;
        statusText: string;
        headers: any;
        config: any;
      }

      declare interface AxiosInstance {
        get<T = any>(url: string, config?: any): Promise<AxiosResponse<T>>;
        post<T = any>(url: string, data?: any, config?: any): Promise<AxiosResponse<T>>;
        put<T = any>(url: string, data?: any, config?: any): Promise<AxiosResponse<T>>;
        delete<T = any>(url: string, config?: any): Promise<AxiosResponse<T>>;
        patch<T = any>(url: string, data?: any, config?: any): Promise<AxiosResponse<T>>;
      }

      declare class HttpClient {
        constructor();

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

      declare const httpClient: HttpClient;
      declare namespace libs {
        type ConfigType = string | number | Date | Dayjs | null | undefined;

        interface Dayjs {
          format(template?: string): string;

          toDate(): Date;
          toISOString(): string;
          toJSON(): string;
          valueOf(): number;

          add(value: number, unit: ManipulateType): Dayjs;
          subtract(value: number, unit: ManipulateType): Dayjs;

          startOf(unit: OpUnitType): Dayjs;
          endOf(unit: OpUnitType): Dayjs;

          diff(date: ConfigType, unit?: OpUnitType, float?: boolean): number;

          isBefore(date: ConfigType, unit?: OpUnitType): boolean;
          isAfter(date: ConfigType, unit?: OpUnitType): boolean;
          isSame(date: ConfigType, unit?: OpUnitType): boolean;

          utc(): Dayjs;           // instance utc()
          local(): Dayjs;

          isValid(): boolean;
        }

        type ManipulateType =
          | "millisecond"
          | "second"
          | "minute"
          | "hour"
          | "day"
          | "week"
          | "month"
          | "year";

        type OpUnitType = ManipulateType;

        interface DayjsFactory {
          (date?: ConfigType): Dayjs;

          utc(date?: ConfigType): Dayjs;   // static utc()
          isDayjs(value: any): value is Dayjs;
        }

        const dayjs: DayjsFactory;
        /**
         * fully supported underscore.js library
        */
        const _: unknown; 
      }
      `,
			"file:///types.d.ts",
		);
	}

	return (
		<Editor
			language="javascript"
			height={height}
			defaultValue={props.defaultValue}
			theme="vs-dark"
			value={props.value}
			onChange={(e) => props.onChange && props.onChange(e!)}
			options={{
				readOnly: props.readonly,
				lineNumbers: showLineNumbers ? "on" : "off",
				minimap: {
					enabled: false,
				},
				automaticLayout: true,
			}}
			onMount={(editor, monaco) => {
				setupMonaco(monaco);
			}}
		/>
	);
};

export default JsEditor;
