import { CustomError } from "./customError";

export class BadRequestError extends CustomError {
	public readonly httpCode: number = 400;
	constructor(message: string) {
		super({
			type: "regular",
			message,
		});
	}
}
