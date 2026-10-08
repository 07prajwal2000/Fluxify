import { createContext, useContext } from "react";

/** source of the diagnostic a failed test call leaves on its block */
export const RUNTIME_ERROR_SOURCE = "runtime-error";

type ShowBlockError = (blockId: string, message: string) => void;

const BlockErrorFocusContext = createContext<ShowBlockError | undefined>(undefined);

export const BlockErrorFocusProvider = BlockErrorFocusContext.Provider;

/**
 * Shows a run's error on its block: selects it and opens its Diagnostics tab.
 * Undefined outside a canvas, so callers there show the block as plain text.
 */
export const useBlockErrorFocus = () => useContext(BlockErrorFocusContext);
