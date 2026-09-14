import { BlockTypes } from "../../blockTypes";
import z from "zod";
import { baseBlockDataSchema, HttpCookieSameSite } from "../../baseBlock";
import type { EmitNode } from "../../compiler";

export const setHttpCookieBlockSchema = z
  .object({
    name: z.string().describe("cookie name (supports js expression)"),
    value: z
      .string()
      .or(z.number())
      .describe("cookie value (supports js expression)"),
    domain: z.string().optional().describe("domain (supports js expression)"),
    path: z
      .string()
      .optional()
      .describe("http path for the cookie (supports js expression)"),
    expiry: z
      .string()
      .describe("expiry in date (ISO format, supports js expression)"),
    httpOnly: z.boolean().optional().describe("httponly cookie?"),
    secure: z.boolean().optional().describe("only in https?"),
    samesite: z
      .enum(HttpCookieSameSite)
      .optional()
      .describe("cookie samesite setting"),
  })
  .extend(baseBlockDataSchema.shape);

export const setCookieAiDescription = {
  name: BlockTypes.httpSetCookie,
  description:
    "Sets a cookie in the HTTP response.",
  jsonSchema: JSON.stringify(z.toJSONSchema(setHttpCookieBlockSchema)),
};

export function emitSetHttpCookie(node: EmitNode) {
  const input = setHttpCookieBlockSchema.parse(node.block.data);
  return `vars.setCookie(${node.value(input.name)}, {
value: ${node.value(input.value)},
domain: ${node.value(input.domain)},
path: ${node.value(input.path)},
expiry: lib.isoDate(${node.value(input.expiry)}),
httpOnly: ${JSON.stringify(input.httpOnly ?? null)},
secure: ${JSON.stringify(input.secure ?? null)},
samesite: ${JSON.stringify(input.samesite ?? null)},
});
${node.next()}`;
}
