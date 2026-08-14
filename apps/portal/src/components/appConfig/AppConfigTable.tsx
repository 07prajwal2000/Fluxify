import {
	Button,
	Checkbox,
	Chip,
	DeleteIconButton,
	Table,
} from "@fluxify/components";
import {
	TbArrowDown,
	TbArrowUp,
	TbEdit,
	TbLock,
	TbLockOpen,
} from "react-icons/tb";
import type { ConfigRow, SortBy } from "./types";

export function AppConfigTable({
	items,
	selectedIds,
	onSelectionChange,
	sortBy,
	sortOrder,
	onSort,
	onEdit,
	onDelete,
}: {
	items: ConfigRow[];
	selectedIds: Set<number>;
	onSelectionChange: (keys: Set<number>) => void;
	sortBy: SortBy;
	sortOrder: "asc" | "desc";
	onSort: (column: SortBy) => void;
	onEdit: (row: ConfigRow) => void;
	onDelete: (row: ConfigRow) => void;
}) {
	return (
		<Table>
			<Table.Content
				aria-label="App Config Table"
				selectionMode="multiple"
				selectedKeys={new Set(Array.from(selectedIds).map(String))}
				onSelectionChange={(keys) => {
					if (keys === "all") {
						onSelectionChange(new Set(items.map((item) => item.id)));
					} else if (keys instanceof Set) {
						onSelectionChange(new Set(Array.from(keys).map((k) => Number(k))));
					}
				}}
			>
				<Table.Header>
					<Table.Column id="select">
						<Checkbox slot="selection" aria-label="Select all rows">
							<Checkbox.Content>
								<Checkbox.Control>
									<Checkbox.Indicator />
								</Checkbox.Control>
							</Checkbox.Content>
						</Checkbox>
					</Table.Column>
					<Table.Column id="keyName" isRowHeader>
						<div
							role="button"
							tabIndex={0}
							onClick={() => onSort("keyName")}
							onKeyDown={(e) => e.key === "Enter" && onSort("keyName")}
							className="flex items-center gap-1 font-medium hover:text-foreground cursor-pointer select-none"
						>
							Key Name
							{sortBy === "keyName" && (
								sortOrder === "asc" ? <TbArrowUp size={14} /> : <TbArrowDown size={14} />
							)}
						</div>
					</Table.Column>
					<Table.Column id="dataType">Type</Table.Column>
					<Table.Column id="isEncrypted">
						<div
							role="button"
							tabIndex={0}
							onClick={() => onSort("isEncrypted")}
							onKeyDown={(e) => e.key === "Enter" && onSort("isEncrypted")}
							className="flex items-center gap-1 font-medium hover:text-foreground cursor-pointer select-none"
						>
							Encrypted
							{sortBy === "isEncrypted" && (
								sortOrder === "asc" ? <TbArrowUp size={14} /> : <TbArrowDown size={14} />
							)}
						</div>
					</Table.Column>
					<Table.Column id="encodingType">
						<div
							role="button"
							tabIndex={0}
							onClick={() => onSort("encodingType")}
							onKeyDown={(e) => e.key === "Enter" && onSort("encodingType")}
							className="flex items-center gap-1 font-medium hover:text-foreground cursor-pointer select-none"
						>
							Encoding
							{sortBy === "encodingType" && (
								sortOrder === "asc" ? <TbArrowUp size={14} /> : <TbArrowDown size={14} />
							)}
						</div>
					</Table.Column>
					<Table.Column id="updatedAt">
						<div
							role="button"
							tabIndex={0}
							onClick={() => onSort("updatedAt")}
							onKeyDown={(e) => e.key === "Enter" && onSort("updatedAt")}
							className="flex items-center gap-1 font-medium hover:text-foreground cursor-pointer select-none"
						>
							Updated At
							{sortBy === "updatedAt" && (
								sortOrder === "asc" ? <TbArrowUp size={14} /> : <TbArrowDown size={14} />
							)}
						</div>
					</Table.Column>
					<Table.Column id="actions" aria-label="Actions">{""}</Table.Column>
				</Table.Header>
				<Table.Body items={items}>
					{(row: ConfigRow) => (
						<Table.Row id={String(row.id)}>
							<Table.Cell>
								<Checkbox slot="selection" aria-label={`Select ${row.keyName}`}>
									<Checkbox.Content>
										<Checkbox.Control>
											<Checkbox.Indicator />
										</Checkbox.Control>
									</Checkbox.Content>
								</Checkbox>
							</Table.Cell>
							<Table.Cell>
								<span className="font-mono text-sm font-semibold">{row.keyName}</span>
							</Table.Cell>
							<Table.Cell>
								<Chip size="sm">{row.dataType}</Chip>
							</Table.Cell>
							<Table.Cell>
								{row.isEncrypted ? (
									<Chip size="sm" color="success" className="gap-1">
										<TbLock size={12} /> Yes
									</Chip>
								) : (
									<Chip size="sm" className="gap-1">
										<TbLockOpen size={12} /> No
									</Chip>
								)}
							</Table.Cell>
							<Table.Cell>
								<Chip size="sm" className="uppercase font-mono text-xs">
									{row.encodingType}
								</Chip>
							</Table.Cell>
							<Table.Cell>
								<span className="text-xs text-muted">
									{new Date(row.updatedAt).toLocaleDateString()} {new Date(row.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
								</span>
							</Table.Cell>
							<Table.Cell>
								<div className="flex justify-end gap-1">
									<Button
										isIconOnly
										variant="ghost"
										aria-label="Edit config"
										onPress={() => onEdit(row)}
									>
										<TbEdit size={16} />
									</Button>
									<DeleteIconButton
										aria-label="Delete config"
										onPress={() => onDelete(row)}
									/>
								</div>
							</Table.Cell>
						</Table.Row>
					)}
				</Table.Body>
			</Table.Content>
		</Table>
	);
}
