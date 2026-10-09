import { describe, expect, it, mock, spyOn } from "bun:test";
import handleRequest from "../service";
import * as repo from "../repository";

const getBasicListRepositoryMock = spyOn(repo, "getBasicListRepository");

describe("get-basic-list integrations service", () => {
	it("should map results correctly from repository", async () => {
		getBasicListRepositoryMock.mockResolvedValue([
			{
				id: "int_1",
				name: "DB",
				group: "db",
				variant: "postgres",
			},
			{
				id: "int_2",
				name: "Email",
				group: "email",
				variant: "smtp",
			},
		]);

		const result = await handleRequest("proj_1");

		expect(getBasicListRepositoryMock).toHaveBeenCalledWith("proj_1");
		expect(result).toEqual([
			{
				id: "int_1",
				name: "DB",
				group: "db",
				variant: "postgres",
			},
			{
				id: "int_2",
				name: "Email",
				group: "email",
				variant: "smtp",
			},
		]);
	});

	it("should handle empty fields safely", async () => {
		getBasicListRepositoryMock.mockResolvedValue([
			{
				id: "int_3",
				name: null,
				group: null,
				variant: null,
			},
		]);

		const result = await handleRequest("proj_1");

		expect(result).toEqual([
			{
				id: "int_3",
				name: "",
				group: "",
				variant: "",
			},
		]);
	});
});
