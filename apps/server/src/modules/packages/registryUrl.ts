/** The npm registry packages and plugins are resolved from; `NPM_REGISTRY_URL` points it at a mirror. */
export const registryUrl = () =>
	(process.env.NPM_REGISTRY_URL ?? "https://registry.npmjs.org").replace(/\/$/, "");

export const REGISTRY = registryUrl();
