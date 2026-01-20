import { notifications } from "@mantine/notifications";
import { isAxiosError } from "axios";

export function showErrorNotification(
  error?: Error,
  showValidationErrors: boolean = true
) {
  if (isAxiosError(error)) {
    if (error.response?.status === 400) {
      if (error.response.data.type === "validation") {
        if (!showValidationErrors) {
          notifications.show({
            message: "Validation Error. Please provide valid data.",
            color: "red",
            withCloseButton: true,
          });
          return;
        }
        for (let err of error.response.data.errors) {
          notifications.show({
            title: "Validation Error",
            message: `Message: ${err.message}\nField: ${err.field}`,
            color: "red",
            withCloseButton: true,
          });
        }
      } else {
        notifications.show({
          message: error?.response?.data?.message || "Unknown error occured",
          color: "red",
          withCloseButton: true,
        });
      }
    } else {
      notifications.show({
        message: error.response?.data?.message || "Unknown error occured",
        color: "red",
        withCloseButton: true,
      });
    }
  } else {
    notifications.show({
      message: `Failed to send request to server. Please see developer console for more details.`,
      color: "red",
      withCloseButton: true,
    });
  }
}
