import {
	Autocomplete,
	Button,
	Input,
	Label,
	ListBox,
	SearchField,
	useFilter,
} from "@fluxify/components";
import { TbPlus, TbTrash } from "react-icons/tb";
import { appConfigQuery } from "@/query/appConfigQuery";

interface HeaderMappingEditorProps {
	projectId: string;
	headers: Record<string, string>;
	onChange: (headers: Record<string, string>) => void;
	isDisabled?: boolean;
}

export function HeaderMappingEditor({
	projectId,
	headers,
	onChange,
	isDisabled = false,
}: HeaderMappingEditorProps) {
	const { data: appConfigData, isLoading } = appConfigQuery.getAll.useQuery(projectId, {
		perPage: 100,
		sortBy: "keyName",
		sort: "asc",
	});

	const entries = Object.entries(headers);
	const availableKeys = appConfigData?.data?.map((c) => c.keyName) ?? [];
	const { contains } = useFilter({ sensitivity: "base" });

	function handleNameChange(oldName: string, newName: string, configKey: string) {
		const next: Record<string, string> = {};
		for (const [k, v] of Object.entries(headers)) {
			if (k === oldName) {
				next[newName] = configKey;
			} else {
				next[k] = v;
			}
		}
		onChange(next);
	}

	function handleKeyChange(headerName: string, newKey: string) {
		onChange({
			...headers,
			[headerName]: newKey,
		});
	}

	function handleRemove(nameToRemove: string) {
		const next = { ...headers };
		delete next[nameToRemove];
		onChange(next);
	}

	function handleAdd() {
		// generate unique default name
		let idx = 1;
		let candidate = "Header-1";
		while (candidate in headers) {
			idx++;
			candidate = `Header-${idx}`;
		}
		const defaultKey = availableKeys[0] ?? "";
		onChange({
			...headers,
			[candidate]: defaultKey,
		});
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between">
				<div>
					<Label className="text-xs font-semibold text-foreground uppercase tracking-wider">
						Request Headers
					</Label>
					<p className="text-xs text-muted">
						Map request header names to existing app-config keys for secure credential injection.
					</p>
				</div>
				{!isDisabled && (
					<Button
						variant="outline"
						size="sm"
						onPress={handleAdd}
						isDisabled={isDisabled || availableKeys.length === 0}
					>
						<TbPlus size={14} className="mr-1" /> Add header
					</Button>
				)}
			</div>

			{availableKeys.length === 0 && !isLoading && (
				<p className="text-xs text-warning">
					No app-config keys found in this project. Create keys in Project &gt; App Config to use
					header injection.
				</p>
			)}

			{entries.length === 0 ? (
				<p className="text-xs text-muted italic">No custom headers configured.</p>
			) : (
				<div className="flex flex-col gap-2">
					{entries.map(([name, key], i) => (
						<div key={`${name}-${i}`} className="flex items-center gap-2">
							<div className="w-1/2">
								<Input
									placeholder="Header name (e.g. Authorization)"
									value={name}
									disabled={isDisabled}
									onChange={(e) => handleNameChange(name, e.target.value, key)}
									className="text-xs"
								/>
							</div>
							<div className="flex-1 min-w-0">
								<Autocomplete
									variant="secondary"
									value={key}
									isDisabled={isDisabled}
									onChange={(next) => next != null && handleKeyChange(name, String(next))}
									aria-label="Select app config key"
								>
									<Autocomplete.Trigger className="h-8 text-xs font-mono">
										<Autocomplete.Value>
											{key || <span className="text-muted not-mono">Select key...</span>}
										</Autocomplete.Value>
										<Autocomplete.Indicator />
									</Autocomplete.Trigger>
									<Autocomplete.Popover className="w-64">
										<Autocomplete.Filter filter={contains}>
											<SearchField
												autoFocus
												aria-label="Search app config keys"
												variant="secondary"
											>
												<SearchField.Group>
													<SearchField.SearchIcon />
													<SearchField.Input placeholder="Search key..." />
												</SearchField.Group>
											</SearchField>
											<ListBox>
												{availableKeys.map((k) => (
													<ListBox.Item key={k} id={k} textValue={k}>
														<span className="font-mono text-xs">{k}</span>
														<ListBox.ItemIndicator />
													</ListBox.Item>
												))}
											</ListBox>
										</Autocomplete.Filter>
									</Autocomplete.Popover>
								</Autocomplete>
							</div>
							{!isDisabled && (
								<Button
									isIconOnly
									variant="ghost"
									size="sm"
									aria-label="Remove header"
									onPress={() => handleRemove(name)}
								>
									<TbTrash size={14} className="text-danger" />
								</Button>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
