import { useState, useEffect } from "react";

/**
 * Hook to manage API request configuration state.
 * Handles path parameter parsing and syncs state with route changes.
 */
export const useRequestState = (initialPath: string) => {
  const [pathParams, setPathParams] = useState<Record<string, string>>({});
  const [queryParams, setQueryParams] = useState<Record<string, string>>({});
  const [headers, setHeaders] = useState<Record<string, string>>({
    "Content-Type": "application/json",
  });
  const [body, setBody] = useState<string>(`{
  
}`);

  // Automatically parse path parameters whenever the route path changes
  useEffect(() => {
    const params = initialPath.match(/:[a-zA-Z0-9_]+/g);
    if (params) {
      const parsed: Record<string, string> = {};
      params.forEach((p) => {
        const key = p.substring(1);
        parsed[key] = ""; // Initialize with empty value
      });
      setPathParams(parsed);
    } else {
      setPathParams({});
    }
  }, [initialPath]);

  return {
    pathParams,
    setPathParams,
    queryParams,
    setQueryParams,
    headers,
    setHeaders,
    body,
    setBody,
  };
};
