import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
	bodyLimitMiddleware,
	corsMiddleware,
	rateLimit,
	requestId,
	requireRole,
	securityHeaders,
} from "../../src/middleware/security";

describe("security middleware", () => {
	describe("rateLimit", () => {
		it("allows requests under the limit", async () => {
			const app = new Hono();
			app.use("*", rateLimit({ windowMs: 60_000, limit: 5 }));
			app.get("/", (c) => c.text("ok"));

			for (let i = 0; i < 5; i++) {
				const res = await app.request("/", {
					headers: { "x-forwarded-for": "192.168.1.1" },
				});
				expect(res.status).toBe(200);
			}
		});

		it("returns 429 when rate limit is exceeded", async () => {
			const app = new Hono();
			app.use("*", rateLimit({ windowMs: 60_000, limit: 3 }));
			app.get("/", (c) => c.text("ok"));

			// 3 requests should pass
			for (let i = 0; i < 3; i++) {
				await app.request("/", {
					headers: { "x-forwarded-for": "10.0.0.1" },
				});
			}

			// 4th request should be rate limited
			const res = await app.request("/", {
				headers: { "x-forwarded-for": "10.0.0.1" },
			});

			expect(res.status).toBe(429);
			const body = await res.json();
			expect(body.error.code).toBe("rate_limit_exceeded");
		});

		it("tracks different IPs separately", async () => {
			const app = new Hono();
			app.use("*", rateLimit({ windowMs: 60_000, limit: 2 }));
			app.get("/", (c) => c.text("ok"));

			// Exhaust limit for IP 1
			await app.request("/", { headers: { "x-forwarded-for": "1.1.1.1" } });
			await app.request("/", { headers: { "x-forwarded-for": "1.1.1.1" } });

			// IP 2 should still have quota
			const res = await app.request("/", {
				headers: { "x-forwarded-for": "2.2.2.2" },
			});
			expect(res.status).toBe(200);
		});
	});

	describe("requireRole", () => {
		it("allows access when user has required role", async () => {
			const app = new Hono<{
				Variables: { currentUser: { roles: string[] } };
			}>();
			app.use("*", async (c, next) => {
				c.set("currentUser", { roles: ["admin", "editor"] });
				await next();
			});
			app.use("*", requireRole("admin"));
			app.get("/", (c) => c.text("ok"));

			const res = await app.request("/");
			expect(res.status).toBe(200);
		});

		it("denies access when user lacks required role", async () => {
			const app = new Hono<{
				Variables: { currentUser: { roles: string[] } };
			}>();
			app.use("*", async (c, next) => {
				c.set("currentUser", { roles: ["viewer"] });
				await next();
			});
			app.use("*", requireRole("admin"));
			app.get("/", (c) => c.text("ok"));

			const res = await app.request("/");
			expect(res.status).toBe(403);
			const body = await res.json();
			expect(body.error.code).toBe("forbidden");
		});

		it("denies access when user has no roles", async () => {
			const app = new Hono<{
				Variables: { currentUser: { roles?: string[] } };
			}>();
			app.use("*", async (c, next) => {
				c.set("currentUser", {});
				await next();
			});
			app.use("*", requireRole("admin"));
			app.get("/", (c) => c.text("ok"));

			const res = await app.request("/");
			expect(res.status).toBe(403);
		});
	});

	describe("requestId", () => {
		it("generates a request ID when not provided", async () => {
			const app = new Hono<{ Variables: { requestId: string } }>();
			app.use("*", requestId());
			app.get("/", (c) => c.json({ id: c.get("requestId") }));

			const res = await app.request("/");
			expect(res.status).toBe(200);
			expect(res.headers.get("X-Request-ID")).toBeDefined();

			const body = await res.json();
			expect(body.id).toBeDefined();
			expect(body.id).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
			);
		});

		it("uses provided request ID", async () => {
			const app = new Hono<{ Variables: { requestId: string } }>();
			app.use("*", requestId());
			app.get("/", (c) => c.json({ id: c.get("requestId") }));

			const res = await app.request("/", {
				headers: { "x-request-id": "my-custom-id" },
			});

			expect(res.headers.get("X-Request-ID")).toBe("my-custom-id");
			const body = await res.json();
			expect(body.id).toBe("my-custom-id");
		});
	});

	describe("securityHeaders", () => {
		it("sets security headers on response", async () => {
			const app = new Hono();
			app.use("*", securityHeaders());
			app.get("/", (c) => c.text("ok"));

			const res = await app.request("/");
			expect(res.headers.get("X-Frame-Options")).toBe("DENY");
			expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
		});
	});

	describe("corsMiddleware", () => {
		it("adds CORS headers", async () => {
			const app = new Hono();
			app.use("*", corsMiddleware(["https://example.com"], true));
			app.get("/", (c) => c.text("ok"));

			const res = await app.request("/", {
				headers: { Origin: "https://example.com" },
			});

			expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
				"https://example.com",
			);
			expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
		});
	});

	describe("bodyLimitMiddleware", () => {
		it("allows requests within body limit", async () => {
			const app = new Hono();
			app.use("*", bodyLimitMiddleware(1024));
			app.post("/", async (c) => {
				const body = await c.req.text();
				return c.text(`received: ${body.length} bytes`);
			});

			const res = await app.request("/", {
				method: "POST",
				body: "x".repeat(100),
			});

			expect(res.status).toBe(200);
		});
	});
});
