import { authQuery } from "@/query/authQuery";
import {
  Autocomplete,
  Loader,
  ActionIcon,
  Popover,
  Text,
  Stack,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import React, { useMemo, useState } from "react";
import { TbAlertCircle, TbSearch } from "react-icons/tb";

type User = {
  id: string;
  name: string;
  email: string;
};

type Types = {
  label?: string;
  placeholder?: string;
  description?: string;
  onSelect?(user: User): void;
  search: string;
  onSearch(value: string): void;
};

const UserSearchBar = (props: Types) => {
  const [debouncedSearch] = useDebouncedValue(props.search, 350);
  const [errorPopoverOpened, setErrorPopoverOpened] = useState(false);

  const { data, isLoading, isError, error } = authQuery.listUsers.useQuery({
    page: 1,
    perPage: 10,
    fuzzySearch: debouncedSearch,
  });

  const users = data?.data || [];

  const autocompleteData = useMemo(() => {
    if (!users || users.length === 0) {
      return [];
    }
    return users.map((user: User) => ({
      value: user.id,
      label: `${user.name || "<No Name>"}`, // Include email in label for filtering
      user: user,
    }));
  }, [users]);

  const renderOption = ({ option }: { option: any }) => {
    const user = option.user as User;
    return (
      <Stack gap={2}>
        <Text size="sm">{user.name}</Text>
        <Text size="xs" c="dark.7">
          {user.email}
        </Text>
      </Stack>
    );
  };

  const getRightSection = () => {
    if (isLoading) {
      return <Loader size="sm" />;
    }

    if (isError) {
      return (
        <Popover
          opened={errorPopoverOpened}
          onChange={setErrorPopoverOpened}
          position="bottom-end"
          withArrow
        >
          <Popover.Target>
            <ActionIcon
              color="red"
              variant="subtle"
              onClick={() => setErrorPopoverOpened((o) => !o)}
            >
              <TbAlertCircle size={18} />
            </ActionIcon>
          </Popover.Target>
          <Popover.Dropdown>
            <Text size="sm" c="red">
              {error?.message || "Failed to load users"}
            </Text>
          </Popover.Dropdown>
        </Popover>
      );
    }

    return null;
  };

  return (
    <Autocomplete
      data={autocompleteData}
      value={props.search}
      onChange={props.onSearch}
      c="violet"
      onOptionSubmit={(value) => {
        const selectedUser = users.find((u: User) => u.id === value);
        if (selectedUser && props.onSelect) {
          props.onSelect(selectedUser);
        }
      }}
      label={props.label}
      description={props.description}
      placeholder={props.placeholder}
      renderOption={renderOption}
      leftSection={<TbSearch />}
      rightSection={getRightSection()}
      limit={10}
      clearable
      filter={({ options }) => options} // Disable client-side filtering since we filter on server
    />
  );
};

export default UserSearchBar;
