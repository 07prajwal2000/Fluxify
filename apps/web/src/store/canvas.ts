import { BaseBlockType, BlockTypes, EdgeType } from "@/types/block";
import {
  applyEdgeChanges,
  applyNodeChanges,
  EdgeChange,
  NodeChange,
} from "@xyflow/react";
import { create } from "zustand";
import dagre from "@dagrejs/dagre";

type State = {
  blocks: BaseBlockType[];
  edges: EdgeType[];
};

type Actions = {
  actions: {
    blocks: {
      addBlock: (block: BaseBlockType) => void;
      deleteBlock: (id: string) => void;
      onBlockChange: (changes: NodeChange[]) => void;
      formatBlocks(): string[];
      deleteBulk(ids: Set<string>): void;
      setSelection(ids: string[], value: boolean): void;
    };
    edges: {
      addEdge: (edge: EdgeType) => void;
      deleteEdge: (id: string) => void;
      onEdgeChange: (changes: Partial<EdgeChange>[]) => void;
      deleteBulk(ids: Set<string>): void;
      setSelection(ids: string[], value: boolean): void;
    };
    bulkInsert(blocks: BaseBlockType[], edges: EdgeType[]): void;
  };
};

const useCanvasStore = create<State & Actions>((set, get) => ({
  blocks: [],
  edges: [],
  actions: {
    blocks: {
      formatBlocks() {
        const blocksToFormat = get().blocks.filter(
          (block) => block.type !== BlockTypes.stickynote
        );
        const stickyNoteBlocks = get().blocks.filter(
          (block) => block.type === BlockTypes.stickynote
        );
        const dagreGraph = new dagre.graphlib.Graph().setDefaultEdgeLabel(
          () => ({})
        );
        dagreGraph.setGraph({ rankdir: "TB", ranksep: 10 });
        blocksToFormat.forEach((block) => {
          dagreGraph.setNode(block.id, { width: 100, height: 100 });
        });
        get().edges.forEach((edge) => {
          dagreGraph.setEdge(edge.source, edge.target);
        });
        dagre.layout(dagreGraph);
        const blocks = blocksToFormat.map((block) => {
          const node = dagreGraph.node(block.id);
          return { ...block, position: { x: node.x, y: node.y } };
        });
        const finalBlocks = blocks.concat(stickyNoteBlocks);
        set({ blocks: finalBlocks });
        return blocksToFormat.map((b) => b.id);
      },
      addBlock(block) {
        set({ blocks: [...get().blocks, block] });
      },
      deleteBlock(id) {
        set({
          blocks: get().blocks.filter((b) => {
            const isEntrypoint = b.type === BlockTypes.entrypoint;
            if (isEntrypoint) {
              return true;
            }
            return b.id !== id;
          }),
        });
      },
      setSelection(ids: string[], value: boolean) {
        const idSet = new Set(ids);
        set({
          blocks: get().blocks.map((b) => {
            const valueToSet = idSet.has(b.id) ? value : !value;
            return { ...b, selected: valueToSet };
          }),
        });
      },
      deleteBulk(ids: Set<string>) {
        set({
          blocks: get().blocks.filter((b) => {
            const isEntrypoint = b.type === BlockTypes.entrypoint;
            if (isEntrypoint) {
              return true;
            }
            return !ids.has(b.id);
          }),
        });
      },
      onBlockChange(changes) {
        set({
          blocks: applyNodeChanges(
            changes,
            get().blocks as any
          ) as BaseBlockType[],
        });
      },
    },
    edges: {
      addEdge(edge) {
        set({ edges: [...get().edges, edge] });
      },
      deleteBulk(ids: Set<string>) {
        set({ edges: get().edges.filter((e) => !ids.has(e.id)) });
      },
      deleteEdge(id) {
        set({ edges: get().edges.filter((e) => e.id !== id) });
      },
      onEdgeChange(changes) {
        set({ edges: applyEdgeChanges(changes as any, get().edges) });
      },
      setSelection(ids: string[], value: boolean) {
        const idSet = new Set(ids);
        set({
          edges: get().edges.map((e) => {
            const valueToSet = idSet.has(e.id) ? value : !value;
            return { ...e, selected: valueToSet };
          }),
        });
      },
    },
    bulkInsert(blocks, edges) {
      set({ blocks: [...blocks] });
      set({ edges: [...edges] });
    },
  },
}));

export const useCanvasActionsStore = () =>
  useCanvasStore((state) => state.actions);
export const useCanvasBlocksStore = () =>
  useCanvasStore((state) => state.blocks);
export const useCanvasEdgesStore = () => useCanvasStore((state) => state.edges);
