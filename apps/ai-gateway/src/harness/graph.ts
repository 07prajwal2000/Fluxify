import { StateGraph, END, START } from "@langchain/langgraph";
import { GraphState, type GlobalGraphState } from "./types";
import { RouterAgent } from "./agents";

const workflow = new StateGraph(GraphState)
  .addNode("router", async (state: GlobalGraphState) => {
    const agent = new RouterAgent(state);
    return await agent.execute();
  })
  .addEdge(START, "router")
  .addEdge("router", END);

export const app = workflow.compile();
