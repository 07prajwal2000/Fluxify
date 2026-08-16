import {
	Button,
	DeleteIconButton,
	JavaScriptTextArea,
	Label,
	ListBox,
	Select,
	cn,
} from "@fluxify/components";
import { TbPlus } from "react-icons/tb";
import {
	ASSERTION_TARGETS,
	OPERATOR_LABELS,
	TARGET_LABELS,
	type Assertion,
	type AssertionOperator,
	type AssertionTarget,
	allowsPropertyPath,
	needsExpectedValue,
	normalizeAssertion,
	operatorsFor,
	validateAssertions,
} from "./assertions";

const inputClass =
	"w-full rounded-md border border-border bg-background-secondary px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent";

function AssertionRow({
	assertion,
	error,
	onChange,
	onRemove,
}: {
	assertion: Assertion;
	error?: string;
	onChange: (next: Assertion) => void;
	onRemove: () => void;
}) {
	const { target, operator } = assertion;
	// Switching a target drops the fields it forbids, so the payload can never
	// carry a stale property path the server would reject.
	const setTarget = (next: AssertionTarget) =>
		onChange(normalizeAssertion({ ...assertion, target: next }));
	const setOperator = (next: AssertionOperator) =>
		onChange(normalizeAssertion({ ...assertion, operator: next }));

	return (
		<div className="rounded-lg border border-border bg-background-secondary p-3">
			{/* items-start only for customJs, whose editor is several rows tall;
			    every other row is a single line and should sit on one baseline */}
			<div
				className={cn(
					"flex gap-2",
					target === "customJs" ? "items-start" : "items-center",
				)}
			>
				<Select
					aria-label="Assertion target"
					selectedKey={target}
					onSelectionChange={(key) => key && setTarget(key as AssertionTarget)}
					className="w-40 shrink-0"
				>
					<Select.Trigger>
						<span className="truncate text-xs">{TARGET_LABELS[target]}</span>
						<Select.Indicator />
					</Select.Trigger>
					<Select.Popover>
						<ListBox>
							{ASSERTION_TARGETS.map((item) => (
								<ListBox.Item key={item} id={item} textValue={TARGET_LABELS[item]}>
									<span className="text-xs">{TARGET_LABELS[item]}</span>
									<ListBox.ItemIndicator />
								</ListBox.Item>
							))}
						</ListBox>
					</Select.Popover>
				</Select>

				{target === "customJs" ? (
					<div className="min-w-0 flex-1">
						<JavaScriptTextArea
							rows={4}
							value={assertion.customJs ?? ""}
							onChange={(customJs) => onChange({ ...assertion, customJs })}
						/>
						<span className="mt-1 block text-xs text-muted">
							Receives <code>body</code>, <code>headers</code>, <code>status</code> and{" "}
							<code>request</code>. A truthy result passes.
						</span>
					</div>
				) : (
					// one line: [path/header] [operator] [expected value] — the pieces read
					// as a sentence, so stacking them is what broke the alignment
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
						{(target === "header" || allowsPropertyPath(target)) && (
							<input
								className={cn(inputClass, "min-w-[8rem] flex-1")}
								placeholder={
									target === "header" ? "Header name" : "Property path (optional)"
								}
								value={assertion.propertyPath ?? ""}
								onChange={(e) => onChange({ ...assertion, propertyPath: e.target.value })}
							/>
						)}

						<Select
							aria-label="Operator"
							selectedKey={operator ?? null}
							onSelectionChange={(key) => key && setOperator(key as AssertionOperator)}
							className="w-36 shrink-0"
						>
							<Select.Trigger>
								<span className="truncate text-xs">
									{operator ? OPERATOR_LABELS[operator] : "Pick one"}
								</span>
								<Select.Indicator />
							</Select.Trigger>
							<Select.Popover>
								<ListBox>
									{/* only the operators this target accepts — the invalid pairs
									    the server rejects are never offered */}
									{operatorsFor(target).map((item) => (
										<ListBox.Item key={item} id={item} textValue={OPERATOR_LABELS[item]}>
											<span className="text-xs">{OPERATOR_LABELS[item]}</span>
											<ListBox.ItemIndicator />
										</ListBox.Item>
									))}
								</ListBox>
							</Select.Popover>
						</Select>

						{needsExpectedValue(target, operator) && (
							<input
								className={cn(inputClass, "min-w-[6rem] flex-1")}
								inputMode={target === "status" || target === "time" ? "numeric" : "text"}
								placeholder="Expected value"
								value={assertion.expectedValue ?? ""}
								onChange={(e) => onChange({ ...assertion, expectedValue: e.target.value })}
							/>
						)}
					</div>
				)}

				<DeleteIconButton aria-label="Remove assertion" size="sm" onPress={onRemove} />
			</div>

			{error && <p className="mt-2 text-xs text-danger">{error}</p>}
		</div>
	);
}

export function AssertionsEditor({
	assertions,
	onChange,
}: {
	assertions: Assertion[];
	onChange: (next: Assertion[]) => void;
}) {
	const errors = validateAssertions(assertions);

	function replace(index: number, next: Assertion) {
		onChange(assertions.map((item, i) => (i === index ? next : item)));
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between">
				<Label>Assertions</Label>
				<Button
					variant="outline"
					size="sm"
					onPress={() =>
						onChange([
							...assertions,
							{ target: "status", operator: "eq", expectedValue: "200" },
						])
					}
				>
					<TbPlus size={15} /> Add assertion
				</Button>
			</div>

			{assertions.length === 0 ? (
				<div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted">
					No assertions yet. A suite without one only checks that the route runs.
				</div>
			) : (
				assertions.map((assertion, index) => (
					<AssertionRow
						// eslint-disable-next-line react/no-array-index-key -- assertions are an ordered list with no id
						key={index}
						assertion={assertion}
						error={errors.get(index)}
						onChange={(next) => replace(index, next)}
						onRemove={() => onChange(assertions.filter((_, i) => i !== index))}
					/>
				))
			)}
		</div>
	);
}
