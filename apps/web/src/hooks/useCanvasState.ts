import { notifications } from "@mantine/notifications";
import { useCanvasBlocksStore, useCanvasEdgesStore } from "@/store/canvas";
import { useEditorChangeTrackerStore } from "@/store/editor";
import { useBlockDataStore } from "@/store/blockDataStore";
import { routesService } from "@/services/routes";

export function useCanvasSave(routeId: string) {
  const blocks = useCanvasBlocksStore();
  const edges = useCanvasEdgesStore();
  const changeTracker = useEditorChangeTrackerStore();
  const blockDataStore = useBlockDataStore();

  async function onSave() {
    const notificationId = "canvas-save-success";

    try {
      const blocksMap = new Map(blocks.map((b) => [b.id, b]));
      const edgesMap = new Map(edges.map((e) => [e.id, e]));

      const blockActionsToPerform: {
        id: string;
        action: "upsert" | "delete";
      }[] = [];
      const edgeActionsToPerform: {
        id: string;
        action: "upsert" | "delete";
      }[] = [];
      const blocksToSave: typeof blocks = [];
      const edgesToSave: typeof edges = [];

      changeTracker.tracker.forEach((value, key) => {
        if (value === "block") {
          const exists = blocksMap.has(key);
          blockActionsToPerform.push({
            id: key,
            action: exists ? "upsert" : "delete",
          });
          if (exists) {
            blocksToSave.push({
              ...blocksMap.get(key)!,
              data: blockDataStore[key],
            });
          }
        } else if (value === "edge") {
          const exists = edgesMap.has(key);
          edgeActionsToPerform.push({
            id: key,
            action: exists ? "upsert" : "delete",
          });
          if (exists) edgesToSave.push(edgesMap.get(key)!);
        }
      });

      notifications.show({
        id: notificationId,
        loading: true,
        message: "Saving...",
        color: "violet",
        withCloseButton: true,
      });

      await routesService.saveCanvasItems(routeId, {
        actionsToPerform: {
          blocks: blockActionsToPerform,
          edges: edgeActionsToPerform,
        },
        changes: {
          blocks: blocksToSave,
          edges: edgesToSave.map((edge) => ({
            id: edge.id,
            fromHandle: edge.sourceHandle,
            toHandle: edge.targetHandle,
            from: edge.source,
            to: edge.target,
          })),
        },
      });

      changeTracker.reset();
      notifications.update({
        id: notificationId,
        loading: false,
        message: "Successfully saved",
        color: "green",
        withCloseButton: true,
      });
    } catch {
      notifications.update({
        id: notificationId,
        loading: false,
        color: "red",
        message: "Failed to save",
        withCloseButton: true,
      });
    }
  }

  return { onSave };
}
