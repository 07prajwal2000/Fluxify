import axios, { type AxiosInstance } from "axios";

type HttpHeaders = Record<string, string>;

// Request routes share one private transport. Keeping the instance module-local
// prevents user code from installing global interceptors or mutating defaults.
const sharedInstance: AxiosInstance = axios.create({
  baseURL: "http://localhost:3000",
});

export class HttpClient {
  public get<T>(url: string, headers?: HttpHeaders) {
    return sharedInstance.get<T>(url, { headers });
  }
  public post<T>(url: string, data?: any, headers?: HttpHeaders) {
    return sharedInstance.post<T>(url, data, { headers });
  }
  public put<T>(url: string, data?: any, headers?: HttpHeaders) {
    return sharedInstance.put<T>(url, data, { headers });
  }
  public delete<T>(url: string, headers?: HttpHeaders) {
    return sharedInstance.delete<T>(url, { headers });
  }
  public patch<T>(url: string, data?: any, headers?: HttpHeaders) {
    return sharedInstance.patch<T>(url, data, { headers });
  }
}
