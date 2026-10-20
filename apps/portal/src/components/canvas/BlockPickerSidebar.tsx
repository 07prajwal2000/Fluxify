import { Button, cn, Input, Label, Sidebar, TextField } from "@fluxify/components";
import {
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useState,
} from "react";
import {
	TbArrowLeft,
	TbBoxMultiple,
	TbChevronRight,
	TbCode,
	TbDatabase,
	TbKey,
	TbLayoutGrid,
	TbPlug,
	TbPlus,
	TbSearch,
	TbSend,
	TbTerminal2,
	TbWorld,
	TbX,
} from "react-icons/tb";
import { CustomBlockIcon } from "@/components/customBlocks/IconPicker";
import {
	type BlockDefinition,
	type BlockType,
	blockIcon,
	pickerBlockCatalogEntries,
} from "./blocks";
import { useAddableCustomBlockDefs } from "./blocks/useCustomBlockDefs";
import { DeprecatedBadge } from "./plugins/DeprecatedBadge";
import { usePluginBlocks } from "./plugins/PluginBlocksContext";
import { type PluginPickerItem, pluginFolderItems, pluginItem } from "./plugins/pluginPicker";
import "./blockPickerSidebar.css";

/** Catalog categories plus the ones only custom blocks land in. */
type BlockCategory = BlockDefinition["category"] | "Custom" | "Built-in" | "Plugins";

type CategoryDetails = {
	description: string;
	icon: ReactNode;
};

const CATEGORY_DETAILS: Record<BlockCategory, CategoryDetails> = {
	Core: {
		description: "Start, respond, and work with route data",
		icon: <TbLayoutGrid />,
	},
	Flow: {
		description: "Branch, repeat, and control execution",
		icon: <TbCode />,
	},
	Database: {
		description: "Read and write database records",
		icon: <TbDatabase />,
	},
	KV: {
		description: "Read and write keys in Redis or Memcached",
		icon: <TbKey />,
	},
	Queue: {
		description: "Send messages to Kafka, NATS, SQS, RabbitMQ or Redis streams",
		icon: <TbSend />,
	},
	HTTP: {
		description: "Read requests and call external services",
		icon: <TbWorld />,
	},
	Logging: {
		description: "Record values and events",
		icon: <TbTerminal2 />,
	},
	Misc: {
		description: "Transform data and annotate the canvas",
		icon: <TbPlus />,
	},
	Custom: {
		description: "Blocks built in this project",
		icon: <TbBoxMultiple />,
	},
	"Built-in": {
		description: "Blocks shipped with plugins",
		icon: <TbBoxMultiple />,
	},
	Plugins: {
		description: "Blocks from the plugins installed in this project",
		icon: <TbPlug />,
	},
};

const allCategories = Object.keys(CATEGORY_DETAILS) as BlockCategory[];

type PickerItem = Omit<PluginPickerItem, "category"> & {
	category: BlockCategory;
	/** Set when the block cannot be added — the reason is shown in its place. */
	disabledReason?: string;
};

export type BlockPickerSidebarProps = {
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	onAdd: (type: BlockType) => void;
	/** Blocks failing this are shown disabled with `filterReason`. */
	filter?: (type: string) => boolean;
	filterReason?: string;
};

