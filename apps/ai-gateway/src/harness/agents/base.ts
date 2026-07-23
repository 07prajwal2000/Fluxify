import type { GlobalGraphState } from "../types";

export abstract class BaseAgent {
  protected state: GlobalGraphState;

  constructor(state: GlobalGraphState) {
    this.state = state;
  }

  abstract execute(): Promise<Partial<GlobalGraphState>>;
}
