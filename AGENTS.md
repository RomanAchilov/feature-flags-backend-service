# AGENTS.md

## Project overview

- This repository is a **TypeScript backend service** built with **Hono**.
- Target runtime: Node.js for local development, edge/serverless platforms in production.
- Main entrypoint: `src/app.ts` exporting a configured `Hono` instance.

## Setup commands

- Install dependencies: `npm install`
- Start dev server: `npm dev`
- Run lints (Biome): `npm lint`
- Type-check the project: `npm typecheck`
- Run tests: `npm test`

When you propose or apply changes, prefer using these existing scripts instead of adding new ad-hoc commands.

---

## Architecture & patterns

Follow common backend design patterns and keep responsibilities separate:

- HTTP layer:
  - Use **Hono routes** only for HTTP concerns: routing, params, auth, validation, and mapping results to HTTP responses.
  - Do **not** place database queries or business logic directly in route definitions.

- Structure:
  - `src/routes/**` – Hono route modules (`/users`, `/auth`, `/health`, etc.)
  - `src/controllers/**` – request handlers that orchestrate services and map domain errors to HTTP responses.
  - `src/services/**` – business logic (stateless, pure where possible).
  - `src/repositories/**` – data access layer (DB, external APIs, queues, etc.).
  - `src/config/**` – configuration, environment variables, app-wide constants.
  - `tests/**` – tests mirroring the `src/` structure.

- Dependency flow:
  - Routes → Controllers → Services → Repositories → External systems.
  - Do **not** depend in the opposite direction.

- Error handling:
  - Use centralized Hono middleware for error and logging when possible.
  - Map domain errors to proper HTTP status codes (e.g., 400, 404, 409, 422, 500).
  - Return structured JSON error responses with a stable shape:
    - `{ error: { code: string, message: string, details?: unknown } }`.

---

## Hono-specific guidance

- Prefer idiomatic Hono patterns and APIs as described in:
  - https://hono.dev/llms-small.txt (concise docs)
  - https://hono.dev/llms-full.txt (full developer docs)
  - https://hono.dev/docs/guides/best-practices

- Hono CLI (use these before adding custom scripts or tools):
  - Show docs locally: `npx hono docs` (optionally pass a path).
  - Search docs quickly: `npx hono search "<query>"`.
  - Run the app with the built-in server: `npx hono serve src/index.ts --watch --port 3000` (change entry if different).
  - Send quick requests without curl: `echo "GET /" | npx hono request src/index.ts` (or point to a file with HTTP request data).
  - Produce an optimized bundle if explicitly needed: `npx hono optimize src/index.ts --output dist/app.js` (avoid committing generated output unless requested).

- Use Hono built-in middleware where possible instead of reimplementing cross-cutting concerns:
  - Auth: `basicAuth`, `bearerAuth`
  - CORS: `cors`
  - Rate limiting, security headers, cache control, etc. via official middleware.

- Response handling:
  - JSON: `return c.json(data, statusCode?)`
  - Text: `return c.text(message, statusCode?)`
  - Errors: use consistent JSON error format from the previous section.

- Typing:
  - Use Hono’s type parameters to strongly type route params, query, and JSON bodies.
  - Avoid `any`; use explicit types or `unknown` + safe narrowing.

---

## Validation

- Use a validation library (e.g. Zod/Valibot) integrated with Hono middleware, instead of manual `if (!body.field)` checks.
- For every public endpoint, define:
  - Input schema (request body, query, params).
  - Output schema (success payload, error shape if appropriate).

---

## Testing

- Test framework: `vitest` (or the one defined in `package.json`).
- Use Hono testing helpers (for example `@hono/testing`) to test routes as HTTP requests where available.
- For every new route or behavior change:
  - Add **unit tests** for service functions.
  - Add **integration-style tests** for the route using the test client.
- When fixing a bug:
  - First add a failing regression test.
  - Then fix the implementation and ensure the test passes.

Place tests next to the code or in a mirrored structure, for example:
- `src/services/user-service.ts` → `tests/services/user-service.test.ts`
- `src/routes/users.ts` → `tests/routes/users.test.ts`

---

## Type checking & linting

- Treat TypeScript errors as blockers. Do not suppress errors with `any` or `@ts-ignore` unless absolutely necessary and with a short comment explaining why.
- Use **Biome** for linting and formatting:
  - Prefer to **fix** issues to satisfy the existing Biome config rather than changing the rules.
  - If a rule is consistently getting in the way, propose changing the config in a separate, explicit step.

Before considering a task done, run (if these scripts exist):

1. `npm lint`
2. `npm typecheck`
3. `npm test`

If you add new code, also add or update tests so that coverage does not regress.

---

## Pull requests & refactors

- Prefer small, focused changes rather than large mixed refactors.
- When refactoring:
  - Keep behavior the same unless the task explicitly includes behavior changes.
  - Preserve all existing tests; if tests need to be updated, explain why.

