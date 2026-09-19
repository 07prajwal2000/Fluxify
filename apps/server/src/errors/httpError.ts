import { CustomError } from "./customError";

export class HttpError extends CustomError {
	public readonly httpCode: number = 0;
	constructor(
		public readonly code: number,
		message?: string,
	) {
		super({ type: "regular", message: message ?? "Unknown Error" });
		this.httpCode = code;
	}
}
