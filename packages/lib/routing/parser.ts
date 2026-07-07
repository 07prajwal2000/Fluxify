export type HttpRoute = {
  routeId: string;
  projectId: string;
  projectName: string;
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  bodySchema?: any;
  querySchema?: any;
  paramsSchema?: any;
};

export type RouteTree = {
  subPath: string;
  isParam: boolean;
  children: Record<string, RouteTree>;
  id?: string;
  projectId?: string;
  projectName?: string;
  bodySchema?: any;
  querySchema?: any;
  paramsSchema?: any;
};

export class HttpRouteParser {
  private routesTree: Record<string, RouteTree> = {};
  public rebuildRoutes(routes: HttpRoute[]) {
    this.routesTree = {};
    this.buildRoutes(routes);
  }
  public buildRoutes(routes: HttpRoute[]) {
    for (let route of routes) {
      let current = this.routesTree;
      const path = route.path;
      const parts = path.split("/").filter((p) => p.trim() != "");
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
      for (let part of parts) {
        let route = part;
        const isParam = route.startsWith(":");
        if (isParam) {
          route = route.slice(1);
        }
        if (route in current) {
          current = current[route].children;
        } else {
          current[route] = {
            subPath: route,
            isParam,
            children: {},
          };
          current = current[route].children;
        }
      }
      current["<ID>"] = {
        children: {},
        isParam: false,
        subPath: "",
        id: route.routeId,
        projectId: route.projectId,
        projectName: route.projectName,
        bodySchema: route.bodySchema,
        querySchema: route.querySchema,
        paramsSchema: route.paramsSchema,
      };
    }
  }
  public getRouteId(
    path: string,
    method: HttpRoute["method"],
  ): {
    id: string;
    routeParams?: Record<string, string>;
    projectId: string;
    projectName: string;
    bodySchema?: any;
    querySchema?: any;
    paramsSchema?: any;
  } | null {
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
      return {
        id: current["<ID>"].id!,
        routeParams: params,
        projectId: current["<ID>"].projectId!,
        projectName: current["<ID>"].projectName!,
        bodySchema: current["<ID>"].bodySchema,
        querySchema: current["<ID>"].querySchema,
        paramsSchema: current["<ID>"].paramsSchema,
      };
    }
    return null;
  }
}
