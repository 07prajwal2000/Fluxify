/**
 * The plugins folder (`FLUXIFY_PLUGINS_DIR`) as pod settings: the PVC
 * `claimName` mounted read-only at `dir`. Unset, a pod gets none of it.
 */
export type PluginsVolume = { claimName: string; dir: string };

export function podPlugins(plugins?: PluginsVolume) {
	if (!plugins) return { env: [], container: {}, pod: {} };
	return {
		env: [{ name: "FLUXIFY_PLUGINS_DIR", value: plugins.dir }],
		container: { volumeMounts: [{ name: "plugins", mountPath: plugins.dir, readOnly: true }] },
		pod: {
			volumes: [
				{
					name: "plugins",
					persistentVolumeClaim: { claimName: plugins.claimName, readOnly: true },
				},
			],
		},
	};
}
