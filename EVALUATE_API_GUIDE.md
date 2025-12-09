# Гайд: Использование API `/evaluate` в TanStack Router Loader

Этот гайд описывает, как вызвать API endpoint `/evaluate` используя `fetch` из Loader функции в TanStack Router.

## 📋 Содержание

- [Структура API](#структура-api)
- [Zod схемы для типизации](#zod-схемы-для-типизации)
- [Базовый пример Loader](#базовый-пример-loader)
- [Использование abortController](#использование-abortcontroller)
- [Использование preload флага](#использование-preload-флага)
- [Обработка ошибок](#обработка-ошибок)
- [Полный пример с errorComponent](#полный-пример-с-errorcomponent)
- [Использование данных в компоненте](#использование-данных-в-компоненте)

---

## Структура API

### Endpoint

```
POST /evaluate
```

### Тело запроса

```typescript
{
  environment: "development" | "staging" | "production",
  user: {
    id: string,                    // обязательное
    segments?: string[],           // опциональное
    phoneNumber?: string,          // опциональное
    birthDate?: string             // опциональное
  },
  flags: string[]                  // массив ключей флагов
}
```

### Ответ при успехе

```typescript
{
  flags: Record<string, boolean>   // объект с ключами флагов и их значениями
}
```

### Ответ при ошибке

```typescript
{
  error: {
    code: string,                  // "bad_request" | "internal_error"
    message: string,
    details?: object               // только для bad_request
  }
}
```

---

## Zod схемы для типизации

Создайте файл с Zod схемами для типизации запросов и ответов:

```typescript
// lib/evaluate-api.ts
import { z } from "zod";

export const EvaluateRequestSchema = z.object({
  environment: z.enum(["development", "staging", "production"]),
  user: z.object({
    id: z.string().min(1),
    segments: z.array(z.string().min(1)).optional(),
    phoneNumber: z.string().optional(),
    birthDate: z.string().optional(),
  }),
  flags: z.array(z.string().min(1)),
});

export const EvaluateResponseSchema = z.object({
  flags: z.record(z.string(), z.boolean()),
});

export const EvaluateErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type EvaluateRequest = z.infer<typeof EvaluateRequestSchema>;
export type EvaluateResponse = z.infer<typeof EvaluateResponseSchema>;
export type EvaluateError = z.infer<typeof EvaluateErrorSchema>;
```

---

## Базовый пример Loader

Простой пример использования API в loader:

```typescript
// routes/feature-flags.tsx
import { createFileRoute } from "@tanstack/react-router";
import { EvaluateRequestSchema, EvaluateResponseSchema } from "@/lib/evaluate-api";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";

export const Route = createFileRoute("/feature-flags")({
  loader: async () => {
    const requestBody = {
      environment: "production" as const,
      user: {
        id: "user-123",
        segments: ["premium", "beta"],
      },
      flags: ["new-feature", "dark-mode", "experimental-ui"],
    };

    // Валидация запроса
    const validatedRequest = EvaluateRequestSchema.parse(requestBody);

    const response = await fetch(`${API_BASE}/evaluate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validatedRequest),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(
        errorData?.error?.message || `HTTP ${response.status}: ${response.statusText}`
      );
    }

    const data = await response.json();
    const validatedResponse = EvaluateResponseSchema.parse(data);

    return validatedResponse;
  },
  component: () => {
    const data = Route.useLoaderData();
    // data.flags - это Record<string, boolean>
    return <div>...</div>;
  },
});
```

---

## Использование abortController

TanStack Router предоставляет `abortController` для отмены запросов при навигации:

```typescript
// routes/feature-flags.tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/feature-flags")({
  loader: async ({ abortController }) => {
    const requestBody = {
      environment: "production" as const,
      user: { id: "user-123" },
      flags: ["new-feature"],
    };

    const response = await fetch(`${API_BASE}/evaluate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      // Передаём signal для возможности отмены запроса
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to evaluate flags: ${response.statusText}`);
    }

    const data = await response.json();
    return EvaluateResponseSchema.parse(data);
  },
});
```

**Важно:** При использовании `abortController.signal`, запрос автоматически отменяется, если пользователь уходит со страницы до завершения загрузки.

---

## Использование preload флага

Флаг `preload` указывает, что маршрут загружается заранее (например, при наведении на ссылку):

```typescript
// routes/feature-flags.tsx
export const Route = createFileRoute("/feature-flags")({
  loader: async ({ preload, abortController }) => {
    const requestBody = {
      environment: "production" as const,
      user: { id: "user-123" },
      flags: ["new-feature"],
    };

    // Можно использовать preload для оптимизации запроса
    // Например, использовать более короткий timeout для preload
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      preload ? 2000 : 10000 // preload: 2s, обычная загрузка: 10s
    );

    try {
      const response = await fetch(`${API_BASE}/evaluate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal || controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to evaluate flags: ${response.statusText}`);
      }

      const data = await response.json();
      return EvaluateResponseSchema.parse(data);
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  },
});
```

---

## Обработка ошибок

### Использование onError

```typescript
// routes/feature-flags.tsx
export const Route = createFileRoute("/feature-flags")({
  loader: async ({ abortController }) => {
    // ... fetch запрос
  },
  onError: ({ error }) => {
    // Логирование ошибки
    console.error("Ошибка загрузки флагов:", error);
    
    // Можно отправить в систему мониторинга
    // sendToErrorTracking(error);
  },
});
```

### Использование errorComponent

```typescript
// routes/feature-flags.tsx
import { createFileRoute, ErrorComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/feature-flags")({
  loader: async ({ abortController }) => {
    // ... fetch запрос
  },
  errorComponent: ({ error, reset }) => {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-bold text-rose-600">
            Ошибка загрузки флагов
          </h2>
          <p className="text-zinc-400">
            {error instanceof Error ? error.message : "Неизвестная ошибка"}
          </p>
          <button
            onClick={() => reset()}
            className="px-4 py-2 bg-violet-500 text-white rounded hover:bg-violet-600"
          >
            Попробовать снова
          </button>
        </div>
      </div>
    );
  },
});
```

### Использование router.invalidate() для перезагрузки

```typescript
// routes/feature-flags.tsx
import { createFileRoute, useRouter } from "@tanstack/react-router";

