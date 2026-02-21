import z from "zod";
import {
  BaseBlock,
  baseBlockDataSchema,
  BlockOutput,
  Context,
} from "../baseBlock";

export const httpRequestBlockSchema = z
  .object({
    url: z.string().describe("Server url (can be js expression)"),
    method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
    headers: z.record(z.string(), z.string()),
    body: z.any(),
    useParam: z.boolean().default(false),
  })
  .extend(baseBlockDataSchema.shape);

export const httpRequestAiDescription = {
  name: "http_request",
  description:
    "Sends an HTTP request to an external URL.",
  jsonSchema: JSON.stringify(z.toJSONSchema(httpRequestBlockSchema)),
};

export class HttpRequestBlock extends BaseBlock {
  constructor(
    context: Context,
    input: z.infer<typeof httpRequestBlockSchema>,
    next: string,
  ) {
    super(context, input, next);
  }
  override async executeAsync(params?: any): Promise<BlockOutput> {
    if (!this.context.httpClient) {
      return {
        continueIfFail: false,
        successful: false,
        next: this.next,
        output: null,
        error: "HttpClient not initialized",
      };
    }
    try {
      let { url, method, headers, body, useParam } = this.input as z.infer<
        typeof httpRequestBlockSchema
      >;
      if (useParam) {
        body = params;
      }
      if (url.startsWith("js:")) {
        url = await this.context.vm.runAsync(url.slice(3));
      }
      if (!useParam && body.startsWith("js:")) {
        body = await this.context.vm.runAsync(body.slice(3));
      }
      body = this.parseIfJson(body);
      const newHeaders: Record<string, string> = {};
      for (let [key, value] of Object.entries(headers)) {
        key = key.startsWith("js:")
          ? await this.context.vm.runAsync(key.slice(3))
          : key;
        value = value.startsWith("js:")
          ? await this.context.vm.runAsync(value.slice(3))
          : value;
        newHeaders[key] = value;
      }
      headers = newHeaders;
      let response;
      switch (method) {
        case "GET":
          response = await this.context.httpClient?.get(url, headers);
          break;
        case "POST":
          response = await this.context.httpClient?.post(url, body, headers);
          break;
        case "PUT":
          response = await this.context.httpClient?.put(url, body, headers);
          break;
        case "DELETE":
          response = await this.context.httpClient?.delete(url, headers);
          break;
        case "PATCH":
          response = await this.context.httpClient?.patch(url, body, headers);
          break;
      }
      return {
        continueIfFail: true,
        successful: !!response,
        next: this.next,
        output: { data: response?.data, status: response?.status },
      };
    } catch (error: any) {
      return {
        continueIfFail: false,
        successful: false,
        next: this.next,
        output: {
          data: error?.response?.data,
          status: error?.response?.status,
        },
      };
    }
  }
  private parseIfJson(body: any) {
    if (typeof body !== "string") return body;
    try {
      return JSON.parse(body);
    } catch (error) {
      return body;
    }
  }
}
