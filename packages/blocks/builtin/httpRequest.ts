import z from "zod";
import {
  BaseBlock,
  baseBlockDataSchema,
  BlockOutput,
  Context,
} from "../baseBlock";
import type { EmitNode } from "../compiler";

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

function parseIfJson(body: any) {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch (error) {
    return body;
  }
}

/** shared by the interpreted block and the compiled `lib.httpRequest(...)` call */
export async function runHttpRequest(
  context: Context,
  input: z.infer<typeof httpRequestBlockSchema>,
  params?: any,
): Promise<BlockOutput> {
  if (!context.httpClient) {
    return {
      continueIfFail: false,
      successful: false,
      output: null,
      error: "HttpClient not initialized",
    };
  }
  try {
    let { url, method, headers, body, useParam } = input;
    if (useParam) {
      body = params;
    }
    if (url.startsWith("js:")) {
      url = await context.vm.runAsync(url.slice(3));
    }
    if (!useParam && body.startsWith("js:")) {
      body = await context.vm.runAsync(body.slice(3));
    }
    body = parseIfJson(body);
    const newHeaders: Record<string, string> = {};
    for (let [key, value] of Object.entries(headers)) {
      key = key.startsWith("js:") ? await context.vm.runAsync(key.slice(3)) : key;
      value = value.startsWith("js:")
        ? await context.vm.runAsync(value.slice(3))
        : value;
      newHeaders[key] = value;
    }
    headers = newHeaders;
    let response;
    switch (method) {
      case "GET":
        response = await context.httpClient?.get(url, headers);
        break;
      case "POST":
        response = await context.httpClient?.post(url, body, headers);
        break;
      case "PUT":
        response = await context.httpClient?.put(url, body, headers);
        break;
      case "DELETE":
        response = await context.httpClient?.delete(url, headers);
        break;
      case "PATCH":
        response = await context.httpClient?.patch(url, body, headers);
        break;
    }
    return {
      continueIfFail: true,
      successful: !!response,
      output: { data: response?.data, status: response?.status },
    };
  } catch (error: any) {
    return {
      continueIfFail: false,
      successful: false,
      output: {
        data: error?.response?.data,
        status: error?.response?.status,
      },
    };
  }
}

export function emitHttpRequest(node: EmitNode) {
  const data = httpRequestBlockSchema.parse(node.block.data);
  const result = node.v("res");
  return `const ${result} = await lib.httpRequest(ctx, ${JSON.stringify(data)}, ${node.in});
if (!${result}.successful && !${result}.continueIfFail) throw new Error(${result}.error ?? "http request failed");
${node.in} = ${result}.output;
${node.next()}`;
}

export class HttpRequestBlock extends BaseBlock {
  constructor(
    context: Context,
    input: z.infer<typeof httpRequestBlockSchema>,
    next: string,
  ) {
    super(context, input, next);
  }
  override async executeAsync(params?: any): Promise<BlockOutput> {
    const result = await runHttpRequest(
      this.context,
      this.input as z.infer<typeof httpRequestBlockSchema>,
      params,
    );
    return { ...result, next: this.next };
  }
}