/** Core blocks from the catalog, the project's own custom blocks and the plugins' blocks. */
export function BlockPickerSidebar({
	isOpen,
	onOpenChange,
	onAdd,
	filter,
	filterReason,
}: BlockPickerSidebarProps) {
	const [query, setQuery] = useState("");
	const [selectedCategory, setSelectedCategory] = useState<BlockCategory | null>(null);
	/** the folder open inside `Plugins`: `acme/slack`, or `""` for the scopes */
	const [folder, setFolder] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const listId = useId();
	const optionId = (index: number) => `${listId}-option-${index}`;

	useEffect(() => {
		if (!isOpen) {
			setQuery("");
			setSelectedCategory(null);
			setFolder("");
			setActiveIndex(0);
		}
	}, [isOpen]);

	// A new list starts at its first row, so "type, then Enter" picks the top hit.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset is the point
	useEffect(() => setActiveIndex(0), [query, selectedCategory, folder]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: optionId is derived from listId
	useEffect(() => {
		document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
	}, [activeIndex, listId]);

	const customDefs = useAddableCustomBlockDefs();
	// a block of a plugin still waiting for its first approval can be wired, not added
	const { defs } = usePluginBlocks();
	const pluginDefs = useMemo(() => defs.filter((def) => def.loads), [defs]);
	const restrict = useCallback(
		(block: PickerItem): PickerItem =>
			filter && !block.folder && !filter(block.type)
				? { ...block, disabledReason: block.disabledReason ?? filterReason }
				: block,
		[filter, filterReason],
	);
	const blocks = useMemo<PickerItem[]>(() => {
		const core = pickerBlockCatalogEntries().map(([type, definition]) => ({
			type: type as string,
			name: definition.name,
			description: definition.description,
			category: definition.category as BlockCategory,
			icon: blockIcon(type),
		}));
		const custom = customDefs.map((def) => ({
			type: def.name,
			name: def.label,
			description: def.description ?? "Custom block",
			category: (def.sourceType === "plugin" ? "Built-in" : "Custom") as BlockCategory,
			icon: <CustomBlockIcon icon={def.icon} iconUrl={def.iconUrl} />,
			disabledReason: def.isSelf
				? "A block can't call itself — that would recurse forever."
				: undefined,
		}));
		return [...custom, ...pluginDefs.map(pluginItem), ...core].map(restrict);
	}, [customDefs, pluginDefs, restrict]);

	// An empty category is a dead end — only offer the ones holding something.
	const categories = useMemo(
		() => allCategories.filter((category) => blocks.some((b) => b.category === category)),
		[blocks],
	);

	const visibleBlocks = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		// `Plugins` is a tree to walk, not a list; a search still finds every block in it
		if (!normalizedQuery && selectedCategory === "Plugins") {
			return pluginFolderItems(pluginDefs, folder).map(restrict);
		}
		return blocks
			.filter((block) => {
				if (!normalizedQuery && selectedCategory && block.category !== selectedCategory) {
					return false;
				}
				if (!normalizedQuery) return true;
				return [block.type, block.name, block.description, block.category]
					.join(" ")
					.toLowerCase()
					.includes(normalizedQuery);
			})
			.sort((a, b) => Number(!!a.deprecated) - Number(!!b.deprecated));
	}, [blocks, pluginDefs, restrict, query, selectedCategory, folder]);

	const isShowingCategories = !selectedCategory && !query.trim();
	const trail =
		selectedCategory === "Plugins" && !query.trim() ? folder.split("/").filter(Boolean) : [];
	const title = query.trim()
		? "Search blocks"
		: [selectedCategory ?? "Categories", ...trail].join(" / ");
	// one level up: out of a plugin folder, then out of `Plugins`
	const parent = trail.length > 1 ? trail[trail.length - 2] : "Plugins";

	function addBlock(type: BlockType) {
		onAdd(type);
		onOpenChange(false);
	}

	function goBack() {
		if (folder) setFolder(trail.slice(0, -1).join("/"));
		else setSelectedCategory(null);
	}

	/** a folder opens, a block is added */
	function pick(block: PickerItem) {
		if (block.disabledReason) return;
		if (block.folder) setFolder(block.folder);
		else addBlock(block.type as BlockType);
	}

	const rowCount = isShowingCategories ? categories.length : visibleBlocks.length;

	// Focus stays in the search box; keys drive the highlighted row.
	function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		const { key } = event;
		if (key === "ArrowDown" || key === "ArrowUp") {
			event.preventDefault();
			if (rowCount === 0) return;
			const step = key === "ArrowDown" ? 1 : -1;
			setActiveIndex((index) => (index + step + rowCount) % rowCount);
		} else if (key === "Enter") {
			event.preventDefault();
			if (isShowingCategories) {
				const category = categories[activeIndex];
				if (category) setSelectedCategory(category);
				return;
			}
			const block = visibleBlocks[activeIndex];
			if (block) pick(block);
		} else if (
			selectedCategory &&
			!query &&
			(key === "ArrowLeft" || key === "Backspace" || key === "Escape")
		) {
			event.preventDefault();
			// Keeps Sidebar's document-level Escape from closing the picker.
			event.stopPropagation();
			goBack();
		}
	}

	return (
		<Sidebar
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			aria-label="Add a block"
			className="fx-block-picker"
		>
			<header className="fx-block-picker__header">
				<div>
					<p className="fx-block-picker__eyebrow">Canvas</p>
					<h2 className="fx-block-picker__heading">Add block</h2>
				</div>
				<Button
					isIconOnly
					aria-label="Close block picker"
					variant="ghost"
					onPress={() => onOpenChange(false)}
				>
					<TbX />
				</Button>
			</header>

			<div className="fx-block-picker__search">
				<TextField value={query} onChange={setQuery} aria-label="Search blocks">
					<Label className="sr-only">Search blocks</Label>
					<TbSearch aria-hidden className="fx-block-picker__search-icon" />
					<Input
						autoFocus
						placeholder="Search blocks…"
						role="combobox"
						aria-expanded
						aria-controls={listId}
						aria-activedescendant={rowCount > 0 ? optionId(activeIndex) : undefined}
						onKeyDown={onSearchKeyDown}
					/>
				</TextField>
			</div>

			<div className="fx-block-picker__content">
				<div className="fx-block-picker__section-header">
					{selectedCategory ? (
						<Button variant="ghost" onPress={goBack} className="fx-block-picker__back">
							<TbArrowLeft />
							{folder ? parent : "Categories"}
						</Button>
					) : (
						<span>{title}</span>
					)}
					{selectedCategory && <span>{title}</span>}
				</div>

				{isShowingCategories ? (
					<div id={listId} role="listbox" aria-label={title} className="fx-block-picker__list">
						{categories.map((category, index) => {
							const details = CATEGORY_DETAILS[category];
							return (
								<button
									key={category}
									id={optionId(index)}
									type="button"
									role="option"
									tabIndex={-1}
									aria-selected={index === activeIndex}
									className={cn(
										"fx-block-picker__item fx-block-picker__category",
										index === activeIndex && "fx-block-picker__item--active",
									)}
									onMouseEnter={() => setActiveIndex(index)}
									onClick={() => setSelectedCategory(category)}
								>
									<span className="fx-block-picker__icon" aria-hidden>
										{details.icon}
									</span>
									<span className="fx-block-picker__copy">
										<span className="fx-block-picker__name">{category}</span>
										<span className="fx-block-picker__description">{details.description}</span>
									</span>
									<TbChevronRight className="fx-block-picker__chevron" aria-hidden />
								</button>
							);
						})}
					</div>
				) : (
					<div id={listId} role="listbox" aria-label={title} className="fx-block-picker__list">
						{visibleBlocks.map((block, index) => (
							<button
								key={block.type}
								id={optionId(index)}
								type="button"
								role="option"
								tabIndex={-1}
								aria-selected={index === activeIndex}
								aria-disabled={Boolean(block.disabledReason)}
								disabled={Boolean(block.disabledReason)}
								title={block.disabledReason}
								className={cn(
									"fx-block-picker__item",
									index === activeIndex && "fx-block-picker__item--active",
									block.disabledReason && "cursor-not-allowed opacity-60",
								)}
								onMouseEnter={() => setActiveIndex(index)}
								onClick={() => pick(block)}
							>
								<span className="fx-block-picker__icon" aria-hidden>
									{block.icon}
								</span>
								<span className="fx-block-picker__copy">
									<span className="fx-block-picker__name">
										{block.name}
										{block.deprecated && (
											<DeprecatedBadge message={block.deprecated} className="ml-2 align-middle" />
										)}
									</span>
									<span
										className={cn(
											"fx-block-picker__description",
											block.disabledReason && "text-danger",
										)}
									>
										{block.disabledReason ??
											(query.trim() ? block.path : undefined) ??
											block.description}
									</span>
								</span>
								{block.folder && (
									<TbChevronRight className="fx-block-picker__chevron" aria-hidden />
								)}
							</button>
						))}
						{visibleBlocks.length === 0 && (
							<p className="fx-block-picker__empty">No blocks match.</p>
						)}
					</div>
				)}
			</div>
		</Sidebar>
	);
}
