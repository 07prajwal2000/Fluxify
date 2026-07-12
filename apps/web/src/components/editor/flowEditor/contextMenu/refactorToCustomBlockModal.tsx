import React, { useContext, useState } from "react";
import { Modal, Button, TextInput, Textarea, Stack, Group, Select } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { customBlocksService } from "@/services/customBlocks";
import { customBlocksQueries } from "@/query/customBlocksQuery";
import { useFlowEditorContext } from "../flowEditorContext";
import { useReactFlow } from "@xyflow/react";
import { useBlockDataStore } from "@/store/blockDataStore";
import { BlockCanvasContext } from "@/context/blockCanvas";
import { notifications } from "@mantine/notifications";

interface Props {
  opened: boolean;
  onClose: () => void;
  selectedBlocks: string[];
}

export default function RefactorToCustomBlockModal({ opened, onClose, selectedBlocks }: Props) {
  const { projectId } = useFlowEditorContext();
  const queryClient = useQueryClient();
  const { getNodes, getEdges } = useReactFlow();
  const blockDataStore = useBlockDataStore();
  const { deleteBulk, addBlock } = useContext(BlockCanvasContext);

  const form = useForm({
    initialValues: {
      name: "",
      label: "",
      description: "",
      icon: "api",
      iconUrl: "",
    },
    validate: {
      name: (val) =>
        val.length > 0
          ? /^[a-z0-9_.]+$/.test(val)
            ? null
            : "Lowercase letters, numbers, dots, and underscores only"
          : "Name is required",
      label: (val) => (val.length > 0 ? null : "Label is required"),
      iconUrl: (val, values) =>
        values.icon === "custom" && !val ? "Icon URL is required" : null,
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: typeof form.values) => {
      // 1. Create the custom block
      const createPayload = {
        name: values.name,
        label: values.label,
        description: values.description,
        icon: values.icon === "custom" ? ("custom" as const) : ("premade-list" as const),
        iconUrl: values.icon === "custom" ? values.iconUrl : values.icon,
        projectId: projectId!,
        inputParams: [],
      };
      const createdBlock = await customBlocksService.create(createPayload);
      const newBlockId = createdBlock.id;

      // 2. Prepare canvas payload for the new custom block
      const allNodes = getNodes();
      const allEdges = getEdges();

      const nodesToMove = allNodes.filter((n) => selectedBlocks.includes(n.id));
      const edgesToMove = allEdges.filter(
        (e) => selectedBlocks.includes(e.source) && selectedBlocks.includes(e.target)
      );

      const blockActionsToPerform = nodesToMove.map((b) => ({ id: b.id, action: "upsert" as const }));
      const edgeActionsToPerform = edgesToMove.map((e) => ({ id: e.id, action: "upsert" as const }));

      const blocksToSave = nodesToMove.map((b) => ({
        id: b.id,
        type: b.type!,
        position: b.position,
        data: blockDataStore[b.id],
      }));

      const savePayload = {
        actionsToPerform: {
          blocks: blockActionsToPerform,
          edges: edgeActionsToPerform,
        },
        changes: {
          blocks: blocksToSave,
          edges: edgesToMove.map((edge) => ({
            id: edge.id,
            fromHandle: edge.sourceHandle,
            toHandle: edge.targetHandle,
            from: edge.source,
            to: edge.target,
          })),
        },
      };

      // 3. Save to new custom block canvas
      await customBlocksService.saveCanvasItems(newBlockId, savePayload);
      
      return { createdBlock, nodesToMove, edgesToMove };
    },
    onSuccess: ({ createdBlock, nodesToMove, edgesToMove }, variables) => {
      // 4. Invalidate queries to update custom blocks list
      customBlocksQueries.getAll.invalidate(queryClient, projectId!);

      // 5. Replace selected blocks in the current canvas with the new custom block
      // Calculate center of selected blocks
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodesToMove.forEach(n => {
        if (n.position.x < minX) minX = n.position.x;
        if (n.position.y < minY) minY = n.position.y;
        if (n.position.x > maxX) maxX = n.position.x;
        if (n.position.y > maxY) maxY = n.position.y;
      });
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      deleteBulk(selectedBlocks, "block");
      
      // Some edges might have been connected to the outside, deleting them too
      // `deleteBulk` on blocks might automatically remove edges, but let's be safe.
      const allEdges = getEdges();
      const edgesConnectedToDeletedBlocks = allEdges.filter(
        (e) => selectedBlocks.includes(e.source) || selectedBlocks.includes(e.target)
      ).map(e => e.id);
      if (edgesConnectedToDeletedBlocks.length > 0) {
        deleteBulk(edgesConnectedToDeletedBlocks, "edge");
      }

      addBlock({
        id: crypto.randomUUID(),
        type: variables.name,
        position: { x: centerX, y: centerY },
      } as any);

      notifications.show({
        title: "Success",
        message: "Successfully refactored to custom block",
        color: "green",
      });
      onClose();
    },
    onError: (error: any) => {
      notifications.show({
        title: "Error",
        message: error.message || "Failed to refactor",
        color: "red",
      });
    },
  });

  return (
    <Modal
      opened={opened}
      onClose={() => !mutation.isPending && onClose()}
      title="Refactor to Custom Block"
      closeOnClickOutside={!mutation.isPending}
      closeOnEscape={!mutation.isPending}
      withCloseButton={!mutation.isPending}
    >
      <form onSubmit={form.onSubmit((values) => mutation.mutate(values))}>
        <Stack gap="md">
          <TextInput
            label="Name"
            description="Lowercase letters, numbers, dots, and underscores only. Cannot be changed later."
            placeholder="e.g. process_data"
            required
            disabled={mutation.isPending}
            {...form.getInputProps("name")}
          />
          <TextInput
            label="Label"
            placeholder="e.g. Process Data"
            required
            disabled={mutation.isPending}
            {...form.getInputProps("label")}
          />
          <Textarea
            label="Description"
            placeholder="What does this block do?"
            disabled={mutation.isPending}
            {...form.getInputProps("description")}
          />
          <Select
            label="Icon"
            placeholder="Select an icon"
            required
            disabled={mutation.isPending}
            data={[
              { value: "python", label: "Python" },
              { value: "javascript", label: "JavaScript" },
              { value: "database", label: "Database" },
              { value: "cloud", label: "Cloud" },
              { value: "mail", label: "Mail" },
              { value: "message", label: "Message" },
              { value: "api", label: "API" },
              { value: "webhook", label: "Webhook" },
              { value: "lock", label: "Lock" },
              { value: "key", label: "Key" },
              { value: "custom", label: "Custom (Use URL)" },
            ]}
            {...form.getInputProps("icon")}
          />
          {form.values.icon === "custom" && (
            <TextInput
              label="Icon URL"
              required
              disabled={mutation.isPending}
              {...form.getInputProps("iconUrl")}
            />
          )}
          <Group justify="flex-end" mt="md">
            <Button variant="subtle" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending} color="violet">
              Create
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
