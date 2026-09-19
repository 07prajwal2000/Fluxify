import { CustomError } from "./customError";

export class ServerError extends CustomError {
	public readonly httpCode: number = 500;
	constructor(message: string) {
		super({
			type: "regular",
			message,
		});
	}
}
