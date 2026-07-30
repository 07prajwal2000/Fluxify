import type { EdgeTypes } from "@xyflow/react";
import { FlowEdge } from "./FlowEdge";

/** Edge type key stored on edges rendered by the canvas. */
export const FLOW_EDGE_TYPE = "flow";

export const DEFAULT_EDGE_TYPES: EdgeTypes = { [FLOW_EDGE_TYPE]: FlowEdge };

export { FlowEdge };
