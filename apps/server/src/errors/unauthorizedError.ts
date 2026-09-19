import { CustomError } from "./customError";

export class UnauthorizedError extends CustomError {
	public readonly httpCode: number = 401;
	constructor(message: string) {
		super({ type: "auth", message });
	}
}
