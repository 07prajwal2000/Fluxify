import { useState } from "react";
import axios, { AxiosResponse, AxiosError } from "axios";

export interface ExecutionResponse {
  status: number;
  statusText: string;
  data: any;
  time: number;
  size: number;
  isError?: boolean;
}

/**
 * Hook to execute API requests using Axios.
 * Manages loading states and formats responses for the UI.
 */
export const useApiExecutor = () => {
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ExecutionResponse | null>(null);

  const execute = async (config: {
    method: string;
    path: string;
    pathParams: Record<string, string>;
    queryParams: Record<string, string>;
    headers: Record<string, string>;
    body?: string;
  }) => {
    setLoading(true);
    setResponse(null);
    const startTime = Date.now();

    try {
      // 1. Construct URL by replacing :param placeholders
      let finalUrl = config.path;
      Object.entries(config.pathParams).forEach(([key, value]) => {
        finalUrl = finalUrl.replace(`:${key}`, encodeURIComponent(value || `:${key}`));
      });

      // 2. Perform Request
      const res: AxiosResponse = await axios({
        method: config.method,
        url: finalUrl,
        baseURL: window.location.origin,
        headers: config.headers,
        params: config.queryParams,
        data: config.body ? JSON.parse(config.body) : undefined,
      });

      const endTime = Date.now();
      
      setResponse({
        status: res.status,
        statusText: res.statusText,
        data: res.data,
        time: endTime - startTime,
        size: JSON.stringify(res.data).length,
      });
    } catch (err: any) {
      const error = err as AxiosError;
      const endTime = Date.now();
      
      setResponse({
        status: error.response?.status || 500,
        statusText: error.response?.statusText || "Error",
        data: error.response?.data || { error: error.message },
        time: endTime - startTime,
        size: JSON.stringify(error.response?.data || {}).length,
        isError: true,
      });
    } finally {
      setLoading(false);
    }
  };

  return { execute, loading, response };
};
