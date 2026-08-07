export type HttpRoute = {
  routeId: string;
  projectId: string;
  projectName: string;
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  bodySchema?: any;
  querySchema?: any;
  paramsSchema?: any;
  timeoutSeconds?: number;
  /** body formats this route accepts; anything else is rejected with a 415 */
  acceptedContentTypes?: string[];
  /** spans exported to the project's OTEL destination; nothing is stored by us */
  tracingEnabled?: boolean;
  /** debug recording, persisted for the portal trace viewer; expensive */
  recordExecution?: boolean;
  /** identifies the graph a recorded run belongs to, for the portal overlay */
  routeVersion?: string;
};

export type RouteTree = {
  subPath: string;
  isParam: boolean;
  children: Record<string, RouteTree>;
  /** only set on a `<ID>` leaf — the matched route, carried whole */
  route?: HttpRoute;
};

export class HttpRouteParser {
  private routesTree: Record<string, RouteTree> = {};
  private readonly routesById = new Map<string, HttpRoute>();

  public rebuildRoutes(routes: HttpRoute[]) {
    this.routesTree = {};
    this.routesById.clear();
    this.buildRoutes(routes);
  }

  /** Adds or replaces one route without rebuilding unrelated route branches. */
  public upsertRoute(route: HttpRoute) {
    if (this.routesById.has(route.routeId)) {
      this.removeRoute(route.routeId);
    }
    this.routesById.set(route.routeId, route);

    let current = this.routesTree;
    if (route.method in current) {
      current = current[route.method].children;
    } else {
      current[route.method] = {
        children: {},
        isParam: false,
        subPath: "",
      };
      current = current[route.method].children;
    }
    for (let part of route.path.split("/").filter((p) => p.trim() != "")) {
      const isParam = part.startsWith(":");
      if (isParam) {
        part = part.slice(1);
      }
      if (part in current) {
        current = current[part].children;
      } else {
        current[part] = {
          subPath: part,
          isParam,
          children: {},
        };
        current = current[part].children;
      }
    }
    current["<ID>"] = {
      children: {},
      isParam: false,
      subPath: "",
      route,
    };
  }

  /** Removes one route and prunes only branches that no longer contain routes. */
  public removeRoute(routeId: string) {
    const route = this.routesById.get(routeId);
    if (!route) return;

    const branches: { parent: Record<string, RouteTree>; key: string }[] = [];
    let current = this.routesTree;
    const method = current[route.method];
    if (!method) {
      this.routesById.delete(routeId);
      return;
    }
    branches.push({ parent: current, key: route.method });
    current = method.children;

    for (let part of route.path.split("/").filter((p) => p.trim() != "")) {
      const key = part.startsWith(":") ? part.slice(1) : part;
      const branch = current[key];
      if (!branch) {
        this.routesById.delete(routeId);
        return;
      }
      branches.push({ parent: current, key });
      current = branch.children;
    }

    if (current["<ID>"]?.route?.routeId === routeId) {
      delete current["<ID>"];
      for (const { parent, key } of branches.toReversed()) {
        const branch = parent[key];
        if (Object.keys(branch.children).length > 0) break;
        delete parent[key];
      }
    }
    this.routesById.delete(routeId);
  }

  public buildRoutes(routes: HttpRoute[]) {
    for (const route of routes) this.upsertRoute(route);
  }
  public getRouteId(
    path: string,
    method: HttpRoute["method"],
  ): (HttpRoute & { id: string; routeParams?: Record<string, string> }) | null {
    const parts = path.split("/").filter((p) => p.trim() != "");
    let current = this.routesTree;
    const params: Record<string, string> = {};
    if (method in current) {
      current = current[method].children;
    } else {
      return null;
    }
    let match = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part in current) {
        current = current[part].children;
        match++;
        continue;
      }
      for (let key in current) {
        if (!current[key].isParam) continue;
        params[key] = part;
        match++;
        current = current[key].children;
        break;
      }
    }
    if (match == parts.length && "<ID>" in current) {
      const route = current["<ID>"].route!;
      // `id` is the historical name callers match on; keep it alongside routeId
      return { ...route, id: route.routeId, routeParams: params };
    }
    return null;
  }
}
