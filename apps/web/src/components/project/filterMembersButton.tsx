import {
  ActionIcon,
  Box,
  Button,
  Indicator,
  Menu,
  NativeSelect,
  Stack,
  Text,
} from "@mantine/core";
import React from "react";
import { TbFilter, TbSearch } from "react-icons/tb";
import DebouncedTextInput from "../editors/debouncedTextInput";
import {
  useProjectSettingsActions,
  useProjectSettingsMembersStore,
} from "@/store/projectSettings";

const FilterMembersButton = () => {
  const { filter } = useProjectSettingsMembersStore();
  const { setMembersFilter, resetMembersFilter } = useProjectSettingsActions();

  return (
    <Box>
      <Menu withArrow arrowSize={18} shadow="sm">
        <Menu.Target>
          <Indicator
            color={"red.8"}
            disabled={filter.name == "" && filter.role == ""}
          >
            <ActionIcon variant="outline" color="violet">
              <TbFilter size={18} />
            </ActionIcon>
          </Indicator>
        </Menu.Target>
        <Menu.Dropdown p={"sm"}>
          <Stack gap={"xs"}>
            <Box>
              <Text>Filter</Text>
              <Menu.Divider />
            </Box>
            <DebouncedTextInput
              debounceDelay={350}
              value={filter.name}
              description="Type name of user to filter members"
              placeholder="Search Members"
              leftSection={<TbSearch size={18} />}
              onValueChange={(e) => setMembersFilter(e, filter.role as any)}
            />
            <NativeSelect
              value={filter.role}
              description="Choose role to filter members"
              data={[
                { label: "", value: "" },
                { label: "Viewer", value: "viewer" },
                { label: "Creator", value: "creator" },
                { label: "Project Admin", value: "project_admin" },
              ]}
              onChange={(e) =>
                setMembersFilter(
                  filter.name,
                  (e.currentTarget.value || "") as any
                )
              }
            />
            <Button
              variant="outline"
              color="violet"
              size="xs"
              onClick={resetMembersFilter}
            >
              Clear
            </Button>
          </Stack>
        </Menu.Dropdown>
      </Menu>
    </Box>
  );
};

export default FilterMembersButton;
