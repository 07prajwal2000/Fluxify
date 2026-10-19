import { createContext, useContext } from "react";
import type { CompileTarget } from "./diagnostics/useCompileDiagnostics";

export type CanvasResourceType = CompileTarget["resourceType"];

/** What the canvas edits, so the entrypoint can show where the flow starts. Routes by default. */
export const CanvasResourceContext = createContext<CanvasResourceType>("route");

export const useCanvasResourceType = () => useContext(CanvasResourceContext);
