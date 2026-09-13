import { describe, it, expect } from "bun:test";
import { ResponseBlock } from "../response";
import { JsVM } from "@fluxify/lib";

describe("ResponseBlock", () => {
  it("should return http code and body from params", async () => {
    const block = new ResponseBlock({} as any, {
      httpCode: "200",
      blockName: "",
      blockDescription: "",
    });
    const result = await block.executeAsync({ message: "success" });
    expect(result.successful).toBe(true);
    expect(result.continueIfFail).toBe(true);
    expect(result.output).toEqual({
      httpCode: "200",
      body: { message: "success" },
    });
    // Terminal block — no next
    expect(result.next).toBeUndefined();
  });

  it("should return null body when no params are provided", async () => {
    const block = new ResponseBlock({} as any, {
      httpCode: "404",
      blockName: "",
      blockDescription: "",
    });
    const result = await block.executeAsync();
    expect(result.successful).toBe(true);
    expect(result.output).toEqual({
      httpCode: "404",
      body: null,
    });
  });

  it("should pass through different HTTP codes", async () => {
    const block = new ResponseBlock({} as any, {
      httpCode: "500",
      blockName: "",
      blockDescription: "",
    });
    const result = await block.executeAsync("error occurred");
    expect(result.output!.httpCode).toBe("500");
    expect(result.output!.body).toBe("error occurred");
  });
});

describe("ResponseBlock transform script", () => {
  const context = () => ({ vm: new JsVM({}) }) as any;

  it("shapes the body with the script, keeping the status code", async () => {
    const block = new ResponseBlock(context(), {
      httpCode: "201",
      transformEnabled: true,
      transformScript: "return { data: input, meta: { count: input.length } };",
      blockName: "",
      blockDescription: "",
    });
    const result = await block.executeAsync([1, 2]);
    expect(result.output).toEqual({
      httpCode: "201",
      body: { data: [1, 2], meta: { count: 2 } },
    });
  });

  it("ignores the script while disabled", async () => {
    const block = new ResponseBlock(context(), {
      httpCode: "200",
      transformEnabled: false,
      transformScript: "return 'nope';",
      blockName: "",
      blockDescription: "",
    });
    const result = await block.executeAsync("raw");
    expect(result.output!.body).toBe("raw");
  });

  it("fails when the script throws", async () => {
    const block = new ResponseBlock(context(), {
      httpCode: "200",
      transformEnabled: true,
      transformScript: "throw new Error('bad shape');",
      blockName: "",
      blockDescription: "",
    });
    const result = await block.executeAsync({});
    expect(result.successful).toBe(false);
    expect(result.error).toContain("bad shape");
  });
});
