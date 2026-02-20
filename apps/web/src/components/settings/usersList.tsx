"use client";

import { ActionIcon, Badge, Group, Menu, Stack, Table } from "@mantine/core";
import React, { useMemo } from "react";
import Pagination from "../pagination/Pagination";
import QueryLoader from "../query/queryLoader";
import QueryError from "../query/queryError";
import { TbDots, TbTrash } from "react-icons/tb";
import { FaAngleDown, FaAngleUp } from "react-icons/fa6";
import RequireRoleInAnyProject from "../auth/requireRoleInAnyProject";
import ConfirmDialog from "../dialog/confirmDialog";
import AddNewUserForm from "./addNewUserForm";
import { useUsersList } from "./usersList/useUsersList";

const UsersList = () => {
  const {
    page,
    setPage,
    perPage,
    setPerPage,
    userData,
    data,
    isLoading,
    isError,
    error,
    openDeleteDialog,
    setOpenDeleteDialog,
    openPromoteDialog,
    setOpenPromoteDialog,
    handlePromote,
    handleDemote,
    handleDelete,
    confirmDelete,
    handleConfirmPromote,
  } = useUsersList();

  const promotionMessage = useMemo(() => {
    if (!openPromoteDialog.user) return "";
    if (openPromoteDialog.type === "promote") {
      return (
        <div>
          Are you sure you want to promote <b>{openPromoteDialog.user.name}</b>{" "}
          as admin?
        </div>
      );
    } else {
      return (
        <div>
          Are you sure you want to demote <b>{openPromoteDialog.user.name}</b>{" "}
          from admin?
        </div>
      );
    }
  }, [openPromoteDialog]);

  if (!data || isLoading) {
    return <QueryLoader />;
  }

  if (isError) {
    return <QueryError error={error || undefined} />;
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
          {data.data.map((user) => {
            const isCurrentUser = user.id === userData.id;
            const roleMsg = user.role
              ? user.role === "instance_admin"
                ? "System Admin"
                : "User"
              : "No role assigned";
            return (
              <Table.Tr key={user.id}>
                <Table.Td>
                  <Group>
                    <p>{user.name || "<No name>"}</p>
                    {isCurrentUser && <Badge color="violet">Me</Badge>}
                  </Group>
                </Table.Td>
                <Table.Td>{user.email}</Table.Td>
                <Table.Td>{roleMsg}</Table.Td>
                <Table.Td>{user.isSystemAdmin ? "Yes" : "No"}</Table.Td>
                <RequireRoleInAnyProject requiredRole="system_admin">
                  <Table.Td
                    style={{
                      visibility: isCurrentUser ? "hidden" : "visible",
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
            );
          })}
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
        children={promotionMessage}
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
