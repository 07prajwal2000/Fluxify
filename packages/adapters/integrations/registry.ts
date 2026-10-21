import {
	type AnyIntegrationGroup,
	BUILT_IN_INTEGRATION_GROUPS,
	type IntegrationVariantDef,
	isBuiltInIntegrationGroup,
	isIntegrationGroupName,
	UnknownIntegrationVariantError,
} from "@fluxify/sdk/integrations";

const keyOf = (group: string, variant: string) => `${group}\u0000${variant}`;

/** the variants one scope holds: every project's shared ones, or one project's own */
type Scope = {
	defs: Map<string, IntegrationVariantDef>;
	/** every name a variant answers to (its own and its aliases) -> its key */
	byName: Map<string, string>;
};

const GLOBAL = "";

/**
 * Which integration variants exist, and how each is validated and created.
 *
 * Built-ins come in through the constructor and are sealed: they cannot be
 * unregistered, and nothing registered later can take one of their names or
 * aliases. `register` is the path plugin variants (I6) take. A plugin is
 * installed per project, so its variants are registered for that project
 * (`projectId`): another project never sees them, and may hold another version
 * of the same plugin. Every lookup that passes a project sees the shared
 * variants plus that project's own. Pure — it holds definitions and never
 * imports a driver itself.
 */
export class IntegrationRegistry {
	private readonly scopes = new Map<string, Scope>([
		[GLOBAL, { defs: new Map(), byName: new Map() }],
	]);
	private readonly builtIn = new Set<string>();

	constructor(builtIns: readonly IntegrationVariantDef[] = []) {
		for (const def of builtIns) {
			if (!isBuiltInIntegrationGroup(def.group)) {
				throw new Error(`Built-in variant "${def.variant}" names unknown group "${def.group}"`);
			}
			this.add(def, GLOBAL);
			this.builtIn.add(keyOf(def.group, def.variant));
		}
	}

	/**
	 * Adds a variant, for one project when `projectId` is given. Refuses an
	 * existing `group/variant` (or alias) that project can see, and a malformed group.
	 */
	register(def: IntegrationVariantDef, projectId?: string) {
		if (!isIntegrationGroupName(def.group)) {
			throw new Error(
				`Integration group "${def.group}" must be a built-in group or "<namespace>/<group>", and a namespace cannot be a built-in group name`,
			);
		}
		this.add(def, projectId ?? GLOBAL);
	}

	/** Removes a registered variant and its aliases. Built-ins cannot be removed. */
	unregister(group: string, variant: string, projectId?: string): boolean {
		const scope = this.scopes.get(projectId ?? GLOBAL);
		const key = scope?.byName.get(keyOf(group, variant));
		if (!scope || !key) return false;
		if (!projectId && this.builtIn.has(key)) {
			throw new Error(`Built-in integration variant "${group}/${variant}" cannot be unregistered`);
		}
		const def = scope.defs.get(key)!;
		for (const name of [def.variant, ...(def.aliases ?? [])])
			scope.byName.delete(keyOf(group, name));
		scope.defs.delete(key);
		if (projectId && !scope.defs.size) this.scopes.delete(projectId);
		return true;
	}

	/** The variant by its name or an alias, or undefined. */
	get<G extends AnyIntegrationGroup>(
		group: G | (string & {}),
		variant: string,
		projectId?: string,
	) {
		for (const scope of this.visible(projectId)) {
			const key = scope.byName.get(keyOf(group, variant));
			if (key) return scope.defs.get(key) as IntegrationVariantDef<G>;
		}
		return undefined;
	}

	/** Like `get`, but an unknown group or variant throws an error naming it. */
	require<G extends AnyIntegrationGroup>(
		group: G | (string & {}),
		variant: string,
		projectId?: string,
	) {
		const def = this.get(group, variant, projectId);
		if (def) return def;
		throw new UnknownIntegrationVariantError(
			group,
			this.hasGroup(group, projectId) ? variant : undefined,
		);
	}

	/** Registered variants of a group, built-ins first, in registration order. */
	variants<G extends AnyIntegrationGroup>(group: G | (string & {}), projectId?: string) {
		return this.visible(projectId).flatMap((scope) =>
			[...scope.defs.values()].filter((def) => def.group === group),
		) as IntegrationVariantDef<G>[];
	}

	/** Every name the group's variants answer to, aliases included, for matching stored rows. */
	names(group: string, projectId?: string): string[] {
		return this.variants(group, projectId).flatMap((def) => [def.variant, ...(def.aliases ?? [])]);
	}

	/** The built-in groups, in their fixed order, then every namespaced group that has a variant. */
	groups(projectId?: string): AnyIntegrationGroup[] {
		const namespaced = new Set<AnyIntegrationGroup>();
		for (const scope of this.visible(projectId))
			for (const def of scope.defs.values())
				if (!isBuiltInIntegrationGroup(def.group)) namespaced.add(def.group);
		return [...BUILT_IN_INTEGRATION_GROUPS, ...namespaced];
	}

	hasGroup(group: string, projectId?: string): group is AnyIntegrationGroup {
		return isBuiltInIntegrationGroup(group) || this.variants(group, projectId).length > 0;
	}

	isBuiltIn(group: string, variant: string) {
		const key = this.scopes.get(GLOBAL)!.byName.get(keyOf(group, variant));
		return !!key && this.builtIn.has(key);
	}

	/** Validates a stored config against its variant's schema; an unknown variant throws. */
	validate(group: string, variant: string, config: unknown, projectId?: string) {
		return this.require(group, variant, projectId).configSchema.safeParse(config);
	}

	tags(group: string, variant: string, projectId?: string): string[] {
		return [...(this.get(group, variant, projectId)?.tags ?? [])];
	}

	/** the shared scope, then the project's own: the shared one wins a name both hold */
	private visible(projectId?: string): Scope[] {
		const own = projectId ? this.scopes.get(projectId) : undefined;
		return own ? [this.scopes.get(GLOBAL)!, own] : [this.scopes.get(GLOBAL)!];
	}

	private add(def: IntegrationVariantDef, scopeId: string) {
		const key = keyOf(def.group, def.variant);
		const names = [def.variant, ...(def.aliases ?? [])];
		for (const name of names) {
			if (this.get(def.group, name, scopeId || undefined)) {
				throw new Error(`Integration variant "${def.group}/${name}" is already registered`);
			}
		}
		if (def.group === "database") {
			const clash = this.variants("database", scopeId || undefined).find(
				(other) => other.extras.dbType.toLowerCase() === def.extras.dbType.toLowerCase(),
			);
			if (clash) {
				throw new Error(
					`Database variant "${def.variant}" reuses dbType "${def.extras.dbType}" of "${clash.variant}"`,
				);
			}
		}
		let scope = this.scopes.get(scopeId);
		if (!scope) {
			scope = { defs: new Map(), byName: new Map() };
			this.scopes.set(scopeId, scope);
		}
		scope.defs.set(key, def);
		for (const name of names) scope.byName.set(keyOf(def.group, name), key);
	}
}
