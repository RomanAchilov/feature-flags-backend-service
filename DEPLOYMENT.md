# 🚀 Руководство по развёртыванию Feature Flags Backend

Полное руководство для DevOps-инженеров по развёртыванию сервиса управления фича-флагами.

## 📋 Содержание

1. [Требования](#требования)
2. [Быстрый старт](#быстрый-старт)
3. [Сборка Docker-образа](#сборка-docker-образа)
4. [Настройка базы данных PostgreSQL](#настройка-базы-данных-postgresql)
5. [Настройка Keycloak](#настройка-keycloak)
6. [Шифрование секретов](#шифрование-секретов)
7. [Развёртывание через Helm](#развёртывание-через-helm)
8. [Переменные окружения](#переменные-окружения)
9. [Мониторинг и логирование](#мониторинг-и-логирование)
10. [Troubleshooting](#troubleshooting)

---

## Требования

### Инфраструктура
- **Kubernetes** 1.25+
- **Helm** 3.10+
- **PostgreSQL** 14+ (внешний или через Helm dependency)
- **Keycloak** 20+ (ваш корпоративный SSO)

### Для локальной разработки
- **Docker** 24+
- **Node.js** 22+
- **npm** 10+

---

## Быстрый старт

### Минимальный деплой (5 минут)

```bash
# 1. Создайте namespace
kubectl create namespace feature-flags

# 2. Создайте Secret с конфигурацией
kubectl create secret generic feature-flags-secrets \
  --from-literal=DATABASE_URL="postgresql://user:password@postgres-host:5432/feature_flags" \
  --from-literal=API_KEYS="your-api-key-for-clients" \
  -n feature-flags

# 3. Установите через Helm
helm install feature-flags ./helm \
  --set keycloak.url="https://keycloak.your-domain.com" \
  --set keycloak.realm="your-realm" \
  --set secrets.existingSecret="feature-flags-secrets" \
  -n feature-flags

# 4. Проверьте статус
kubectl get pods -n feature-flags
kubectl logs -f deployment/feature-flags-feature-flags-backend -n feature-flags
```

---

## Сборка Docker-образа

### Команда сборки

```bash
cd feature-flags-backend-service

# Сборка образа
docker build -t your-registry.io/feature-flags-backend:1.0.0 .

# Push в registry
docker push your-registry.io/feature-flags-backend:1.0.0
```

### Multi-platform сборка (для разных архитектур)

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t your-registry.io/feature-flags-backend:1.0.0 \
  --push .
```

### Локальный запуск для тестирования

```bash
docker run -p 4000:4000 \
  -e DATABASE_URL="postgresql://flags:flags@host.docker.internal:5432/feature_flags" \
  -e AUTH_MODE="dev" \
  your-registry.io/feature-flags-backend:1.0.0
```

---

## Настройка базы данных PostgreSQL

### Вариант 1: Внешняя БД (рекомендуется для production)

#### Создание базы данных

```sql
-- Подключитесь к PostgreSQL как superuser
CREATE DATABASE feature_flags;
CREATE USER feature_flags_user WITH ENCRYPTED PASSWORD 'your-secure-password';
GRANT ALL PRIVILEGES ON DATABASE feature_flags TO feature_flags_user;

-- Подключитесь к базе feature_flags
\c feature_flags
GRANT ALL ON SCHEMA public TO feature_flags_user;
```

#### Строка подключения

```
DATABASE_URL="postgresql://feature_flags_user:your-secure-password@postgres.your-domain.com:5432/feature_flags?sslmode=require"
```

### Вариант 2: PostgreSQL через Helm (для dev/staging)

```yaml
# В values.yaml
postgresql:
  enabled: true
  auth:
    username: feature_flags
    password: "change-me-in-production"
    database: feature_flags
  primary:
    persistence:
      enabled: true
      size: 10Gi
```

### Миграции базы данных

Миграции запускаются автоматически через init container в Helm:

```yaml
# В values-production.yaml уже настроено:
initContainers:
  - name: run-migrations
    image: your-registry.io/feature-flags-backend:1.0.0
    command: ["npx", "prisma", "migrate", "deploy"]
    env:
      - name: DATABASE_URL
        valueFrom:
          secretKeyRef:
            name: feature-flags-secrets
            key: DATABASE_URL
```

#### Ручной запуск миграций

```bash
# Из контейнера
kubectl exec -it deployment/feature-flags-feature-flags-backend -n feature-flags -- \
  npx prisma migrate deploy

# Или локально (с доступом к БД)
DATABASE_URL="postgresql://..." npx prisma migrate deploy
```

---

## Настройка Keycloak

### Шаг 1: Создание клиента в Keycloak

1. Войдите в Keycloak Admin Console
2. Выберите ваш Realm (или создайте новый)
3. Перейдите в **Clients** → **Create client**

#### Настройки клиента:

| Параметр | Значение |
|----------|----------|
| Client ID | `feature-flags-api` |
| Client authentication | **OFF** (public client для JWT) |
| Standard flow enabled | OFF |
| Direct access grants | OFF |
| Implicit flow enabled | OFF |

> **Важно:** Бэкенд только проверяет JWT токены, он не обменивает credentials на токены.

### Шаг 2: Создание роли администратора

1. Перейдите в **Realm roles** → **Create role**
2. Создайте роль: `feature-flags-admin`
3. Сохраните

### Шаг 3: Назначение роли пользователям

1. **Users** → выберите пользователя
2. **Role mappings** → **Assign role**
3. Выберите `feature-flags-admin`

### Шаг 4: Настройка фронтенда (Admin Panel)

Для админ-панели создайте отдельный клиент:

| Параметр | Значение |
|----------|----------|
| Client ID | `feature-flags-admin-panel` |
| Client authentication | **OFF** |
| Standard flow enabled | **ON** |
| Valid redirect URIs | `https://feature-flags-admin.your-domain.com/*` |
| Web origins | `https://feature-flags-admin.your-domain.com` |

### Шаг 5: Конфигурация бэкенда

```yaml
# В values.yaml или values-production.yaml
keycloak:
  url: "https://keycloak.your-domain.com"
  realm: "your-company-realm"
  clientId: "feature-flags-api"
  adminRole: "feature-flags-admin"
```

### Проверка интеграции

```bash
# Получите токен (замените параметры)
TOKEN=$(curl -s -X POST \
  "https://keycloak.your-domain.com/realms/your-realm/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=feature-flags-admin-panel" \
  -d "grant_type=password" \
  -d "username=admin@example.com" \
  -d "password=your-password" \
  | jq -r '.access_token')

# Проверьте API
curl -H "Authorization: Bearer $TOKEN" \
  https://feature-flags-api.your-domain.com/flags
```

---

## Шифрование секретов

Сервис поддерживает шифрование конфигурационных значений по аналогии с Jasypt (Java).

### Формат зашифрованных значений

```
ENC(base64_encrypted_value)
```

### Шифрование значений (CLI)

```bash
cd feature-flags-backend-service

# Установите мастер-пароль
export ENCRYPTION_PASSWORD="your-master-password"

# Зашифруйте значение
npx tsx src/config/secrets.ts encrypt "my_database_password"
# Вывод: ENC(dGVzdC1lbmNyeXB0ZWQtdmFsdWU...)

# Проверьте расшифровку
npx tsx src/config/secrets.ts verify "ENC(...)" 
```

### Использование в Kubernetes

#### Вариант 1: Зашифрованные значения в Secret

```yaml
# Создайте Secret с зашифрованными значениями
apiVersion: v1
kind: Secret
metadata:
  name: feature-flags-secrets
type: Opaque
stringData:
  DATABASE_URL: "ENC(base64_encrypted_connection_string)"
  API_KEYS: "ENC(base64_encrypted_api_keys)"
  ENCRYPTION_PASSWORD: "your-master-password"  # Мастер-пароль в открытом виде
```

#### Вариант 2: Plain-text в Kubernetes Secrets (проще)

Kubernetes Secrets уже зашифрованы at-rest (с etcd encryption).
Можно использовать обычные значения:

```bash
kubectl create secret generic feature-flags-secrets \
  --from-literal=DATABASE_URL="postgresql://user:pass@host:5432/db" \
  --from-literal=API_KEYS="key1,key2,key3" \
  -n feature-flags
```

#### Вариант 3: Sealed Secrets (рекомендуется)

```bash
# Создайте SealedSecret (значения шифруются публичным ключом кластера)
kubeseal --format=yaml < secret.yaml > sealed-secret.yaml
kubectl apply -f sealed-secret.yaml
```

---

## Развёртывание через Helm

### Структура Helm чарта

```
helm/
├── Chart.yaml              # Метаданные чарта
├── values.yaml             # Значения по умолчанию
├── values-production.yaml  # Production конфигурация
└── templates/
    ├── _helpers.tpl        # Вспомогательные функции
    ├── deployment.yaml     # Deployment
    ├── service.yaml        # Service
    ├── configmap.yaml      # ConfigMap
    ├── secret.yaml         # Secret (если не existingSecret)
    ├── ingress.yaml        # Ingress (опционально)
    ├── hpa.yaml            # HorizontalPodAutoscaler
    ├── pdb.yaml            # PodDisruptionBudget
    └── serviceaccount.yaml # ServiceAccount
```

### Базовая установка

```bash
# Добавьте зависимости (если нужен встроенный PostgreSQL)
helm dependency update ./helm

# Установка
helm install feature-flags ./helm \
  -f helm/values-production.yaml \
  -n feature-flags --create-namespace
```

### Обновление

```bash
helm upgrade feature-flags ./helm \
  -f helm/values-production.yaml \
  -n feature-flags
```

### Удаление

```bash
helm uninstall feature-flags -n feature-flags
```

### Примеры конфигураций

#### Минимальная (dev)

```bash
helm install feature-flags ./helm \
  --set config.authMode="dev" \
  --set postgresql.enabled=true \
  --set postgresql.auth.password="dev-password" \
  -n feature-flags-dev --create-namespace
```

#### Production с внешней БД

```bash
helm install feature-flags ./helm \
  -f helm/values-production.yaml \
  --set image.tag="1.2.3" \
  --set keycloak.url="https://sso.company.com" \
  --set keycloak.realm="production" \
  --set secrets.existingSecret="feature-flags-prod-secrets" \
  -n feature-flags --create-namespace
```

---

## Переменные окружения

### Обязательные

| Переменная | Описание | Пример |
|------------|----------|--------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |

### Аутентификация

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `AUTH_MODE` | Режим аутентификации: `keycloak`, `dev`, `none` | `dev` |
| `API_KEYS` | API ключи для /evaluate (через запятую) | — |

### Keycloak

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `KEYCLOAK_URL` | URL Keycloak сервера | `http://localhost:8080` |
| `KEYCLOAK_REALM` | Название realm | `FeatureFlags` |
| `KEYCLOAK_CLIENT_ID` | Client ID | `feature-flags-api` |
| `KEYCLOAK_ADMIN_ROLE` | Роль администратора | `feature-flags-admin` |

### Безопасность

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `CORS_ORIGINS` | Разрешённые origins (через запятую) | `http://localhost:3000` |
| `RATE_LIMIT_WINDOW_MS` | Окно rate limit (мс) | `60000` |
| `RATE_LIMIT_MAX_REQUESTS` | Макс. запросов в окне | `100` |
| `ENCRYPTION_PASSWORD` | Мастер-пароль для ENC() | — |

### Приложение

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `PORT` | Порт сервера | `4000` |
| `NODE_ENV` | Режим работы | `development` |
| `LOG_LEVEL` | Уровень логирования | `info` |

---

## Мониторинг и логирование

### Health Check endpoints

```bash
# Liveness + Readiness
curl http://feature-flags-api:4000/health
# {"status":"ok","timestamp":"2024-..."}
```

### Prometheus метрики

В `values-production.yaml` уже настроены аннотации для Prometheus:

```yaml
podAnnotations:
  prometheus.io/scrape: "true"
  prometheus.io/port: "4000"
  prometheus.io/path: "/health"
```

### Логирование

Логи выводятся в stdout в JSON-формате:

```bash
kubectl logs -f deployment/feature-flags-feature-flags-backend -n feature-flags
```

---

## Troubleshooting

### Проблема: Pod не запускается

```bash
# Проверьте события
kubectl describe pod -l app.kubernetes.io/name=feature-flags-backend -n feature-flags

# Проверьте логи
kubectl logs -l app.kubernetes.io/name=feature-flags-backend -n feature-flags --previous
```

### Проблема: Ошибка подключения к БД

```bash
# Проверьте Secret
kubectl get secret feature-flags-secrets -n feature-flags -o yaml

# Проверьте доступность БД из пода
kubectl exec -it deployment/feature-flags-feature-flags-backend -n feature-flags -- \
  wget -qO- postgresql-host:5432 || echo "No connection"
```

### Проблема: Keycloak 401 Unauthorized

1. Проверьте, что токен не истёк
2. Проверьте, что `KEYCLOAK_URL` и `KEYCLOAK_REALM` корректны
3. Проверьте, что у пользователя есть роль `feature-flags-admin`

```bash
# Декодируйте токен (jwt.io или)
echo $TOKEN | cut -d. -f2 | base64 -d | jq .realm_access.roles
```

### Проблема: Миграции не применились

```bash
# Запустите миграции вручную
kubectl exec -it deployment/feature-flags-feature-flags-backend -n feature-flags -- \
  npx prisma migrate deploy

# Проверьте статус миграций
kubectl exec -it deployment/feature-flags-feature-flags-backend -n feature-flags -- \
  npx prisma migrate status
```

---

## Контакты

При возникновении вопросов обращайтесь:
- Telegram: @your_team_channel
- Email: team@example.com

