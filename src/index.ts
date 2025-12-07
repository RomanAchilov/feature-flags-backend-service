import "dotenv/config";
import { serve } from "@hono/node-server";
import { z } from "zod";
import { app } from "./app";

const PortSchema = z.coerce.number().int().positive().default(4000);
const port = PortSchema.parse(process.env.PORT);

serve(
	{
		fetch: app.fetch,
		port,
	},
	(info) => {
		console.log(`Server is running on http://localhost:${info.port}`);
	},
);
