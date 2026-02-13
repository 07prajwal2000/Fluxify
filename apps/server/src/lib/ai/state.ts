import { BaseAiIntegration } from "@fluxify/adapters";
import { StateSchema } from "@langchain/langgraph";
import { AIMessage, HumanMessage, SystemMessage } from "langchain";
import z from "zod";

export const ClassificationIntent = z.enum(["DISCUSSION", "BUILD"]);

export const AgentStateSchema = new StateSchema({
  messages: z.array(
    z
      .instanceof(AIMessage)
      .or(z.instanceof(HumanMessage))
      .or(z.instanceof(SystemMessage)),
  ),
  interruption: z.boolean().default(false),
  clarificationQuestion: z.string().optional(),
  userPrompt: z.string(),
  classifierOutput: z.object({
    intent: ClassificationIntent,
    reasoning: z.string(),
  }),
  buildMode: z
    .object({
      plannerOutput: z
        .object({
          status: z.enum(["success", "vague", "impossible"]),
          reasoning: z.string(),
          clarificationQuestion: z.string().optional(),
          plannedBlockIds: z.array(z.string()).default([]),
          plannedIntegrationIds: z.array(z.string()).default([]),
          plannedConfigIds: z.array(z.string()).default([]),
        })
        .optional(),
      builderOutput: z.object({}).optional(),
    })
    .optional(),
  discussionMode: z
    .object({
      output: z.string(),
      redirect: z.boolean(),
    })
    .optional(),
  modelFactory: z.instanceof(BaseAiIntegration),
  metadata: z.object({
    integrationsList: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
      }),
    ),
    configsList: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
      }),
    ),
    routeId: z.string(),
    userId: z.string(),
  }),
});
