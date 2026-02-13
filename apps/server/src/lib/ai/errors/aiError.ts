export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiError";
  }
}
