import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Input, Label, Sidebar, TextField } from "@fluxify/components";
import {
	TbArrowLeft,
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
import {
	pickerBlockCatalogEntries,
	blockIcon,
	type BlockDefinition,
	type BlockType,
} from "./blocks";
import "./blockPickerSidebar.css";

type BlockCategory = BlockDefinition["category"];

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
};

const categories = Object.keys(CATEGORY_DETAILS) as BlockCategory[];

export type BlockPickerSidebarProps = {
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	onAdd: (type: BlockType) => void;
};

/** Core-block picker. Custom blocks join this catalog after their API lands. */
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

	const blocks = useMemo(() => pickerBlockCatalogEntries(), []);
	const visibleBlocks = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		return blocks.filter(([type, definition]) => {
			if (!normalizedQuery && selectedCategory && definition.category !== selectedCategory) {
				return false;
			}
			if (!normalizedQuery) return true;
			return [type, definition.name, definition.description, definition.category]
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
						{visibleBlocks.map(([type, definition]) => (
							<button
								key={type}
								type="button"
								className="fx-block-picker__item"
								onClick={() => addBlock(type)}
							>
								<span className="fx-block-picker__icon" aria-hidden>
									{blockIcon(type)}
								</span>
								<span className="fx-block-picker__copy">
									<span className="fx-block-picker__name">{definition.name}</span>
									<span className="fx-block-picker__description">
										{definition.description}
									</span>
								</span>
							</button>
						))}
						{visibleBlocks.length === 0 && (
							<p className="fx-block-picker__empty">No core blocks match.</p>
						)}
					</div>
				)}
			</div>
		</Sidebar>
	);
}
