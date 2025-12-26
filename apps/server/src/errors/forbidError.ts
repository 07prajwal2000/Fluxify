import { CustomError } from "./customError";

export class ForbiddenError extends CustomError {
  public readonly httpCode: number = 403;
  /**
   * Default: Access Denied
   * @param message Error message
   */
  constructor(message: string = "Access denied") {
    super({ type: "auth", message });
  }
}
