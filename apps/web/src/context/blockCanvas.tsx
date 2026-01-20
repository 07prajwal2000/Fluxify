import { BlockTypes } from "@/types/block";
import { createContext } from "react";

export const BlockCanvasContext = createContext<{
  undo: () => void;
  redo: () => void;
  deleteBlock: (id: string) => void;
  deleteEdge: (id: string) => void;
  addBlock: (block: BlockTypes) => void;
  updateBlockData: (id: string, data: any) => void;
  openBlock: (id: string) => void;
  duplicateBlock: (id: string) => void;
  deleteBulk: (ids: string[], type: "block" | "edge") => void;
  onSave: () => Promise<void>;
  duplicateSelection: (blockIds: string[]) => void;
}>({} as any);
