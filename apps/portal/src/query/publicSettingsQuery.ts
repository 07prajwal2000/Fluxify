import { useQuery } from "@tanstack/react-query";
import { publicSettingsService } from "@/services/publicSettings";

const KEY = ["public-settings"];

export const publicSettingsQuery = {
	get: {
		useQuery() {
			return useQuery({
				queryKey: KEY,
				queryFn: () => publicSettingsService.get(),
				refetchOnWindowFocus: false,
			});
		},
	},
};
