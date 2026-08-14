import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
	type ComponentType,
} from "react";
import {
	ALL_DATA_TYPES,
	CONTAINER_TYPES,
	DATA_TYPE_LABELS,
	DEFAULT_SCHEMA,
	ROOT_EXCLUDED_TYPES,
} from "./constants";
import { DEFAULT_RULE_EDITORS } from "./rules";
import type {
	DataType,
	DataTypeOption,
	RuleEditorProps,
	SchemaEditorProps,
	SchemaPath,
	ValidationSchema,
} from "./types";
import {
	addPropertyAtPath,
	mergeAtPath,
	pathToKeyString,
	removeAtPath,
} from "./utils";

interface SchemaEditorContextValue {
	schema: ValidationSchema;
	setSchema: (schema: ValidationSchema) => void;
	/** Path of the sub-schema currently being shown. */
	path: SchemaPath;
	/** Navigates into the sub-schema at an absolute path. */
	goToPath: (path: SchemaPath) => void;
	/** Truncates the current path — used by the breadcrumbs. */
	goToLevel: (level: number) => void;
	/** Path whose rules the drawer is editing, or `null` when it is closed. */
	drawerPath: SchemaPath | null;
	openDrawer: (path: SchemaPath) => void;
	closeDrawer: () => void;

	addProperty: (path: SchemaPath) => void;
	removeProperty: (path: SchemaPath) => void;
	updateProperty: (
		path: SchemaPath,
		updates: Partial<ValidationSchema>,
	) => void;

	isReadOnly: boolean;
	disableJs: boolean;
	jsEditorRows: number;
	ruleEditors: Partial<Record<DataType, ComponentType<RuleEditorProps>>>;
	/** Type choices for the node at `path`, honouring overrides and depth. */
	typeOptionsFor: (path: SchemaPath, isRoot?: boolean) => DataTypeOption[];
	/** True when this one dropdown stays editable despite `isReadOnly`. */
	hasTypeOverride: (path: SchemaPath) => boolean;
	labelFor: (type: DataType) => string;
}

const SchemaEditorContext = createContext<SchemaEditorContextValue | null>(null);

export function useSchemaEditorContext() {
	const context = useContext(SchemaEditorContext);
	if (!context) {
		throw new Error("SchemaEditor components must be used inside <SchemaEditor>");
	}
	return context;
}

type ProviderProps = SchemaEditorProps & { children: React.ReactNode };

export function SchemaEditorProvider({
	value,
	defaultValue,
	initialData,
	onChange,
	isReadOnly,
	readOnly,
	locked,
	allowedDataTypes = ALL_DATA_TYPES,
	allowedRootTypes,
	typeOverrides,
	disableJs = false,
	maxDepth = Number.POSITIVE_INFINITY,
	ruleEditors,
	jsEditorRows = 12,
	dataTypeLabels,
	children,
}: ProviderProps) {
	const [uncontrolled, setUncontrolled] = useState<ValidationSchema>(
		() => value ?? defaultValue ?? initialData ?? DEFAULT_SCHEMA,
	);
	const schema = value ?? uncontrolled;

	const [path, setPath] = useState<SchemaPath>([]);
	const [drawerPath, setDrawerPath] = useState<SchemaPath | null>(null);

	const readOnlyResolved = Boolean(isReadOnly ?? readOnly ?? locked ?? false);

	const setSchema = useCallback(
		(next: ValidationSchema) => {
			if (value === undefined) setUncontrolled(next);
			onChange?.(next);
		},
		[onChange, value],
	);

	// Every mutation reads the schema through a ref-free closure over `schema`,
	// which is fine because each one is invoked from an event handler that
	// re-renders before the next can fire.
	const updateProperty = useCallback(
		(target: SchemaPath, updates: Partial<ValidationSchema>) => {
			setSchema(mergeAtPath(schema, target, updates));
		},
		[schema, setSchema],
	);

	const addProperty = useCallback(
		(target: SchemaPath) => setSchema(addPropertyAtPath(schema, target)),
		[schema, setSchema],
	);

	const removeProperty = useCallback(
		(target: SchemaPath) => setSchema(removeAtPath(schema, target)),
		[schema, setSchema],
	);

	const goToPath = useCallback((next: SchemaPath) => setPath(next), []);

	const goToLevel = useCallback(
		(level: number) => setPath((prev) => prev.slice(0, level)),
		[],
	);

	const openDrawer = useCallback((target: SchemaPath) => setDrawerPath(target), []);
	const closeDrawer = useCallback(() => setDrawerPath(null), []);

	const labelFor = useCallback(
		(type: DataType) => dataTypeLabels?.[type] ?? DATA_TYPE_LABELS[type],
		[dataTypeLabels],
	);

	const hasTypeOverride = useCallback(
		(target: SchemaPath) =>
			Boolean(typeOverrides?.[pathToKeyString(schema, target)]),
		[schema, typeOverrides],
	);

	const typeOptionsFor = useCallback(
		(target: SchemaPath, isRoot = false): DataTypeOption[] => {
			const override = typeOverrides?.[pathToKeyString(schema, target)];
			const base =
				override ??
				(isRoot ? (allowedRootTypes ?? allowedDataTypes) : allowedDataTypes);

			// The node's own path length is how deep its *children* would sit, so
			// a container is offered only while there is room for one more level.
			const atDepthLimit = target.length >= maxDepth;

			return base
				.filter((type) => {
					if (override) return true; // an explicit override is the last word
					if (disableJs && type === "js") return false;
					if (isRoot && ROOT_EXCLUDED_TYPES.includes(type)) return false;
					if (atDepthLimit && CONTAINER_TYPES.includes(type)) return false;
					return true;
				})
				.map((type) => ({ value: type, label: labelFor(type) }));
		},
		[
			allowedDataTypes,
			allowedRootTypes,
			disableJs,
			labelFor,
			maxDepth,
			schema,
			typeOverrides,
		],
	);

	const resolvedRuleEditors = useMemo(
		() => ({ ...DEFAULT_RULE_EDITORS, ...ruleEditors }),
		[ruleEditors],
	);

	const contextValue = useMemo<SchemaEditorContextValue>(
		() => ({
			schema,
			setSchema,
			path,
			goToPath,
			goToLevel,
			drawerPath,
			openDrawer,
			closeDrawer,
			addProperty,
			removeProperty,
			updateProperty,
			isReadOnly: readOnlyResolved,
			disableJs,
			jsEditorRows,
			ruleEditors: resolvedRuleEditors,
			typeOptionsFor,
			hasTypeOverride,
			labelFor,
		}),
		[
			addProperty,
			closeDrawer,
			disableJs,
			drawerPath,
			goToLevel,
			goToPath,
			hasTypeOverride,
			jsEditorRows,
			labelFor,
			openDrawer,
			path,
			readOnlyResolved,
			removeProperty,
			resolvedRuleEditors,
			schema,
			setSchema,
			typeOptionsFor,
			updateProperty,
		],
	);

	return (
		<SchemaEditorContext.Provider value={contextValue}>
			{children}
		</SchemaEditorContext.Provider>
	);
}
