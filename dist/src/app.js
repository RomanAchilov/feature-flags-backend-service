import { Hono } from "hono";
import { auth } from "./middleware/auth";
import { evaluateRoute } from "./routes/evaluate";
import { flagsRoute } from "./routes/flags";
import { health } from "./routes/health";
// Central app instance with shared context typing.
export const app = new Hono();
app.use("*", auth);
app.route("/health", health);
app.route("/flags", flagsRoute);
app.route("/evaluate", evaluateRoute);
