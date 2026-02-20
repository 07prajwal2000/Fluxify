import { authQuery } from "@/query/authQuery";
import { useAuthStore } from "@/store/auth";
import { notifications } from "@mantine/notifications";
import { useState } from "react";

export function useUsersList() {
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

  const [openPromoteDialog, setOpenPromoteDialog] = useState<{
    open: boolean;
    type: "promote" | "demote";
    user: { name: string; email: string; id: string } | null;
  }>({
    open: false,
    type: "promote",
    user: null,
  });

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

  function handleConfirmPromote() {
    openPromoteDialog.type === "promote" ? confirmPromote() : confirmDemote();
  }

  return {
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
  };
}
