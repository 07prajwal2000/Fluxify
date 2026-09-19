import { CustomError } from "./customError";

export class ConflictError extends CustomError {
	public readonly httpCode = 409;
	constructor(message: string) {
		super({
			type: "regular",
			message,
		});
	}
}
