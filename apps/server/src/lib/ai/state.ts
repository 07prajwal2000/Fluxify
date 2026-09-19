import { BaseAiIntegration } from "@fluxify/adapters";
import { StateSchema } from "@langchain/langgraph";
import { AIMessage, HumanMessage, SystemMessage } from "langchain";
import z from "zod";
import { integrationsGroupSchema } from "../../api/v1/integrations/schemas";
import {
	BlockSchema,
	BuilderOutputSchema,
	ClassifierOutputSchema,
	DiscussionOutputSchema,
	PlannerOutputSchema,
} from "./schemas";
import { AiChatTracker } from "./tracker";

export const AgentStateSchema = new StateSchema({
	messages: z.array(
		z.instanceof(AIMessage).or(z.instanceof(HumanMessage)).or(z.instanceof(SystemMessage)),
	),
	tracker: z.instanceof(AiChatTracker).optional(),
	clarificationQuestion: z.string().optional(),
	userPrompt: z.string(),
	classifierOutput: ClassifierOutputSchema,
	buildMode: z
		.object({
			plannerOutput: PlannerOutputSchema.optional(),
			builderOutput: BuilderOutputSchema.optional(),
		})
		.optional(),
	discussionMode: DiscussionOutputSchema.optional(),
	modelFactory: z.instanceof(BaseAiIntegration),
	metadata: z.object({
		integrationsList: z.array(
			z.object({
				id: z.string(),
				name: z.string(),
				group: integrationsGroupSchema,
				variant: z.string(),
			}),
		),
		configsList: z.array(
			z.object({
				name: z.string(),
				description: z.string(),
			}),
		),
		route: z.object({
			id: z.string(),
			name: z.string(),
			method: z.string(),
			path: z.string(),
			canvasItems: z.array(BlockSchema),
		}),
		userId: z.string(),
	}),
});
