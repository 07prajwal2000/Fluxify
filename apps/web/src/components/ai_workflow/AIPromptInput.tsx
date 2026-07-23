import React, { useRef, useEffect } from "react";
import { Textarea, ActionIcon, Group } from "@mantine/core";
import { TbSend, TbLayoutSidebarRightExpand } from "react-icons/tb";
import { useTypewriter } from "@/hooks/useTypewriter";

interface AIPromptInputProps {
	value: string;
	onChange: (value: string) => void;
	onSend: () => void;
	isLoading?: boolean;
	showSidebarToggle?: boolean;
	onToggleSidebar?: () => void;
	placeholderTexts?: string[];
	staticPlaceholder?: string;
	autoFocus?: boolean;
	minRows?: number;
	maxRows?: number;
	disabled?: boolean;
}

const DEFAULT_PLACEHOLDERS = [
	"Build a REST API for a blog...",
	"Create a PostgreSQL schema for users...",
	"Add MongoDB integration to my app...",
	"Set up user authentication and secrets...",
	"Generate a fully functional e-commerce backend...",
];

export const AIPromptInput = ({
	value,
	onChange,
	onSend,
	isLoading,
	showSidebarToggle,
	onToggleSidebar,
	placeholderTexts = DEFAULT_PLACEHOLDERS,
	staticPlaceholder,
	autoFocus = true,
	minRows = 1,
	maxRows = 6,
	disabled = false,
}: AIPromptInputProps) => {
	const typeWriterPlaceholder = useTypewriter(placeholderTexts, 40, 30, 2500);
	const placeholder = staticPlaceholder || typeWriterPlaceholder;
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (autoFocus && textareaRef.current) {
			textareaRef.current.focus();
		}
	}, [autoFocus]);

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && e.ctrlKey) {
			onChange(value + "\n");
		} else if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			onSend();
		}
	};

	return (
		<Group align="flex-end" gap="xs" w="100%">
			<Textarea
				ref={textareaRef}
				style={{ flex: 1 }}
				placeholder={placeholder}
				minRows={minRows}
				maxRows={maxRows}
				autosize
				value={value}
				onChange={(e) => onChange(e.currentTarget.value)}
				onKeyDown={handleKeyDown}
				radius="xl"
				disabled={disabled}
				styles={{
					input: {
						backgroundColor: "#f1f3f5",
						border: "none",
						paddingRight: 60,
						paddingLeft: 24,
						paddingTop: 16,
						paddingBottom: 16,
						fontSize: "1rem",
						boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
						transition: "all 0.2s ease",
					},
				}}
				rightSection={
					<ActionIcon
						radius="xl"
						size="lg"
						color="violet"
						variant="filled"
						mb={4}
						mr={16}
						onClick={onSend}
						loading={isLoading}
						disabled={disabled || (!value.trim() && !isLoading)}
					>
						<TbSend size={20} />
					</ActionIcon>
				}
				rightSectionProps={{
					style: { alignItems: "flex-end", paddingBottom: "4px" },
				}}
			/>

			{showSidebarToggle && (
				<ActionIcon
					size="xl"
					radius="xl"
					variant="light"
					onClick={onToggleSidebar}
				>
					<TbLayoutSidebarRightExpand size={20} />
				</ActionIcon>
			)}
		</Group>
	);
};
