import { EditorTab, useEditorTabStore } from "@/store/editor";
import { Tabs, useMantineTheme } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const EditorTabs = {
  [EditorTab.EDITOR]: "Editor",
  [EditorTab.EXECUTIONS]: "Executions",
  [EditorTab.TESTING]: "Testing",
};

const EditorTopbarTabs = () => {
  const { activeTab, setEditorTab } = useEditorTabStore();
  const router = useRouter();
  const violet = useMantineTheme().colors.violet;

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const tab = query.get("tab");
    if (tab && tab in EditorTabs) {
      setEditorTab(tab as EditorTab);
    } else {
      router.push(`?tab=${EditorTab.EDITOR}`);
    }
  }, []);

  function handleTabChange(value: string) {
    setEditorTab(value as EditorTab);
    router.push(`?tab=${value}`);
  }

  return (
    <Tabs
      bg={violet[0]}
      bd={"2px solid violet"}
      w={"fit-content"}
      p={2}
      bdrs={"sm"}
      variant="pills"
      color="violet"
      value={activeTab}
      onChange={(value) => handleTabChange(value!)}
    >
      <Tabs.List>
        <Tabs.Tab value={EditorTab.EDITOR}>Editor</Tabs.Tab>
        <Tabs.Tab value={EditorTab.EXECUTIONS}>Executions</Tabs.Tab>
        <Tabs.Tab value={EditorTab.TESTING}>Testing</Tabs.Tab>
      </Tabs.List>
    </Tabs>
  );
};

export default EditorTopbarTabs;
