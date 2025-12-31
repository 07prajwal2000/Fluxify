import {
  Box,
  Button,
  Divider,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import React, { useEffect, useState } from "react";
import { TbUserPlus } from "react-icons/tb";
import FormDialog from "../dialog/formDialog";
import { useDisclosure } from "@mantine/hooks";
import UserSearchBar from "../editor/userSearchBar";
import { projectMembersQuery } from "@/query/projectMembersQuery";

type Types = { projectId: string };

const AddProjectMemberButton = (props: Types) => {
  const [opened, { open, close }] = useDisclosure(false);
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const { mutate } = projectMembersQuery.add.useMutation(props.projectId);
  const [selectedMember, setSelectedMember] = useState<{
    user: { id: string; name: string; email: string } | null;
    role: string;
  }>({
    user: null,
    role: "viewer",
  });

  useEffect(() => {
    return () => {
      setUsername("");
      setSelectedMember({
        user: null,
        role: "viewer",
      });
    };
  }, [opened]);

  function onAddToProject() {
    if (!selectedMember.user) return;
    try {
      setLoading(true);
      mutate({
        userId: selectedMember.user.id,
        role: selectedMember.role as any,
      });
      close();
    } catch (error) {
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box>
      <Button
        variant="outline"
        size="xs"
        color="violet"
        onClick={open}
        leftSection={<TbUserPlus size={16} />}
      >
        Add
      </Button>
      <FormDialog
        onClose={close}
        open={opened}
        title="Add a new member to project"
      >
        <UserSearchBar
          description="Search for a user by name or email address"
          placeholder="Find a user"
          onSearch={(e) => setUsername(e)}
          search={username}
          onSelect={(e) =>
            setSelectedMember({ role: selectedMember.role, user: e })
          }
        />
        {selectedMember.user && (
          <Stack my={"sm"}>
            <TextInput
              value={selectedMember.user.name || "<No Name>"}
              readOnly
              label="User name"
            />
            <Paper withBorder p={"sm"}>
              <Stack>
                <Box>
                  <Text>User Info</Text>
                  <Divider />
                </Box>
                <TextInput
                  value={selectedMember.user.email}
                  readOnly
                  label="Email Address"
                />
                <Select
                  data={[
                    { value: "viewer", label: "Viewer" },
                    { value: "creator", label: "Creator" },
                    { value: "project_admin", label: "Project Admin" },
                  ]}
                  value={selectedMember.role}
                  allowDeselect={false}
                  onChange={(e) =>
                    setSelectedMember({ role: e!, user: selectedMember.user })
                  }
                />
              </Stack>
            </Paper>
            <Button loading={loading} color="green.9" onClick={onAddToProject}>
              Add to project
            </Button>
          </Stack>
        )}
      </FormDialog>
    </Box>
  );
};

export default AddProjectMemberButton;
