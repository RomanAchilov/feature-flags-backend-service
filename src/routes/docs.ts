import { apiReference } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { openApiDocument } from "../config/openapi";

export const docsRoute = new Hono();

docsRoute.get("/openapi.json", (c) => c.json(openApiDocument));

docsRoute.get(
	"/",
	apiReference({
		theme: "saturn",
		layout: "modern",
		url: "/docs/openapi.json",
	}),
);
