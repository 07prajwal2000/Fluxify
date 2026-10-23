// Bundled by hostPackages.spec.ts the way the worker image bundles the
// execution process, then run with no node_modules anywhere around it.
import * as sdkBlocks from "@fluxify/sdk/blocks";
import { generateText } from "ai";
import { z } from "zod";
import { provideHostPackages } from "../hostPackages";

provideHostPackages();
const plugin = await import(process.argv[2]!);
console.log(JSON.stringify({ block: plugin.block === sdkBlocks.block, z: plugin.z === z, ai: plugin.generateText === generateText, out: plugin.default.name }));
