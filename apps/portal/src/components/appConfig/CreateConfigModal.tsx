import { useState } from "react";
import {
	Button,
	Checkbox,
	Input,
	Label,
	Modal,
	TextField,
	toast,
} from "@fluxify/components";
import { TbPlus } from "react-icons/tb";
import { appConfigQuery } from "@/query/appConfigQuery";
import { showErrorNotification } from "@/lib/errorNotifier";

const ENCODINGS = ["plaintext", "base64", "hex"] as const;
const DATA_TYPES = ["string", "number", "boolean"] as const;

export function CreateConfigButton({ projectId }: { projectId: string }) {
	const create = appConfigQuery.create.mutation(projectId);
	const [open, setOpen] = useState(false);
	const [keyName, setKeyName] = useState("");
	const [description, setDescription] = useState("");
	const [value, setValue] = useState("");
	const [booleanValue, setBooleanValue] = useState(false);
	const [dataType, setDataType] = useState<(typeof DATA_TYPES)[number]>("string");
	const [isEncrypted, setIsEncrypted] = useState(false);
	const [encoding, setEncoding] = useState<(typeof ENCODINGS)[number]>("plaintext");

	function reset() {
		setKeyName("");
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
			<Modal.Trigger>
				<Button variant="primary">
					<TbPlus size={16} /> New key
				</Button>
			</Modal.Trigger>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="sm">
					<Modal.Dialog>
						<Modal.Header>
							<Modal.Heading>Add a config key</Modal.Heading>
						</Modal.Header>
						<form onSubmit={submit}>
							<Modal.Body>
								<div className="flex flex-col gap-4">
									<TextField isRequired value={keyName} onChange={setKeyName}>
										<Label>Key name</Label>
										<Input placeholder="API_TIMEOUT" />
									</TextField>

									<div className="flex flex-col gap-1.5">
										<Label>Data Type</Label>
										<div className="flex gap-1.5">
											{DATA_TYPES.map((dt) => (
												<Button
													key={dt}
													type="button"
													size="sm"
													variant={dataType === dt ? "primary" : "outline"}
													onPress={() => setDataType(dt)}
												>
													{dt}
												</Button>
											))}
										</div>
									</div>

									{dataType === "boolean" ? (
										<Checkbox isSelected={booleanValue} onChange={setBooleanValue}>
											<Checkbox.Content>
												<Checkbox.Control>
													<Checkbox.Indicator />
												</Checkbox.Control>
												<Label>Boolean Value: {booleanValue ? "True" : "False"}</Label>
											</Checkbox.Content>
										</Checkbox>
									) : (
										<TextField isRequired value={value} onChange={setValue}>
											<Label>Value</Label>
											<Input
												type={dataType === "number" ? "number" : "text"}
												placeholder={dataType === "number" ? "3000" : "Value"}
											/>
										</TextField>
									)}

									<TextField value={description} onChange={setDescription}>
										<Label>Description</Label>
										<Input placeholder="What this key controls" />
									</TextField>

									<div className="flex flex-col gap-1.5">
										<Label>Encoding</Label>
										<div className="flex gap-1.5">
											{ENCODINGS.map((enc) => (
												<Button
													key={enc}
													type="button"
													size="sm"
													variant={encoding === enc ? "primary" : "outline"}
													onPress={() => setEncoding(enc)}
												>
													{enc}
												</Button>
											))}
										</div>
									</div>

									<Checkbox isSelected={isEncrypted} onChange={setIsEncrypted}>
										<Checkbox.Content>
											<Checkbox.Control>
												<Checkbox.Indicator />
											</Checkbox.Control>
											<Label>Encrypt this value in storage</Label>
										</Checkbox.Content>
									</Checkbox>
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
