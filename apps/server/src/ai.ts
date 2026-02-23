import { OpenAICompatibleIntegration } from "@fluxify/adapters";
import { aiAgentGraph } from "./lib/ai";
import { ToolsContext } from "./lib/ai/schemas";

const localModel = new OpenAICompatibleIntegration({
  apiKey: "local",
  model: "Qwen3-4B.gguf",
  baseUrl: "http://localhost:8090/v1/",
});

const cloudModel = new OpenAICompatibleIntegration({
  apiKey: process.env.AI_API_KEY!,
  model: "mimo-v2-flash",
  baseUrl: "https://api.xiaomimimo.com/v1",
});

const userPrompt =
  "build me get single todo item by id from database and use todos table. If the todo is not found, return 404 and a message saying 'Todo not found' else return the todo item.";

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
    interruption: false,
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
        canvasItems: [],
      },
      userId: "user_1",
    },
  },
  { context: { toolCalls: new Set() } satisfies ToolsContext },
);

console.log(
  result.classifierOutput.intent === "DISCUSSION"
    ? result.discussionMode!.output
    : JSON.stringify(result.buildMode?.builderOutput, null, 2),
);
