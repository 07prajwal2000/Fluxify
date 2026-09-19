import { CustomError } from "./customError";

export class NotFoundError extends CustomError {
	public readonly httpCode: number = 404;
	constructor(message: string) {
		super({
			type: "regular",
			message,
		});
	}
}
