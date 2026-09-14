import { describe, it, expect } from "bun:test";
import { grpcExporterOptions, normalizePem, probeGrpc } from "../grpc";

const BODY = "A".repeat(100);

describe("normalizePem", () => {
	it("rebuilds a PEM whose line breaks were stripped by a single-line input", () => {
		const flat = `-----BEGIN CERTIFICATE-----${BODY}-----END CERTIFICATE-----`;
		expect(normalizePem(flat)).toBe(
			`-----BEGIN CERTIFICATE-----\n${"A".repeat(64)}\n${"A".repeat(36)}\n-----END CERTIFICATE-----\n`,
		);
	});

	it("keeps every block of a chain and leaves a well-formed PEM as it was", () => {
		const one = normalizePem(`-----BEGIN CERTIFICATE-----${BODY}-----END CERTIFICATE-----`);
		const key = normalizePem(`-----BEGIN PRIVATE KEY-----${BODY}-----END PRIVATE KEY-----`);
		expect(normalizePem(one + key)).toBe(one + key);
	});
});

describe("grpcExporterOptions", () => {
	it("picks credentials from the TLS mode, not the url scheme", () => {
		const secure = (tlsMode: "none" | "tls") =>
			grpcExporterOptions("http://collector:4317", {}, { tlsMode }).credentials._isSecure();
		expect(secure("none")).toBe(false);
		expect(secure("tls")).toBe(true);
	});

	it("sends headers as metadata and skips keys gRPC rejects", () => {
		const { metadata } = grpcExporterOptions(
			"http://collector:4317",
			{ "X-Tenant": "acme", "bad key": "x" },
			{ tlsMode: "none" },
		);
		expect(metadata.get("x-tenant")).toEqual(["acme"]);
		expect(Object.keys(metadata.getMap())).toEqual(["x-tenant"]);
	});
});

describe("probeGrpc", () => {
	for (const signal of ["logs", "traces", "metrics"] as const) {
		it(`fails ${signal} when nothing listens`, async () => {
			expect(await probeGrpc(signal, "http://127.0.0.1:1", {}, { tlsMode: "none" })).toBe(false);
		});
	}
});
