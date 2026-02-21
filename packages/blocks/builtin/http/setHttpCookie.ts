import z from "zod";
import {
  baseBlockDataSchema,
  BaseBlock,
  BlockOutput,
  HttpCookieSameSite,
} from "../../baseBlock";
import dayjs from "dayjs";

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
  name: "set_http_cookie",
  description:
    "Sets a cookie in the HTTP response.",
  jsonSchema: JSON.stringify(z.toJSONSchema(setHttpCookieBlockSchema)),
};

export class SetHttpCookieBlock extends BaseBlock {
  override async executeAsync(params?: any): Promise<BlockOutput> {
    const input = this.input as z.infer<typeof setHttpCookieBlockSchema>;
    let value = input.value;
    if (typeof value == "string" && value.startsWith("js:")) {
      const js = value.slice(3);
      const res = await this.context.vm.runAsync(js);
      value = res;
    }
    if (typeof input.expiry == "string" && input.expiry.startsWith("js:")) {
      const js = input.expiry.slice(3);
      const res = await this.context.vm.runAsync(js);
      input.expiry = dayjs(res).toISOString() as string;
    } else if (typeof input.expiry === "string") {
      input.expiry = dayjs(input.expiry).toISOString();
    }
    if (typeof input.domain == "string" && input.domain.startsWith("js:")) {
      const js = input.domain.slice(3);
      const res = await this.context.vm.runAsync(js);
      input.domain = res as string;
    }
    if (typeof input.path == "string" && input.path.startsWith("js:")) {
      const js = input.path.slice(3);
      const res = await this.context.vm.runAsync(js);
      input.path = res as string;
    }
    if (typeof input.name == "string" && input.name.startsWith("js:")) {
      const js = input.name.slice(3);
      const res = await this.context.vm.runAsync(js);
      input.name = res as string;
    }
    this.context.vars.setCookie(input.name, {
      value: value,
      domain: input.domain!,
      path: input.path!,
      expiry: input.expiry!,
      httpOnly: input.httpOnly!,
      secure: input.secure!,
      samesite: input.samesite!,
    });
    return {
      continueIfFail: true,
      successful: true,
      next: this.next,
      output: params,
    };
  }
}
