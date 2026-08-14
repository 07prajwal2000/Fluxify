import { useMemo, useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import {
	Button,
	Checkbox,
	Input,
	Label,
	LazyLoader,
	ListBox,
	Select,
	TextArea,
	TextField,
	cn,
	toast,
} from "@fluxify/components";
import {
	TbArrowLeft,
	TbArrowRight,
	TbCheck,
	TbChevronLeft,
	TbChevronRight,
	TbSearch,
} from "react-icons/tb";
import { authClient } from "@/lib/auth";
import { authQuery } from "@/query/authQuery";
import { projectsQuery } from "@/query/projectsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { createRouteHead } from "@/lib/seo";
import { ROLES, type Role } from "@/components/common/RoleSelector";

// Same roles the project settings member list offers, shown as a dropdown here
// because each row already carries a name and a remove action.
const ROLE_OPTIONS = ROLES.map((role) => ({ id: role.id, label: role.title }));

export const Route = createFileRoute("/_authed/projects/new")({
	head: createRouteHead(
		"New Project",
		"Create a project: name it, invite members and set its configuration.",
	),
	// Same gate the New Project button honours on the home page — reaching this
	// route by URL must not get further than clicking would.
	beforeLoad: async () => {
		const session = await authClient.getSession();
		if (!(session.data?.user as { isSystemAdmin?: boolean })?.isSystemAdmin) {
			throw redirect({ to: "/", search: { tab: "projects" } });
		}
	},
	component: CreateProjectPage,
});

type UserRow = { id: string; name: string | null; email: string };
type Member = { userId: string; role: Role; label: string };

const STEPS = [
	{ key: "basics", label: "Basics" },
	{ key: "members", label: "Members" },
	{ key: "config", label: "Configuration" },
] as const;

const STEP_COPY: Record<
	(typeof STEPS)[number]["key"],
	{ title: string; description: string }
> = {
	basics: {
		title: "Name the project",
		description: "How it appears in the project list. You can rename it later.",
	},
	members: {
		title: "Who can work on it",
		description:
			"Optional. Members and their roles are saved with the project — you can change them any time in project settings.",
	},
	config: {
		title: "Set the project's configuration",
		description:
			"Optional. Integrations, app configs and routes are set up inside the project once it exists.",
	},
};

function initialsOf(name: string | null, email: string) {
	if (!name) return email.substring(0, 2).toUpperCase();
	const parts = name.trim().split(" ");
	if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
	return name.substring(0, 2).toUpperCase();
}

function CreateProjectPage() {
	const navigate = useNavigate();
	const create = projectsQuery.create.mutation();

	const [step, setStep] = useState(0);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [members, setMembers] = useState<Member[]>([]);
	const [workerTimeouts, setWorkerTimeouts] = useState(false);

	// `projects.name` is varchar(50) and the API rejects anything longer, so the
	// field has to stop the user rather than let the request fail.
	const basicsValid = name.trim().length >= 2 && name.trim().length <= 50;

	const isLast = step === STEPS.length - 1;
	const currentKey = STEPS[step].key;

	function submit() {
		create.mutate(
			{
				name: name.trim(),
				description: description.trim() || undefined,
				members: members.length
					? members.map(({ userId, role }) => ({ userId, role }))
					: undefined,
				settings: {
					"experimental.workerTimeouts.enabled": workerTimeouts
						? "true"
						: "false",
				},
			},
			{
				onSuccess: (created) => {
					toast.success("Project created");
					navigate({ to: "/$projectId", params: { projectId: created.id } });
				},
				onError: (error) => showErrorNotification(error as Error),
			},
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-6 py-8">
			<div className="flex items-center gap-3">
				<Button
					isIconOnly
					variant="ghost"
					aria-label="Back to projects"
					onPress={() => navigate({ to: "/", search: { tab: "projects" } })}
				>
					<TbArrowLeft size={18} />
				</Button>
				<div>
					<h1 className="text-xl font-semibold tracking-tight">
						Create a project
					</h1>
					<p className="text-xs text-muted">
						Name it, pick who works on it, and set how it runs.
					</p>
				</div>
			</div>

			<nav
				aria-label="Project setup steps"
				className="border-b border-border pb-3"
			>
				<ol className="flex flex-wrap gap-2">
					{STEPS.map((item, index) => {
						const reachable = index === 0 || basicsValid;
						const complete = index < step;
						return (
							<li key={item.key} className="flex-1">
								<button
									type="button"
									disabled={!reachable}
									onClick={() => setStep(index)}
									aria-current={index === step ? "step" : undefined}
									className={cn(
										"flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs font-medium transition-colors",
										reachable
											? index === step
												? "text-foreground"
												: "text-muted hover:bg-surface-secondary hover:text-foreground"
											: "cursor-not-allowed text-muted/50",
									)}
								>
									<span
										className={cn(
											"flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold transition-all",
											complete || index === step
												? "border-accent bg-accent text-accent-foreground"
												: "border-border bg-surface text-muted",
										)}
									>
										{complete ? <TbCheck size={12} strokeWidth={3} /> : index + 1}
									</span>
									<span className="hidden truncate sm:inline">{item.label}</span>
								</button>
							</li>
						);
					})}
				</ol>
			</nav>

			<div className="min-h-[340px]">
				<div>
					<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
						Step {step + 1} of {STEPS.length}
					</p>
					<h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
						{STEP_COPY[currentKey].title}
					</h2>
					<p className="mt-0.5 text-xs text-muted">
						{STEP_COPY[currentKey].description}
					</p>
				</div>

				<div className="mt-4">
					{currentKey === "basics" && (
						<div className="flex flex-col gap-5">
							<TextField
								isRequired
								value={name}
								onChange={setName}
								isInvalid={name.length > 50}
							>
								<Label>Name</Label>
								<Input placeholder="Billing API" autoFocus maxLength={50} />
								<p className="text-xs text-muted">
									2 to 50 characters. Must be unique across the instance.
								</p>
							</TextField>

							<TextField value={description} onChange={setDescription}>
								<Label>Description</Label>
								<TextArea
									rows={3}
									placeholder="What this project is for"
									maxLength={1000}
								/>
							</TextField>
						</div>
					)}

					{currentKey === "members" && (
						<MembersStep members={members} onChange={setMembers} />
					)}

					{currentKey === "config" && (
						<div className="flex flex-col gap-5">
							<Checkbox
								isSelected={workerTimeouts}
								onChange={setWorkerTimeouts}
								label="Enable worker timeouts (experimental)"
								description="Routes in this project can define a timeout, and a request running past it is aborted. Leave off to let requests run to completion."
							/>

							<dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
								<SummaryItem label="Name" value={name.trim()} />
								<SummaryItem
									label="Description"
									value={description.trim() || "—"}
								/>
								<SummaryItem
									label="Members"
									value={
										members.length
											? `${members.length} invited`
											: "None — you can add them later"
									}
								/>
								<SummaryItem
									label="Worker timeouts"
									value={workerTimeouts ? "Enabled" : "Disabled"}
								/>
							</dl>
						</div>
					)}
				</div>
			</div>

			<div className="flex items-center justify-between border-t border-border pt-3.5">
				<Button
					variant="ghost"
					size="sm"
					isDisabled={step === 0}
					onPress={() => setStep(step - 1)}
				>
					<TbArrowLeft size={16} /> Back
				</Button>
				{isLast ? (
					<Button
						variant="primary"
						size="sm"
						isPending={create.isPending}
						isDisabled={!basicsValid}
						onPress={submit}
					>
						Create project
					</Button>
				) : (
					<Button
						variant="primary"
						size="sm"
						isDisabled={!basicsValid}
						onPress={() => setStep(step + 1)}
					>
						Next <TbArrowRight size={16} />
					</Button>
				)}
			</div>
		</div>
	);
}

/** Two-column transfer panel: available users on the left, project members on
 *  the right, moved across with the buttons between them. Highlighting is
 *  multi-select, so a batch of users crosses in one press. */
function MembersStep({
	members,
	onChange,
}: {
	members: Member[];
	onChange: (next: Member[]) => void;
}) {
	const [search, setSearch] = useState("");
	const [availableHighlight, setAvailableHighlight] = useState<string[]>([]);
	const [memberHighlight, setMemberHighlight] = useState<string[]>([]);

	const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } =
		authQuery.listUsers.useInfiniteQuery({ perPage: 50 });

	const added = useMemo(() => members.map((m) => m.userId), [members]);

	const available = useMemo(() => {
		const all = (data?.pages.flatMap((page) => page.data) ?? []) as UserRow[];
		const term = search.toLowerCase();
		return all.filter(
			(user) =>
				!added.includes(user.id) &&
				((user.name?.toLowerCase() ?? "").includes(term) ||
					user.email.toLowerCase().includes(term)),
		);
	}, [data, search, added]);

	function toggle(list: string[], id: string) {
		return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
	}

	function addHighlighted() {
		const moving = available.filter((user) =>
			availableHighlight.includes(user.id),
		);
		onChange([
			...members,
			...moving.map((user) => ({
				userId: user.id,
				role: "viewer" as Role,
				label: user.name || user.email,
			})),
		]);
		setAvailableHighlight([]);
	}

	function removeHighlighted() {
		onChange(members.filter((m) => !memberHighlight.includes(m.userId)));
		setMemberHighlight([]);
	}

	return (
		<div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr]">
			<section className="flex min-w-0 flex-col rounded-xl border border-border">
				<header className="flex items-center justify-between border-b border-border px-3 py-2">
					<h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
						Available
					</h3>
					<span className="text-[11px] text-muted">
						{available.length} user{available.length === 1 ? "" : "s"}
					</span>
				</header>

				<div className="relative border-b border-border p-2">
					<TbSearch
						size={15}
						className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-muted"
					/>
					<Input
						aria-label="Search users"
						placeholder="Search by name or email"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="pl-9"
					/>
				</div>

				<div className="flex h-[280px] flex-col overflow-y-auto p-2">
					<LazyLoader
						items={available}
						isLoading={isLoading}
						isFetchingNextPage={isFetchingNextPage}
						hasNextPage={!!hasNextPage}
						fetchNextPage={fetchNextPage}
						className="flex flex-col gap-1"
						emptyMessage="No users found."
						renderItem={(user: UserRow) => (
							<UserRowButton
								key={user.id}
								label={user.name || user.email}
								sublabel={user.email}
								initials={initialsOf(user.name, user.email)}
								highlighted={availableHighlight.includes(user.id)}
								onToggle={() =>
									setAvailableHighlight(toggle(availableHighlight, user.id))
								}
							/>
						)}
					/>
				</div>
			</section>

			<div className="flex flex-row items-center justify-center gap-2 sm:flex-col">
				<Button
					isIconOnly
					variant="outline"
					size="sm"
					aria-label="Add selected users to the project"
					isDisabled={availableHighlight.length === 0}
					onPress={addHighlighted}
				>
					<TbChevronRight size={16} />
				</Button>
				<Button
					isIconOnly
					variant="outline"
					size="sm"
					aria-label="Remove selected members from the project"
					isDisabled={memberHighlight.length === 0}
					onPress={removeHighlighted}
				>
					<TbChevronLeft size={16} />
				</Button>
			</div>

			<section className="flex min-w-0 flex-col rounded-xl border border-border">
				<header className="flex items-center justify-between border-b border-border px-3 py-2">
					<h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
						Members
					</h3>
					<span className="text-[11px] text-muted">
						{members.length} added
					</span>
				</header>

				<div className="flex h-[336px] flex-col gap-1 overflow-y-auto p-2">
					{members.length === 0 ? (
						<p className="m-auto px-4 text-center text-xs text-muted">
							No members yet. Highlight users on the left and press the arrow to
							add them.
						</p>
					) : (
						members.map((member) => (
							<div
								key={member.userId}
								className={cn(
									"flex items-center gap-2 rounded-lg border p-2 transition-colors",
									memberHighlight.includes(member.userId)
										? "border-accent bg-accent/10"
										: "border-transparent",
								)}
							>
								<button
									type="button"
									aria-pressed={memberHighlight.includes(member.userId)}
									onClick={() =>
										setMemberHighlight(toggle(memberHighlight, member.userId))
									}
									className="min-w-0 flex-1 truncate text-left text-sm text-foreground"
								>
									{member.label}
								</button>
								<Select
									aria-label={`Role for ${member.label}`}
									selectedKey={member.role}
									onSelectionChange={(key) =>
										onChange(
											members.map((m) =>
												m.userId === member.userId
													? { ...m, role: key as Role }
													: m,
											),
										)
									}
								>
									<Select.Trigger className="w-[8.5rem] shrink-0">
										<Select.Value />
										<Select.Indicator />
									</Select.Trigger>
									<Select.Popover>
										<ListBox>
											{ROLE_OPTIONS.map((option) => (
												<ListBox.Item
													key={option.id}
													id={option.id}
													textValue={option.label}
												>
													{option.label}
													<ListBox.ItemIndicator />
												</ListBox.Item>
											))}
										</ListBox>
									</Select.Popover>
								</Select>
							</div>
						))
					)}
				</div>
			</section>
		</div>
	);
}

function UserRowButton({
	label,
	sublabel,
	initials,
	highlighted,
	onToggle,
}: {
	label: string;
	sublabel: string;
	initials: string;
	highlighted: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={highlighted}
			onClick={onToggle}
			className={cn(
				"flex items-center gap-3 rounded-lg border p-2 text-left transition-colors",
				highlighted
					? "border-accent bg-accent/10"
					: "border-transparent hover:bg-surface-secondary",
			)}
		>
			<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-xs font-semibold text-muted-foreground ring-1 ring-border">
				{initials}
			</div>
			<div className="flex min-w-0 flex-col">
				<span className="truncate text-sm font-medium text-foreground">
					{label}
				</span>
				<span className="truncate text-xs text-muted-foreground">
					{sublabel}
				</span>
			</div>
		</button>
	);
}

function SummaryItem({ label, value }: { label: string; value: string }) {
	return (
		<div className="bg-surface px-3 py-2">
			<dt className="text-[11px] uppercase tracking-wide text-muted">
				{label}
			</dt>
			<dd className="mt-0.5 text-sm text-foreground">{value || "—"}</dd>
		</div>
	);
}
