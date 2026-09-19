import { END, START, StateGraph } from "@langchain/langgraph";
import { BUILDER_NODE_ID, BuilderNode } from "./nodes/builder";
import {
	CLASSIFIER_NODE_ID,
	ClassifierConditionalNodeRouter,
	ClassifierNode,
} from "./nodes/classifier";
import { DISCUSSION_NODE_ID, DiscussionNode } from "./nodes/discussion";
import { PLANNER_NODE_ID, PlannerConditionalNodeRouter, PlannerNode } from "./nodes/planner";
import { AgentStateSchema } from "./state";

const graph = new StateGraph(AgentStateSchema);
graph
	.addNode(CLASSIFIER_NODE_ID, ClassifierNode)
	.addNode(DISCUSSION_NODE_ID, DiscussionNode)
	.addNode(PLANNER_NODE_ID, PlannerNode)
	.addNode(BUILDER_NODE_ID, BuilderNode)
	.addEdge(START, CLASSIFIER_NODE_ID)
	.addConditionalEdges(CLASSIFIER_NODE_ID, ClassifierConditionalNodeRouter)
	.addConditionalEdges(PLANNER_NODE_ID, PlannerConditionalNodeRouter)
	.addEdge(PLANNER_NODE_ID, BUILDER_NODE_ID)
	.addEdge(PLANNER_NODE_ID, END)
	.addEdge(BUILDER_NODE_ID, END)
	.addEdge(DISCUSSION_NODE_ID, END);

export const aiAgentGraph = graph.compile();
