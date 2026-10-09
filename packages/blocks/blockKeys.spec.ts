import { describe, expect, it } from "bun:test";
import { blockKeyPrefix, blockKeyPrefixOf, formatBlockKey } from "./blockKeys";
import { BlockTypes } from "./blockTypes";

describe("block keys", () => {
	it("a built-in block's prefix is its type", () => {
		expect(blockKeyPrefix(BlockTypes.response)).toBe("response");
		expect(blockKeyPrefix(BlockTypes.errorHandler)).toBe("error_handler");
		expect(formatBlockKey(blockKeyPrefix(BlockTypes.db_insert), 2)).toBe("db_insert_2");
	});

	it("a custom block's prefix is custom_<name>, without the project namespace", () => {
		expect(blockKeyPrefix("user_defined.project.send_mail")).toBe("custom_send_mail");
		// inhouse and plugin blocks are stored bare
		expect(blockKeyPrefix("jwt_validate")).toBe("custom_jwt_validate");
		expect(blockKeyPrefix("acme.plugin-x")).toBe("custom_acme_plugin_x");
	});

	it("a custom block named like a built-in does not share its prefix", () => {
		expect(blockKeyPrefix("user_defined.project.response")).toBe("custom_response");
	});

	it("reads the prefix back off a key", () => {
		expect(blockKeyPrefixOf("db_insert_12")).toBe("db_insert");
		expect(blockKeyPrefixOf("custom_send_mail_1")).toBe("custom_send_mail");
		expect(blockKeyPrefixOf("response")).toBeUndefined();
		expect(blockKeyPrefixOf("01a11e04-fc64-7ff7-8e9d-000000000003")).toBeUndefined();
	});
});
