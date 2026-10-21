import {
	type AnyIntegrationGroup,
	BUILT_IN_INTEGRATION_GROUPS,
	type IntegrationVariantDef,
	isBuiltInIntegrationGroup,
	isIntegrationGroupName,
	UnknownIntegrationVariantError,
} from "@fluxify/sdk/integrations";

const keyOf = (group: string, variant: string) => `${group}\u0000${variant}`;

/**
 * Which integration variants exist, and how each is validated and created.
 *
 * Built-ins come in through the constructor and are sealed: they cannot be
 * unregistered, and nothing registered later can take one of their names or
 * aliases. `register` is the path plugin variants (I6) take. Pure — it holds
 * definitions and never imports a driver itself.
 */
export class IntegrationRegistry {
	private readonly defs = new Map<string, IntegrationVariantDef>();
	/** every name a variant answers to (its own and its aliases) -> its key */
	private readonly byName = new Map<string, string>();
	private readonly builtIn = new Set<string>();

	constructor(builtIns: readonly IntegrationVariantDef[] = []) {
		for (const def of builtIns) {
			if (!isBuiltInIntegrationGroup(def.group)) {
				throw new Error(`Built-in variant "${def.variant}" names unknown group "${def.group}"`);
			}
			this.add(def);
			this.builtIn.add(keyOf(def.group, def.variant));
		}
	}

	/** Adds a variant. Refuses an existing `group/variant` (or alias) and a malformed group. */
	register(def: IntegrationVariantDef) {
		if (!isIntegrationGroupName(def.group)) {
			throw new Error(
				`Integration group "${def.group}" must be a built-in group or "<namespace>/<group>", and a namespace cannot be a built-in group name`,
			);
		}
		this.add(def);
	}

	/** Removes a registered variant and its aliases. Built-ins cannot be removed. */
	unregister(group: string, variant: string): boolean {
		const key = this.byName.get(keyOf(group, variant));
		if (!key) return false;
		if (this.builtIn.has(key)) {
			throw new Error(`Built-in integration variant "${group}/${variant}" cannot be unregistered`);
		}
		const def = this.defs.get(key)!;
		for (const name of [def.variant, ...(def.aliases ?? [])])
			this.byName.delete(keyOf(group, name));
		this.defs.delete(key);
		return true;
	}

	/** The variant by its name or an alias, or undefined. */
	get<G extends AnyIntegrationGroup>(group: G | (string & {}), variant: string) {
		const key = this.byName.get(keyOf(group, variant));
		return key ? (this.defs.get(key) as IntegrationVariantDef<G>) : undefined;
	}

	/** Like `get`, but an unknown group or variant throws an error naming it. */
	require<G extends AnyIntegrationGroup>(group: G | (string & {}), variant: string) {
		const def = this.get(group, variant);
		if (def) return def;
		throw new UnknownIntegrationVariantError(group, this.hasGroup(group) ? variant : undefined);
	}

	/** Registered variants of a group, built-ins first, in registration order. */
	variants<G extends AnyIntegrationGroup>(group: G | (string & {})) {
		return [...this.defs.values()].filter(
			(def) => def.group === group,
		) as IntegrationVariantDef<G>[];
	}

	/** Every name the group's variants answer to, aliases included, for matching stored rows. */
	names(group: string): string[] {
		return this.variants(group).flatMap((def) => [def.variant, ...(def.aliases ?? [])]);
	}

	/** The built-in groups, in their fixed order, then every namespaced group that has a variant. */
	groups(): AnyIntegrationGroup[] {
		const namespaced = new Set<AnyIntegrationGroup>();
		for (const def of this.defs.values()) {
			if (!isBuiltInIntegrationGroup(def.group)) namespaced.add(def.group);
		}
		return [...BUILT_IN_INTEGRATION_GROUPS, ...namespaced];
	}

	hasGroup(group: string): group is AnyIntegrationGroup {
		return isBuiltInIntegrationGroup(group) || this.variants(group).length > 0;
	}

	isBuiltIn(group: string, variant: string) {
		const key = this.byName.get(keyOf(group, variant));
		return !!key && this.builtIn.has(key);
	}

	/** Validates a stored config against its variant's schema; an unknown variant throws. */
	validate(group: string, variant: string, config: unknown) {
		return this.require(group, variant).configSchema.safeParse(config);
	}

	tags(group: string, variant: string): string[] {
		return [...(this.get(group, variant)?.tags ?? [])];
	}

	private add(def: IntegrationVariantDef) {
		const key = keyOf(def.group, def.variant);
		const names = [def.variant, ...(def.aliases ?? [])];
		for (const name of names) {
			if (this.byName.has(keyOf(def.group, name))) {
				throw new Error(`Integration variant "${def.group}/${name}" is already registered`);
			}
		}
		if (def.group === "database") {
			const clash = this.variants("database").find(
				(other) => other.extras.dbType.toLowerCase() === def.extras.dbType.toLowerCase(),
			);
			if (clash) {
				throw new Error(
					`Database variant "${def.variant}" reuses dbType "${def.extras.dbType}" of "${clash.variant}"`,
				);
			}
		}
		this.defs.set(key, def);
		for (const name of names) this.byName.set(keyOf(def.group, name), key);
	}
}
