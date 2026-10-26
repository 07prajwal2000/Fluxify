import axios, { type AxiosInstance } from "axios";

type HttpHeaders = Record<string, string>;

// Request routes share one private transport. Keeping the instance module-local
// prevents user code from installing global interceptors or mutating defaults.
const sharedInstance: AxiosInstance = axios.create({
	baseURL: "http://localhost:3000",
});

export class HttpClient {
	/** `signal` cancels every call once the run it belongs to is cancelled (#1000) */
	constructor(private readonly signal?: AbortSignal) {}

	public get<T>(url: string, headers?: HttpHeaders) {
		return sharedInstance.get<T>(url, { headers, signal: this.signal });
	}
	public post<T>(url: string, data?: any, headers?: HttpHeaders) {
		return sharedInstance.post<T>(url, data, { headers, signal: this.signal });
	}
	public put<T>(url: string, data?: any, headers?: HttpHeaders) {
		return sharedInstance.put<T>(url, data, { headers, signal: this.signal });
	}
	public delete<T>(url: string, headers?: HttpHeaders) {
		return sharedInstance.delete<T>(url, { headers, signal: this.signal });
	}
	public patch<T>(url: string, data?: any, headers?: HttpHeaders) {
		return sharedInstance.patch<T>(url, data, { headers, signal: this.signal });
	}
}