export const Route = createFileRoute("/feature-flags")({
  loader: async ({ abortController }) => {
    // ... fetch запрос
  },
  errorComponent: ({ error }) => {
    const router = useRouter();

    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-bold text-rose-600">
            Ошибка загрузки флагов
          </h2>
          <p className="text-zinc-400">
            {error instanceof Error ? error.message : "Неизвестная ошибка"}
          </p>
          <button
            onClick={() => {
              // Перезагрузить loader и сбросить error boundary
              router.invalidate();
            }}
            className="px-4 py-2 bg-violet-500 text-white rounded hover:bg-violet-600"
          >
            Перезагрузить
          </button>
        </div>
      </div>
    );
  },
});
```

---

## Полный пример с errorComponent

Полноценный пример с обработкой всех случаев:

```typescript
// routes/feature-flags.tsx
import { createFileRoute, useRouter, ErrorComponent } from "@tanstack/react-router";
import { EvaluateRequestSchema, EvaluateResponseSchema, EvaluateErrorSchema } from "@/lib/evaluate-api";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";

export const Route = createFileRoute("/feature-flags")({
  loader: async ({ abortController, preload }) => {
    const requestBody = {
      environment: "production" as const,
      user: {
        id: "user-123",
        segments: ["premium"],
      },
      flags: ["new-feature", "dark-mode"],
    };

    const validatedRequest = EvaluateRequestSchema.parse(requestBody);

    try {
      const response = await fetch(`${API_BASE}/evaluate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validatedRequest),
        signal: abortController.signal,
      });

      const json = await response.json().catch(() => null);

      if (!response.ok) {
        // Пытаемся распарсить структурированную ошибку
        const errorData = EvaluateErrorSchema.safeParse(json);
        if (errorData.success) {
          throw new Error(errorData.data.error.message);
        }
        throw new Error(
          json?.error?.message || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const validatedResponse = EvaluateResponseSchema.parse(json);
      return validatedResponse;
    } catch (error) {
      // Игнорируем ошибки отмены запроса
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      
      // Пробрасываем остальные ошибки
      throw error;
    }
  },
  
  onError: ({ error }) => {
    console.error("Ошибка загрузки флагов:", error);
  },
  
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    const isNetworkError = error instanceof Error && error.message.includes("fetch");

    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <div className="text-center space-y-4 max-w-md">
          <h2 className="text-2xl font-bold text-rose-600">
            Ошибка загрузки флагов
          </h2>
          <p className="text-zinc-400">
            {error instanceof Error ? error.message : "Неизвестная ошибка"}
          </p>
          {isNetworkError && (
            <p className="text-sm text-amber-400">
              Проверьте подключение к интернету
            </p>
          )}
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => router.invalidate()}
              className="px-4 py-2 bg-violet-500 text-white rounded hover:bg-violet-600"
            >
              Перезагрузить
            </button>
            <button
              onClick={() => reset()}
              className="px-4 py-2 bg-zinc-600 text-white rounded hover:bg-zinc-700"
            >
              Сбросить
            </button>
          </div>
        </div>
      </div>
    );
  },
  
  component: () => {
    const data = Route.useLoaderData();
    
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4">Состояние флагов</h1>
        <div className="space-y-2">
          {Object.entries(data.flags).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="font-mono">{key}:</span>
              <span className={value ? "text-emerald-400" : "text-rose-400"}>
                {value ? "Включен" : "Выключен"}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  },
});
```

---

## Использование данных в компоненте

После загрузки данных через loader, используйте хук `useLoaderData()`:

```typescript
// routes/feature-flags.tsx
export const Route = createFileRoute("/feature-flags")({
  loader: async ({ abortController }) => {
    // ... загрузка данных
    return { flags: { "new-feature": true, "dark-mode": false } };
  },
  
  component: () => {
    // Получаем данные из loader
    const { flags } = Route.useLoaderData();
    
    return (
      <div>
        {Object.entries(flags).map(([key, value]) => (
          <div key={key}>
            {key}: {value ? "✅" : "❌"}
          </div>
        ))}
      </div>
    );
  },
});
```

---

## Использование с параметрами маршрута

Если нужно передавать параметры из URL:

```typescript
// routes/flags/$environment.tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/flags/$environment")({
  loader: async ({ params, abortController }) => {
    const { environment } = params;
    
    // Валидация environment
    if (!["development", "staging", "production"].includes(environment)) {
      throw new Error(`Неверное окружение: ${environment}`);
    }

    const requestBody = {
      environment: environment as "development" | "staging" | "production",
      user: { id: "user-123" },
      flags: ["new-feature"],
    };

    const response = await fetch(`${API_BASE}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`Failed: ${response.statusText}`);
    }

    return EvaluateResponseSchema.parse(await response.json());
  },
  
  component: () => {
    const { environment } = Route.useParams();
    const { flags } = Route.useLoaderData();
    
    return (
      <div>
        <h1>Флаги для окружения: {environment}</h1>
        {/* ... */}
      </div>
    );
  },
});
```

---

## Использование с search params

Если нужно получать параметры из query string:

```typescript
// routes/feature-flags.tsx
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const searchSchema = z.object({
  userId: z.string().optional().default("user-123"),
  flags: z.string().optional().transform((val) => 
    val ? val.split(",") : ["new-feature"]
  ),
});

export const Route = createFileRoute("/feature-flags")({
  validateSearch: searchSchema,
  loader: async ({ search, abortController }) => {
    const { userId, flags } = search;
    
    const requestBody = {
      environment: "production" as const,
      user: { id: userId },
      flags: flags,
    };

    const response = await fetch(`${API_BASE}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`Failed: ${response.statusText}`);
    }

    return EvaluateResponseSchema.parse(await response.json());
  },
  
  component: () => {
    const search = Route.useSearch();
    const { flags } = Route.useLoaderData();
    
    return (
      <div>
        <p>Пользователь: {search.userId}</p>
        {/* ... */}
      </div>
    );
  },
});
```

---

## Полезные ссылки

- [TanStack Router - Data Loading](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading)
- [TanStack Router - Error Handling](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#handling-errors)
- [Fetch API - AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)

