type SchemaObject = Record<string, unknown>;

type OpenAPIDocument = {
	openapi: string;
	info: {
		title: string;
		version: string;
		description?: string;
	};
	servers?: Array<{ url: string; description?: string }>;
	paths: Record<string, unknown>;
	components?: { schemas?: Record<string, SchemaObject> };
};

const featureEnvironmentEnum = [
	"development",
	"staging",
	"production",
] as const;

const FeatureFlagSchema: SchemaObject = {
	type: "object",
	required: ["key", "name", "type", "environments"],
	properties: {
		id: { type: "string", format: "uuid" },
		key: { type: "string" },
		name: { type: "string" },
		description: { type: ["string", "null"] },
		type: { type: "string", enum: ["BOOLEAN", "ROLLOUT"] },
		environments: {
			type: "array",
			items: {
				type: "object",
				required: ["environment", "enabled"],
				properties: {
					environment: { type: "string", enum: featureEnvironmentEnum },
					enabled: { type: "boolean" },
					rolloutPercentage: {
						type: ["number", "null"],
						minimum: 0,
						maximum: 100,
					},
					forceEnabled: { type: ["boolean", "null"] },
					forceDisabled: { type: ["boolean", "null"] },
					userTargets: {
						type: "array",
						items: {
							type: "object",
							required: ["userId", "include"],
							properties: {
								userId: { type: "string" },
								include: { type: "boolean" },
							},
						},
					},
				},
			},
		},
	},
};

export const openApiDocument: OpenAPIDocument = {
	openapi: "3.1.0",
	info: {
		title: "Feature Flags Service API",
		version: "1.0.0",
		description: "HTTP API for managing and evaluating feature flags.",
	},
	servers: [{ url: "/", description: "Local server" }],
	paths: {
		"/health": {
			get: {
				summary: "Health check",
				responses: {
					"200": {
						description: "Service healthy",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: { status: { type: "string" } },
								},
							},
						},
					},
					"500": {
						description: "Database unreachable",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										status: { type: "string" },
										details: { type: "string" },
									},
								},
							},
						},
					},
				},
			},
		},
		"/flags": {
			get: {
				summary: "List feature flags",
				parameters: [
					{
						name: "environment",
						in: "query",
						schema: { type: "string", enum: featureEnvironmentEnum },
					},
					{ name: "search", in: "query", schema: { type: "string" } },
					{
						name: "page",
						in: "query",
						schema: { type: "integer", minimum: 1, default: 1 },
					},
					{
						name: "pageSize",
						in: "query",
						schema: { type: "integer", minimum: 1, maximum: 200, default: 20 },
					},
				],
				responses: {
					"200": {
						description: "List of flags",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										data: {
											type: "array",
											items: { $ref: "#/components/schemas/FeatureFlag" },
										},
									},
								},
							},
						},
					},
				},
			},
			post: {
				summary: "Create a feature flag",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								$ref: "#/components/schemas/FeatureFlag",
							},
						},
					},
				},
				responses: {
					"201": {
						description: "Created flag with environments and recent audit logs",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										data: { $ref: "#/components/schemas/FeatureFlag" },
									},
								},
							},
						},
					},
					"400": {
						description: "Invalid body",
					},
				},
			},
		},
		"/flags/{key}": {
			parameters: [
				{ name: "key", in: "path", required: true, schema: { type: "string" } },
			],
			get: {
				summary: "Get flag details",
				responses: {
					"200": {
						description: "Flag found",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										data: { $ref: "#/components/schemas/FeatureFlag" },
									},
								},
							},
						},
					},
					"404": { description: "Flag not found" },
				},
			},
			patch: {
				summary: "Update a flag",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/FeatureFlag" },
						},
					},
				},
				responses: {
					"200": {
						description: "Updated flag",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										data: { $ref: "#/components/schemas/FeatureFlag" },
									},
								},
							},
						},
					},
					"404": { description: "Flag not found" },
				},
			},
			delete: {
				summary: "Soft delete a flag",
				responses: {
					"200": { description: "Deleted" },
					"404": { description: "Flag not found" },
				},
			},
		},
		"/flags/{key}/audit": {
			parameters: [
				{ name: "key", in: "path", required: true, schema: { type: "string" } },
			],
			get: {
				summary: "Get audit log for a flag",
				parameters: [
					{
						name: "page",
						in: "query",
						schema: { type: "integer", minimum: 1, default: 1 },
					},
					{
						name: "pageSize",
						in: "query",
						schema: { type: "integer", minimum: 1, maximum: 200, default: 20 },
					},
				],
				responses: {
					"200": { description: "Audit entries with pagination" },
					"404": { description: "Flag not found" },
				},
			},
		},
		"/evaluate": {
			post: {
				summary: "Evaluate feature flags for a user",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["environment", "user", "flags"],
								properties: {
									environment: { type: "string", enum: featureEnvironmentEnum },
									user: {
										type: "object",
										required: ["id"],
										properties: {
											id: { type: "string" },
											role: { type: "string" },
											country: { type: "string" },
											attributes: {
												type: "object",
												additionalProperties: true,
											},
										},
									},
									flags: { type: "array", items: { type: "string" } },
								},
							},
						},
					},
				},
				responses: {
					"200": {
						description: "Evaluation result",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										flags: {
											type: "object",
											additionalProperties: { type: "boolean" },
										},
									},
								},
							},
						},
					},
					"400": { description: "Invalid payload" },
				},
			},
		},
	},
	components: {
		schemas: {
			FeatureFlag: FeatureFlagSchema,
		},
	},
};
