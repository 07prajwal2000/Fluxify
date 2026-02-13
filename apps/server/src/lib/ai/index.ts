import { END, START, StateGraph } from "@langchain/langgraph";
import { AgentStateSchema } from "./state";
import { PLANNER_NODE_ID, PlannerNode } from "./nodes/planner";
import {
  CLASSIFIER_NODE_ID,
  ClassifierConditionalNodeRouter,
  ClassifierNode,
} from "./nodes/classifier";
import { DISCUSSION_NODE_ID, DiscussionNode } from "./nodes/discussion";

export function createAiAgentGraph() {
  const graph = new StateGraph(AgentStateSchema);
  graph
    .addNode(CLASSIFIER_NODE_ID, ClassifierNode)
    .addNode(DISCUSSION_NODE_ID, DiscussionNode)
    .addNode(PLANNER_NODE_ID, PlannerNode)
    .addEdge(START, CLASSIFIER_NODE_ID)
    .addConditionalEdges(CLASSIFIER_NODE_ID, ClassifierConditionalNodeRouter)
    .addEdge(PLANNER_NODE_ID, END)
    .addEdge(DISCUSSION_NODE_ID, END);
  return graph.compile();
}
