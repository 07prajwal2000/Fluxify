import { OpenAICompatibleIntegration } from "@fluxify/adapters";
import { aiAgentGraph } from "./lib/ai";
import { ToolsContext } from "./lib/ai/schemas";
import { BlockTypes } from "@fluxify/blocks";
import { mapBuilderOutput } from "./lib/ai/responseMapper";

import { logger } from "@fluxify/common";
import { getEnv } from "./lib/env";

const cloudModel = new OpenAICompatibleIntegration({
  apiKey: getEnv("AI_API_KEY")!,
  model: "mistral-medium-3-5",
  baseUrl: "https://api.mistral.ai/v1",
});

const userPrompt = "what is get single db block";
//   "build me get single todo item by id from database and use todos table. If the todo is not found, return 404 and a message saying 'Todo not found' else return the todo item.";

const result = await aiAgentGraph.invoke(
  {
    modelFactory: cloudModel,
    userPrompt,
    buildMode: {},
    clarificationQuestion: "",
    classifierOutput: {
      intent: "DISCUSSION",
      reasoning: "",
    },
    messages: [],
    metadata: {
      integrationsList: [
        {
          id: "PG_1",
          group: "database",
          name: "Postgres",
          variant: "postgres",
        },
      ],
      configsList: [],
      route: {
        id: "route_1",
        name: "Get Todos",
        method: "GET",
        path: "/todos/:id",
        canvasItems: [
          {
            id: "item_1",
            blockType: BlockTypes.entrypoint,
            connections: [{ blockId: "item_2", handle: "source" }],
            position: {
              x: 0,
              y: 0,
            },
            blockName: "Entrypoint",
            blockDescription: "Entrypoint",
          },
          {
            id: "item_2",
            blockType: BlockTypes.jsrunner,
            connections: [],
            position: {
              x: 0,
              y: 0,
            },
            blockName: "JSRunner",
            blockDescription: "HTTP",
            data: {
              value: "logger.logInfo('Hello World');",
            },
          },
        ],
      },
      userId: "user_1",
    },
  },
  { context: { toolCalls: new Set() } satisfies ToolsContext },
);

logger.info("AI discussion mode result", "ai", { discussionMode: result.discussionMode });

// console.log(
//   result.classifierOutput.intent === "DISCUSSION"
//     ? result.discussionMode!.output
//     : JSON.stringify(
//         mapBuilderOutput(result.buildMode?.builderOutput!),
//         null,
//         2,
//       ),
// );
