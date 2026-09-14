import { BlockTypes } from "../blockTypes";
import z from "zod";
import { baseBlockDataSchema, BlockOutput, Context } from "../baseBlock";
import { emitJsObject, type EmitNode } from "../compiler";

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
  name: BlockTypes.httprequest,
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

/** the request the compiled program built — every `js:` value already evaluated */
export type HttpRequestInput = {
  url: string;
  method: z.infer<typeof httpRequestBlockSchema>["method"];
  headers: Record<string, string>;
  body: unknown;
};

/** runtime half of the compiled `lib.httpRequest(...)` call */
export async function runHttpRequest(
  context: Context,
  input: HttpRequestInput,
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
    const { url, method, headers } = input;
    const body = parseIfJson(input.body);
    let response;
    switch (method) {
      case "GET":
        response = await context.httpClient.get(url, headers);
        break;
      case "POST":
        response = await context.httpClient.post(url, body, headers);
        break;
      case "PUT":
        response = await context.httpClient.put(url, body, headers);
        break;
      case "DELETE":
        response = await context.httpClient.delete(url, headers);
        break;
      case "PATCH":
        response = await context.httpClient.patch(url, body, headers);
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

/** `js:` in url, body, header names and values compiles to inline code */
export function emitHttpRequest(node: EmitNode) {
  const { url, method, headers, body, useParam } = httpRequestBlockSchema.parse(
    node.block.data,
  );
  const result = node.v("res");
  const headerFields = Object.entries(headers).map(
    ([key, value]) => `[${node.value(key)}]: ${node.value(value)}`,
  );
  const request = `{ url: ${node.value(url)}, method: ${JSON.stringify(method)}, headers: { ${headerFields.join(", ")} }, body: ${useParam ? node.in : emitJsObject(body, node)} }`;
  return `const ${result} = await lib.httpRequest(ctx, ${request});
if (!${result}.successful && !${result}.continueIfFail) throw new Error(${result}.error ?? "http request failed");
${node.in} = ${result}.output;
${node.next()}`;
}
