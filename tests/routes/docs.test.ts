import { describe, expect, it } from "vitest";
import { docsRoute } from "../../src/routes/docs";

describe("docs route", () => {
	it("serves OpenAPI document as JSON", async () => {
		const res = await docsRoute.request("/openapi.json");
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.openapi).toBe("3.1.0");
		expect(body.info?.title).toContain("Feature Flags");
		expect(body.paths?.["/health"]).toBeDefined();
	});

	it("serves an HTML reference page", async () => {
		const res = await docsRoute.request("/");
		const html = await res.text();

		expect(res.status).toBe(200);
		expect(html.toLowerCase()).toContain("<html");
		expect(html).toContain("/docs/openapi.json");
	});
});
