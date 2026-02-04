import z from "zod";
import {
  integrationsGroupSchema,
  observabilityVariantSchema,
} from "../api/v1/integrations/schemas";
import { observabilityIntegrationsCache } from "./integrationsLoader";
import { LokiLogger, OpenObserve } from "@fluxify/adapters";
import { BadRequestError } from "../errors/badRequestError";

export class IntegrationFactory {
  private readonly cache: Record<string, any> = {};

  public createIntegrationObject(options: {
    integrationId: string;
    type: string;
    path: {
      routeId: string;
      projectId: string;
      projectName: string;
    };
  }) {
    if (options.integrationId in this.cache)
      return this.cache[options.integrationId];

    switch (options.type as z.infer<typeof integrationsGroupSchema>) {
      case "database":
        break;
      case "kv":
        break;
      case "ai":
        break;
      case "baas":
        break;
      case "observability":
        return (this.cache[options.integrationId] =
          this.createObservibilityIntegration(
            observabilityIntegrationsCache[options.integrationId],
            options.path,
          ));
    }
  }
  private createObservibilityIntegration(
    data: any,
    path: {
      routeId: string;
      projectId: string;
      projectName: string;
    },
  ) {
    const type = data.variant;
    switch (type as z.infer<typeof observabilityVariantSchema>) {
      case "Open Observe":
        return new OpenObserve({
          ...data,
          projectId: path.projectName,
          routeId: path.routeId,
        });
      case "Loki":
        return new LokiLogger({
          ...data,
          projectId: path.projectName,
          routeId: path.routeId,
        });
      default:
        throw new BadRequestError("Integration not found");
    }
  }
}
