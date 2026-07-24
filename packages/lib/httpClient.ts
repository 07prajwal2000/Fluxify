import axios, { type AxiosInstance } from "axios";

type HttpHeaders = Record<string, string>;

export class HttpClient {
  private instance: AxiosInstance;
  constructor() {
    this.instance = axios.create({
      baseURL: "http://localhost:3000",
    });
  }
  public get<T>(url: string, headers?: HttpHeaders) {
    return this.instance.get<T>(url, { headers });
  }
  public post<T>(url: string, data?: any, headers?: HttpHeaders) {
    return this.instance.post<T>(url, data, { headers });
  }
  public put<T>(url: string, data?: any, headers?: HttpHeaders) {
    return this.instance.put<T>(url, data, { headers });
  }
  public delete<T>(url: string, headers?: HttpHeaders) {
    return this.instance.delete<T>(url, { headers });
  }
  public patch<T>(url: string, data?: any, headers?: HttpHeaders) {
    return this.instance.patch<T>(url, data, { headers });
  }
  public native() {
    return this.instance;
  }
}
