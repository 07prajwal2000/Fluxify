"use client";

import { ActionIcon, Badge, Group, Menu, Stack, Table } from "@mantine/core";
import React, { useState } from "react";
import Pagination from "../pagination/Pagination";
import { authQuery } from "@/query/authQuery";
import QueryLoader from "../query/queryLoader";
import QueryError from "../query/queryError";
import { TbDots, TbTrash } from "react-icons/tb";
import { FaAngleDown, FaAngleUp } from "react-icons/fa6";
import RequireRoleInAnyProject from "../auth/requireRoleInAnyProject";
import ConfirmDialog from "../dialog/confirmDialog";
import AddNewUserForm from "./addNewUserForm";
import { useAuthStore } from "@/store/auth";
import { showErrorNotification } from "@/lib/errorNotifier";
import { notifications, showNotification } from "@mantine/notifications";

const UsersList = () => {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const { userData } = useAuthStore();
  const { mutate: updateUserPartial } = authQuery.updateUserPartial.mutation();
  const { mutate: deleteUser } = authQuery.deleteUser.mutation();
  const { data, isLoading, isError, error } = authQuery.listUsers.useQuery({
    page,
    perPage,
  });
  const [openDeleteDialog, setOpenDeleteDialog] = useState<{
    open: boolean;
    user: { name: string; email: string; id: string } | null;
  }>({
    open: false,
    user: null,
  });
  // add promote/demote state with type=promote/demote
  const [openPromoteDialog, setOpenPromoteDialog] = useState<{
    open: boolean;
    type: "promote" | "demote";
    user: { name: string; email: string; id: string } | null;
  }>({
    open: false,
    type: "promote",
    user: null,
  });

  if (!data || isLoading) {
    return <QueryLoader />;
  }

  if (isError) {
    return <QueryError error={error} />;
  }

  function handlePromote(user: { name: string; email: string; id: string }) {
    setOpenPromoteDialog({
      open: true,
      type: "promote",
      user,
    });
  }
  function handleDemote(user: { name: string; email: string; id: string }) {
    setOpenPromoteDialog({
      open: true,
      type: "demote",
      user,
    });
  }

  function handleDelete(user: { name: string; email: string; id: string }) {
    setOpenDeleteDialog({
      open: true,
      user,
    });
  }

  function handleConfirmPromote() {
    openPromoteDialog.type === "promote" ? confirmPromote() : confirmDemote();
  }
  function confirmPromote() {
    const notificationId = "promote-notification-id";
    try {
      notifications.show({
        id: notificationId,
        message: "Promoting user...",
        loading: true,
      });
      updateUserPartial({
        userId: openPromoteDialog.user!.id,
        isSystemAdmin: true,
      });
      notifications.update({
        id: notificationId,
        message: "User promoted successfully",
        color: "green",
        loading: false,
      });
      setOpenPromoteDialog({
        open: false,
        type: "promote",
        user: null,
      });
    } catch (error: any) {
      notifications.update({
        id: notificationId,
        message: "Failed to promote user",
        color: "red",
      });
    }
  }

  function confirmDemote() {
    const notificationId = "demote-notification-id";
    try {
      notifications.show({
        id: notificationId,
        message: "Demoting user...",
        loading: true,
      });
      updateUserPartial({
        userId: openPromoteDialog.user!.id,
        isSystemAdmin: false,
      });
      notifications.update({
        id: notificationId,
        message: "User demoted successfully",
        color: "green",
        loading: false,
      });
      setOpenPromoteDialog({
        open: false,
        type: "demote",
        user: null,
      });
    } catch (error: any) {
      notifications.update({
        id: notificationId,
        message: "Failed to demote user",
        color: "red",
        loading: false,
      });
    }
  }

  function confirmDelete() {
    const notificationId = "delete-notification-id";
    try {
      notifications.show({
        id: notificationId,
        message: "Deleting user...",
        loading: true,
      });
      deleteUser(openDeleteDialog.user!.id);
      notifications.update({
        id: notificationId,
        message: "User deleted successfully",
        color: "green",
        loading: false,
      });
      setOpenDeleteDialog({
        open: false,
        user: null,
      });
    } catch (error: any) {
      notifications.update({
        id: notificationId,
        message: "Failed to delete user",
        color: "red",
        loading: false,
      });
    }
  }

  return (
    <Stack>
      <Group justify="end">
        <RequireRoleInAnyProject requiredRole="system_admin">
          <AddNewUserForm />
        </RequireRoleInAnyProject>
        <Pagination
          page={page}
          perPage={perPage}
          totalPages={data.pagination.totalPages}
          onPageChange={setPage}
          onPerPageChange={setPerPage}
        />
      </Group>
      <Table stickyHeader highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Email</Table.Th>
            <Table.Th>Role</Table.Th>
            <Table.Th>System Admin</Table.Th>
            <RequireRoleInAnyProject requiredRole="system_admin">
              <Table.Th></Table.Th>
            </RequireRoleInAnyProject>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {data.data.map((user) => (
            <Table.Tr key={user.id}>
              <Table.Td>
                <Group>
                  <p>{user.name || "<No name>"}</p>
                  {user.id === userData.id && <Badge color="violet">Me</Badge>}
                </Group>
              </Table.Td>
              <Table.Td>{user.email}</Table.Td>
              <Table.Td>{user.role || "No role assigned"}</Table.Td>
              <Table.Td>{user.isSystemAdmin ? "Yes" : "No"}</Table.Td>
              <RequireRoleInAnyProject requiredRole="system_admin">
                <Table.Td
                  style={{
                    visibility: user.id === userData.id ? "hidden" : "visible",
                  }}
                >
                  <Menu withArrow arrowSize={15} shadow="sm">
                    <Menu.Target>
                      <ActionIcon variant="subtle" color="violet">
                        <TbDots />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {user.isSystemAdmin ? (
                        <Menu.Item
                          onClick={() => handleDemote(user)}
                          leftSection={<FaAngleDown size={15} />}
                        >
                          Demote
                        </Menu.Item>
                      ) : (
                        <Menu.Item
                          onClick={() => handlePromote(user)}
                          leftSection={<FaAngleUp size={15} />}
                        >
                          Promote
                        </Menu.Item>
                      )}
                      <Menu.Item
                        color="red"
                        leftSection={<TbTrash size={15} />}
                        onClick={() => handleDelete(user)}
                      >
                        Delete User
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </RequireRoleInAnyProject>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <ConfirmDialog
        title="Are you sure?"
        children={
          <span>
            Are you sure you want to delete <b>{openDeleteDialog.user?.name}</b>
            ?
          </span>
        }
        open={openDeleteDialog.open}
        onClose={() => setOpenDeleteDialog({ open: false, user: null })}
        confirmColor="red"
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={confirmDelete}
      />
      <ConfirmDialog
        title="Are you sure?"
        children={
          <span>
            Are you sure you want to {openPromoteDialog.type}{" "}
            <b>{openPromoteDialog.user?.name}</b>?
          </span>
        }
        open={openPromoteDialog.open}
        onClose={() =>
          setOpenPromoteDialog({ open: false, user: null, type: "promote" })
        }
        confirmColor={openPromoteDialog.type === "promote" ? "violet" : "red"}
        confirmText={
          openPromoteDialog.type === "promote" ? "Promote" : "Demote"
        }
        cancelText="Cancel"
        onConfirm={handleConfirmPromote}
      />
    </Stack>
  );
};

export default UsersList;
