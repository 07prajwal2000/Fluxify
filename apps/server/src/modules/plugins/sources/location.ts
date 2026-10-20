/**
 * Where an uploaded or fetched plugin's tarball sits in the `fluxify_plugins`
 * Object Store: `<projectId>/<scope>/<name>/<version>.tgz`. A worker reads it
 * with `objectKeyOf(plugin.location)`.
 */
export const pluginObjectKey = (projectId: string, name: string, version: string) =>
	`${projectId}/${name}/${version}.tgz`;

/**
 * A plugin row's `location` for a tarball in the store. A `url` plugin appends
 * the address it came from after a space; no key, name or version holds one.
 */
export const archiveLocation = (key: string, url?: string) => (url ? `${key} ${url}` : key);

/** the object key inside an `upload` or `url` plugin's `location` */
export const objectKeyOf = (location: string) => location.split(" ", 1)[0]!;
