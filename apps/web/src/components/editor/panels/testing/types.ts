export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface TestSuite {
  id: string;
  name: string;
  description: string;
}

export interface Assertion {
  id: string;
  target: "status" | "body" | "time" | "header" | "custom_js";
  path?: string;
  operator:
    | "equals"
    | "not_equals"
    | "contains"
    | "true"
    | "exists"
    | "less_than"
    | "greater_than";
  expected: string;
  customJs?: string;
  success?: boolean;
  message?: string;
}

export interface RequestConfig {
  pathParams: Record<string, string>;
  queryParams: Record<string, string>;
  headers: Record<string, string>;
  body: string;
}
