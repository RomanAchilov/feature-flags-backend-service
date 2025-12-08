import { Hono } from "hono";
import type { CurrentUser } from "./middleware/auth";
import { auth } from "./middleware/auth";
import { docsRoute } from "./routes/docs";
import { evaluateRoute } from "./routes/evaluate";
import { flagsRoute } from "./routes/flags";
import { health } from "./routes/health";
import { segmentsRoute } from "./routes/segments";

// Central app instance with shared context typing.
export const app = new Hono<{ Variables: { currentUser: CurrentUser } }>();

app.use("*", auth);
app.route("/health", health);
app.route("/flags", flagsRoute);
app.route("/evaluate", evaluateRoute);
app.route("/segments", segmentsRoute);
app.route("/docs", docsRoute);
