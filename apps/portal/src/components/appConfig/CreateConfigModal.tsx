import { useState } from "react";
import {
	Button,
	Checkbox,
	CloseButton,
	Input,
	Label,
	Modal,
	TextField,
	toast,
	CustomSelect,
} from "@fluxify/components";
import { TbBraces, TbPlus } from "react-icons/tb";
import { appConfigQuery } from "@/query/appConfigQuery";
import { showErrorNotification } from "@/lib/errorNotifier";

const ENCODINGS = ["plaintext", "base64", "hex"] as const;
const DATA_TYPES = ["string", "number", "boolean"] as const;
const ENCODING_LABELS: Record<(typeof ENCODINGS)[number], string> = {
	plaintext: "Plain text",
	base64: "Base64",
	hex: "Hexadecimal",
};

/**
 * The "New key" button and its dialog. Callers that already have their own
 * trigger — the AI chips offer to create a key the plan referenced — drive it
 * with `isOpen`/`onOpenChange` instead, and can seed the key name.
 */
export function CreateConfigButton({
	projectId,
	isOpen,
	onOpenChange,
	initialKeyName = "",
}: {
	projectId: string;
	isOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	initialKeyName?: string;
}) {
	const create = appConfigQuery.create.mutation(projectId);
	const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
	const controlled = isOpen !== undefined;
	const open = controlled ? isOpen : uncontrolledOpen;
	const setOpen = (next: boolean) => {
		if (!controlled) setUncontrolledOpen(next);
		onOpenChange?.(next);
	};
	const [keyName, setKeyName] = useState(initialKeyName);
	const [description, setDescription] = useState("");
	const [value, setValue] = useState("");
	const [booleanValue, setBooleanValue] = useState(false);
	const [dataType, setDataType] = useState<(typeof DATA_TYPES)[number]>("string");
	const [isEncrypted, setIsEncrypted] = useState(false);
	const [encoding, setEncoding] = useState<(typeof ENCODINGS)[number]>("plaintext");

	function reset() {
		setKeyName(initialKeyName);
		setDescription("");
		setValue("");
		setBooleanValue(false);
		setDataType("string");
		setIsEncrypted(false);
		setEncoding("plaintext");
	}

	function submit(e: React.FormEvent) {
		e.preventDefault();
		const finalValue = dataType === "boolean" ? String(booleanValue) : String(value);

		create.mutate(
			{
				keyName,
				description,
				value: finalValue,
				isEncrypted,
				encodingType: encoding,
				dataType,
			},
			{
				onSuccess: () => {
					toast.success("Config created");
					reset();
					setOpen(false);
				},
				onError: (err) => showErrorNotification(err as Error),
			},
		);
	}

	return (
		<Modal isOpen={open} onOpenChange={setOpen}>
			{!controlled && (
				<Modal.Trigger>
					<Button variant="primary">
						<TbPlus size={16} /> New key
					</Button>
				</Modal.Trigger>
			)}
			<Modal.Backdrop>
				<Modal.Container placement="center" scroll="inside" size="lg">
					<Modal.Dialog>
						<Modal.Header className="flex flex-row items-center justify-between">
							<Modal.Heading>Add a config key</Modal.Heading>
							<CloseButton />
						</Modal.Header>
						<form onSubmit={submit}>
							<Modal.Body>
								<div className="flex flex-col gap-4 pt-2">
									<div className="flex flex-col gap-1">
										<TextField isRequired value={keyName} onChange={setKeyName}>
											<Label>Key name</Label>
											<Input placeholder="API_TIMEOUT" className="font-mono" />
										</TextField>
										<p className="text-xs text-muted mt-1">Use a stable, descriptive name because it cannot be changed after creation.</p>
									</div>

									<div className="grid grid-cols-2 gap-4 mt-2">
										<CustomSelect
											label={
												<div className="flex items-center gap-1.5 text-sm font-medium text-muted">
													<TbBraces size={16} /> Data type
												</div>
											}
											options={DATA_TYPES.map(dt => ({ value: dt, label: dt[0].toUpperCase() + dt.slice(1) }))}
											value={dataType}
											onChange={(dt) => {
												setDataType(dt as any);
												if (dt === "boolean") setBooleanValue(false);
												else setValue("");
											}}
										/>

										<CustomSelect
											label={<span className="text-sm font-medium text-muted">Encoding</span>}
											options={ENCODINGS.map(enc => ({ value: enc, label: ENCODING_LABELS[enc] }))}
											value={encoding}
											onChange={(enc) => setEncoding(enc as any)}
										/>
									</div>

									{dataType === "boolean" ? (
										<div className="flex flex-col gap-1 mt-2">
											<Label className="text-sm font-medium text-foreground">Value</Label>
											<div className="rounded-lg border border-border p-2 bg-surface-50/50">
												<Checkbox isSelected={booleanValue} onChange={setBooleanValue}>
													<Checkbox.Content>
														<Checkbox.Control>
															<Checkbox.Indicator />
														</Checkbox.Control>
														<Label>Boolean Value: {booleanValue ? "True" : "False"}</Label>
													</Checkbox.Content>
												</Checkbox>
											</div>
										</div>
									) : (
										<div className="mt-2">
											<TextField isRequired value={value} onChange={setValue}>
												<Label>Value</Label>
												<Input
													type={dataType === "number" ? "number" : "text"}
													placeholder={dataType === "number" ? "3000" : "Value"}
													className="font-mono"
												/>
											</TextField>
										</div>
									)}

									<div className="mt-2">
										<TextField value={description} onChange={setDescription}>
											<Label>Description</Label>
											<Input placeholder="What this key controls" />
										</TextField>
									</div>

									<div className="mt-2 rounded-lg border border-border p-3 bg-surface-50/50">
										<Checkbox isSelected={isEncrypted} onChange={setIsEncrypted}>
											<Checkbox.Content>
												<Checkbox.Control>
													<Checkbox.Indicator />
												</Checkbox.Control>
												<Label>Encrypt this value in storage</Label>
											</Checkbox.Content>
										</Checkbox>
									</div>
								</div>
							</Modal.Body>
							<Modal.Footer>
								<Button variant="ghost" onPress={() => setOpen(false)}>
									Cancel
								</Button>
								<Button type="submit" variant="primary" isPending={create.isPending}>
									Add key
								</Button>
							</Modal.Footer>
						</form>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
