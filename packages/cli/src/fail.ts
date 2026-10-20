/** a failure the author can act on: printed as one line each, exit code 1 */
export class CliError extends Error {
	constructor(readonly problems: string[]) {
		super(problems.join("\n"));
	}
}
export const fail = (...problems: string[]): never => {
	throw new CliError(problems);
};
