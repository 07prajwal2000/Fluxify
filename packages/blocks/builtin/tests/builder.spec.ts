import { describe, it, expect } from "bun:test";
import { BlockBuilder, blockDTOSchema, edgeDTOSchema } from "../../builder";
import { BlockTypes } from "../../blockTypes";
import { Context } from "../../baseBlock";
import { JsVM } from "@fluxify/lib";
import crypto from "crypto";

// Helper to generate a valid UUIDv7 for tests
function uuidv7(): string {
  // Simple mock of a V7 UUID or just use a known valid one
  // V7: timestamp(48) - ver(4)rand(12) - var(2)rand(62)
  // Let's force a valid structure.
  // 017f22e2-79b0-7d39-b1d6-b08e7b99878e is a valid v7 example.
  // We can randomize parts if needed, but for schematic validation, format matters.
  // Unix timestamp 48 bits: Date.now()
  const ts = Date.now().toString(16).padStart(12, "0");
  const ver = "7";
  const randA = crypto.getRandomValues(new Uint8Array(2));
  const randB = crypto.getRandomValues(new Uint8Array(8));

  // Custom construction to satisfy v7 regex/logic if strict
  return "017f22e2-79b0-7d39-b1d6-b08e7b99878" + Math.floor(Math.random() * 10);
  // Actually simpler: just return a static valid v7 from an online generator for now to pass schema.
  return "018e9c63-4a21-7ecb-870d-df5e4a42636c"; // Valid v7
}

function createContext(): Context {
  const vars: Record<string, any> = {};
  return {
    vm: new JsVM(vars),
    route: "/test",
    apiId: "api-1",
    projectId: "proj-1",
    vars: vars as any,
    stopper: { timeoutEnd: 0, duration: 10000 },
  };
}

describe("BlockBuilder", () => {
  describe("loadEdges()", () => {
    it("should load edges correctly and create an edges map", () => {
      const ctx = createContext();
      const builder = new BlockBuilder(
        ctx,
        { create: () => ({}) as any },
        { create: () => ({}) as any },
      );
      const fromId = uuidv7();
      const toId = uuidv7();
      const edgeId = uuidv7();

      builder.loadEdges([
        {
          id: edgeId,
          from: fromId,
          to: toId,
          fromHandle: "output",
          toHandle: "source",
        },
      ]);

      const edges = builder.getEdges();
      expect(edges[fromId]).toBeDefined();
      expect(edges[fromId]).toHaveLength(1);
      expect(edges[fromId][0].to).toBe(toId);
      expect(edges[fromId][0].handle).toBe("source");
    });

    it("should group multiple edges from the same source", () => {
      const ctx = createContext();
      const builder = new BlockBuilder(
        ctx,
        { create: () => ({}) as any },
        { create: () => ({}) as any },
      );
      const fromId = uuidv7();
      const to1 = uuidv7();
      const to2 = uuidv7();

      builder.loadEdges([
        {
          id: uuidv7(),
          from: fromId,
          to: to1,
          fromHandle: "output",
          toHandle: "source",
        },
        {
          id: uuidv7(),
          from: fromId,
          to: to2,
          fromHandle: "output",
          toHandle: "source",
        },
      ]);

      const edges = builder.getEdges();
      expect(edges[fromId]).toHaveLength(2);
    });

    it("should extract handle suffix from UUID-prefixed toHandle", () => {
      const ctx = createContext();
      const builder = new BlockBuilder(
        ctx,
        { create: () => ({}) as any },
        { create: () => ({}) as any },
      );
      const from = uuidv7();
      const to = uuidv7();

      // Simulates a handle like "uuid-source" where UUID is stripped
      builder.loadEdges([
        {
          id: uuidv7(),
          from,
          to,
          fromHandle: "out",
          toHandle: `${uuidv7()}-source`,
        },
      ]);

      const edges = builder.getEdges();
      expect(edges[from][0].handle).toBe("source");
    });
  });

  describe("loadBlocks()", () => {
    it("should identify entrypoint block", () => {
      const ctx = createContext();
      const builder = new BlockBuilder(
        ctx,
        { create: () => ({}) as any },
        { create: () => ({}) as any },
      );

      const entrypointId = uuidv7();
      builder.loadBlocks([
        {
          id: entrypointId,
          type: BlockTypes.entrypoint,
          data: {},
          position: { x: 0, y: 0 },
        },
      ]);

      expect(builder.getEntrypoint()).toBe(entrypointId);
    });

    it("should identify error handler block", () => {
      const ctx = createContext();
      const builder = new BlockBuilder(
        ctx,
        { create: () => ({}) as any },
        { create: () => ({}) as any },
      );

      const errorId = uuidv7();
      builder.loadBlocks([
        {
          id: errorId,
          type: BlockTypes.errorHandler,
          data: {},
          position: { x: 0, y: 0 },
        },
      ]);

      expect(builder.getErrorHandlerId()).toBe(errorId);
    });
  });
});

describe("Schema Validation", () => {
  it("blockDTOSchema should accept valid block data", () => {
    const validBlock = {
      id: uuidv7(),
      type: BlockTypes.response,
      data: { httpCode: "200" },
      position: { x: 100, y: 200 },
    };
    const result = blockDTOSchema.safeParse(validBlock);
    expect(result.success).toBe(true);
  });

  it("blockDTOSchema should accept custom block type string", () => {
    const invalidBlock = {
      id: uuidv7(),
      type: "nonexistent_block_type",
      data: {},
      position: { x: 0, y: 0 },
    };
    const result = blockDTOSchema.safeParse(invalidBlock);
    expect(result.success).toBe(true);
  });

  it("edgeDTOSchema should accept valid edge array", () => {
    const edges = [
      {
        id: uuidv7(),
        from: "block-1",
        to: "block-2",
        fromHandle: "output",
        toHandle: "source",
      },
    ];
    const result = edgeDTOSchema.safeParse(edges);
    expect(result.success).toBe(true);
  });
});
