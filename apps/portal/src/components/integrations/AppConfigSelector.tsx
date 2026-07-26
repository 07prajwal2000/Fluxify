import { useEffect, useRef, useState } from "react";
import { Input, Label, cn } from "@fluxify/components";
import { TbSquareKey, TbX, TbReload } from "react-icons/tb";
import { appConfigQuery } from "@/query/appConfigQuery";

type Props = {
	projectId: string;
	value: string;
	label?: string;
	description?: string;
	placeholder?: string;
	onChange?: (value: string) => void;
};

// Faithful port of web AppConfigSelector: a field that holds either a literal
// value or an app-config reference (`cfg:<key>`) picked from the project's keys.
export function AppConfigSelector({
	projectId,
	value,
	label,
	description,
	placeholder,
	onChange,
}: Props) {
	const [local, setLocal] = useState(value);
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const boxRef = useRef<HTMLDivElement>(null);
	const { data: keys, isLoading, refetch } = appConfigQuery.getKeysList.useQuery(
		projectId,
		"",
	);

	useEffect(() => setLocal(value), [value]);

	// close the picker on outside click
	useEffect(() => {
		if (!open) return;
		function onDoc(e: MouseEvent) {
			if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
		}
		document.addEventListener("mousedown", onDoc);
		return () => document.removeEventListener("mousedown", onDoc);
	}, [open]);

	const isConfig = local.startsWith("cfg:");
	function set(v: string) {
		setLocal(v);
		onChange?.(v);
	}
	const filtered = (keys ?? []).filter((k) =>
		k.toLowerCase().includes(search.toLowerCase()),
	);

	return (
		<div ref={boxRef} className="relative flex w-full flex-col gap-1">
			{label && <Label>{label}</Label>}
			{description && <span className="text-xs text-muted">{description}</span>}
			<div
				className={cn(
					"flex items-center gap-1 rounded-md border border-border bg-background-secondary pr-1",
					isConfig && "border-accent/40",
				)}
			>
				{isConfig ? (
					<span className="flex flex-1 items-center gap-2 rounded-l-md bg-accent-soft px-2 py-1.5 text-sm text-accent">
						<span className="flex-1 truncate">{local.slice(4)}</span>
						<button
							type="button"
							aria-label="Clear"
							onClick={() => set("")}
							className="text-accent/70 hover:text-accent"
						>
							<TbX size={15} />
						</button>
					</span>
				) : (
					<input
						className="flex-1 bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted"
						placeholder={placeholder}
						value={local}
						onChange={(e) => set(e.target.value)}
					/>
				)}
				<button
					type="button"
					aria-label="Use app config value"
					onClick={() => setOpen((o) => !o)}
					className={cn(
						"inline-flex size-7 items-center justify-center rounded-md transition-colors",
						isConfig ? "text-accent" : "text-muted hover:text-foreground",
					)}
				>
					<TbSquareKey size={18} />
				</button>
			</div>

			{open && (
				<div className="absolute right-0 top-full z-30 mt-1 flex w-64 flex-col rounded-md border border-border bg-overlay shadow-xl">
					<div className="flex items-center gap-2 border-b border-border p-2">
						<Input
							className="flex-1"
							placeholder="Search keys…"
							value={search}
							onChange={(e) => setSearch(e.currentTarget.value)}
						/>
						<button
							type="button"
							aria-label="Refresh"
							onClick={() => refetch()}
							className="text-muted hover:text-foreground"
						>
							<TbReload size={16} />
						</button>
					</div>
					<div className="max-h-56 overflow-y-auto p-1">
						{isLoading ? (
							<p className="p-2 text-center text-sm text-muted">Loading…</p>
						) : filtered.length === 0 ? (
							<p className="p-2 text-center text-sm text-muted">No keys found</p>
						) : (
							filtered.map((k) => (
								<button
									key={k}
									type="button"
									onClick={() => {
										set(`cfg:${k}`);
										setOpen(false);
									}}
									className="w-full truncate rounded px-2 py-1.5 text-left font-mono text-sm text-foreground hover:bg-white/5"
								>
									{k}
								</button>
							))
						)}
					</div>
				</div>
			)}
		</div>
	);
}
