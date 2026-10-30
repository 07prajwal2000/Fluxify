/**
 * One node of the SSE container test (`sseRuntime.test.ts`), in its own
 * process: serves a compiled route whose JS block connects, wired the way
 * `serveRoute` wires it. Prints `READY <port>` once it listens.
 *
 * argv[2]: JSON `{ projectId, brokerId, group, config }`.
 */
import { compileGraph } from "@fluxify/blocks";
import { hydrateIntegrations, OWNER_KEY } from "../../../loaders/integrationsLoader";
import { setBlocksExecutor } from "../executor";
import { createHttpContext } from "../httpContext";
import { executeRouteInternal } from "../service";
import { sseResponse, streamOrResult } from "../sse";
import { routeGraph } from "./sseGraphs";

const { projectId, brokerId, group, config } = JSON.parse(process.argv[2]!);
hydrateIntegrations(projectId, { [group]: { [brokerId]: { ...config, [OWNER_KEY]: projectId } } });

const { blocks, edges } = routeGraph();
const { run } = compileGraph(blocks, edges);
setBlocksExecutor((_target, context) => run(context, context.requestBody));

const server: ReturnType<typeof Bun.serve> = Bun.serve({
	port: 0,
	async fetch(request): Promise<Response> {
		const ctx = createHttpContext(request);
		const url = new URL(request.url);
		const outcome = await streamOrResult(request, server, () =>
			executeRouteInternal(
				{ id: "route_sse", projectId, projectName: "SSE", timeoutSeconds: 120, sseBrokerId: brokerId },
				{
					method: "GET",
					path: url.pathname,
					headers: {},
					query: Object.fromEntries(url.searchParams),
					body: null,
					params: {},
				},
				ctx as any,
			),
		);
		if ("body" in outcome) return sseResponse(outcome.body, ctx.responseHeaders);
		return Response.json(outcome.result.data, { status: outcome.result.status });
	},
});
console.log(`READY ${server.port}`);
