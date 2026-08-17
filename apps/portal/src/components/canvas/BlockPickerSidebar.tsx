import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, cn, Input, Label, Sidebar, TextField } from "@fluxify/components";
import {
	TbArrowLeft,
	TbBoxMultiple,
	TbChevronRight,
	TbCode,
	TbDatabase,
	TbLayoutGrid,
	TbPlus,
	TbSearch,
	TbTerminal2,
	TbWorld,
	TbX,
} from "react-icons/tb";
import { CustomBlockIcon } from "@/components/customBlocks/IconPicker";
import {
	pickerBlockCatalogEntries,
	blockIcon,
	type BlockDefinition,
	type BlockType,
} from "./blocks";
import { useCustomBlockDefs } from "./blocks/useCustomBlockDefs";
import "./blockPickerSidebar.css";

/** Catalog categories plus the ones only custom blocks land in. */
type BlockCategory = BlockDefinition["category"] | "Custom" | "Built-in";

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
};

const allCategories = Object.keys(CATEGORY_DETAILS) as BlockCategory[];

type PickerItem = {
	type: string;
	name: string;
	description: string;
	category: BlockCategory;
	icon: ReactNode;
	/** Set when the block cannot be added — the reason is shown in its place. */
	disabledReason?: string;
};

export type BlockPickerSidebarProps = {
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	onAdd: (type: BlockType) => void;
};

/** Core blocks from the catalog plus the project's own custom blocks. */
export function BlockPickerSidebar({
	isOpen,
	onOpenChange,
	onAdd,
}: BlockPickerSidebarProps) {
	const [query, setQuery] = useState("");
	const [selectedCategory, setSelectedCategory] = useState<BlockCategory | null>(
		null,
	);

	useEffect(() => {
		if (!isOpen) {
			setQuery("");
			setSelectedCategory(null);
		}
	}, [isOpen]);

	const customDefs = useCustomBlockDefs();
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
		return [...custom, ...core];
	}, [customDefs]);

	// An empty category is a dead end — only offer the ones holding something.
	const categories = useMemo(
		() => allCategories.filter((category) => blocks.some((b) => b.category === category)),
		[blocks],
	);

	const visibleBlocks = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		return blocks.filter((block) => {
			if (!normalizedQuery && selectedCategory && block.category !== selectedCategory) {
				return false;
			}
			if (!normalizedQuery) return true;
			return [block.type, block.name, block.description, block.category]
				.join(" ")
				.toLowerCase()
				.includes(normalizedQuery);
		});
	}, [blocks, query, selectedCategory]);

	const isShowingCategories = !selectedCategory && !query.trim();
	const title = query.trim() ? "Search blocks" : (selectedCategory ?? "Categories");

	function addBlock(type: BlockType) {
		onAdd(type);
		onOpenChange(false);
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
					<Input autoFocus placeholder="Search blocks…" />
				</TextField>
			</div>

			<div className="fx-block-picker__content">
				<div className="fx-block-picker__section-header">
					{selectedCategory ? (
						<Button
							variant="ghost"
							onPress={() => setSelectedCategory(null)}
							className="fx-block-picker__back"
						>
							<TbArrowLeft />
							Categories
						</Button>
					) : (
						<span>{title}</span>
					)}
					{selectedCategory && <span>{title}</span>}
				</div>

				{isShowingCategories ? (
					<div className="fx-block-picker__list">
						{categories.map((category) => {
							const details = CATEGORY_DETAILS[category];
							return (
								<button
									key={category}
									type="button"
									className="fx-block-picker__item fx-block-picker__category"
									onClick={() => setSelectedCategory(category)}
								>
									<span className="fx-block-picker__icon" aria-hidden>
										{details.icon}
									</span>
									<span className="fx-block-picker__copy">
										<span className="fx-block-picker__name">{category}</span>
										<span className="fx-block-picker__description">
											{details.description}
										</span>
									</span>
									<TbChevronRight className="fx-block-picker__chevron" aria-hidden />
								</button>
							);
						})}
					</div>
				) : (
					<div className="fx-block-picker__list">
						{visibleBlocks.map((block) => (
							<button
								key={block.type}
								type="button"
								disabled={Boolean(block.disabledReason)}
								title={block.disabledReason}
								className={cn(
									"fx-block-picker__item",
									block.disabledReason && "cursor-not-allowed opacity-60",
								)}
								onClick={() => addBlock(block.type as BlockType)}
							>
								<span className="fx-block-picker__icon" aria-hidden>
									{block.icon}
								</span>
								<span className="fx-block-picker__copy">
									<span className="fx-block-picker__name">{block.name}</span>
									<span
										className={cn(
											"fx-block-picker__description",
											block.disabledReason && "text-danger",
										)}
									>
										{block.disabledReason ?? block.description}
									</span>
								</span>
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
