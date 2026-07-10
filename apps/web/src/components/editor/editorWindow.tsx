"use client";

import { EditorTab, useEditorTabStore } from "@/store/editor";
import React from "react";
import ExecutionPanel from "./panels/executionPanel";
import TestingPanel from "./panels/testingPanel";
import FlowEditor from "./flowEditor";

const EditorWindow = () => {
	const { activeTab } = useEditorTabStore();

	if (activeTab === EditorTab.EDITOR) {
		return <FlowEditor />;
	} else if (activeTab === EditorTab.EXECUTIONS) {
		return <ExecutionPanel />;
	}
	return <TestingPanel />;
};

export default EditorWindow;
