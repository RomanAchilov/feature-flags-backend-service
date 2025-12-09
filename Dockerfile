# ═══════════════════════════════════════════════════════════════════════════════
# Feature Flags Backend Service — Production Dockerfile
# ═══════════════════════════════════════════════════════════════════════════════
#
# Multi-stage сборка для минимального размера образа
#
# Сборка:
#   docker build -t feature-flags-backend:latest .
#
# Запуск:
#   docker run -p 4000:4000 \
#     -e DATABASE_URL="postgresql://..." \
#     -e AUTH_MODE="keycloak" \
#     feature-flags-backend:latest
#
# ═══════════════════════════════════════════════════════════════════════════════

# ───────────────────────────────────────────────────────────────────────────────
# Stage 1: Dependencies
# ───────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

# Копируем только файлы зависимостей для кэширования
COPY package.json package-lock.json ./

# Устанавливаем все зависимости (включая dev для сборки)
RUN npm ci

# ───────────────────────────────────────────────────────────────────────────────
# Stage 2: Builder
# ───────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Копируем зависимости из предыдущего stage
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./

# Копируем исходный код
COPY tsconfig.json ./
COPY schema.prisma ./
COPY prisma ./prisma
COPY src ./src

# Генерируем Prisma Client
RUN npx prisma generate

# Собираем TypeScript
RUN npm run build

# Удаляем dev-зависимости
RUN npm prune --production

# ───────────────────────────────────────────────────────────────────────────────
# Stage 3: Production Runner
# ───────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

# Метаданные образа
LABEL org.opencontainers.image.title="Feature Flags Backend"
LABEL org.opencontainers.image.description="Feature Flags Management Service"
LABEL org.opencontainers.image.vendor="Your Company"
LABEL org.opencontainers.image.source="https://github.com/your-org/feature-flags"

# Создаём непривилегированного пользователя
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 hono

WORKDIR /app

# Копируем только необходимое для production
COPY --from=builder --chown=hono:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=hono:nodejs /app/dist ./dist
COPY --from=builder --chown=hono:nodejs /app/package.json ./
COPY --from=builder --chown=hono:nodejs /app/schema.prisma ./
COPY --from=builder --chown=hono:nodejs /app/prisma ./prisma

# Переключаемся на непривилегированного пользователя
USER hono

# Открываем порт
EXPOSE 4000

# Переменные окружения по умолчанию
ENV NODE_ENV=production
ENV PORT=4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

# Запуск
CMD ["node", "dist/src/index.js"]

