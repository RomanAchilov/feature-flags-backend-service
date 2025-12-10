# 🚀 Руководство по развёртыванию Feature Flags Backend

Краткое руководство по развёртыванию сервиса в CI/CD, Docker и Kubernetes.

## 📋 Содержание

1. [Требования](#требования)
2. [CI/CD Pipeline](#cicd-pipeline)
3. [Docker](#docker)
4. [Kubernetes + Helm](#kubernetes--helm)
5. [Настройка БД и миграций](#настройка-бд-и-миграций)
6. [Keycloak](#keycloak)
7. [Troubleshooting](#troubleshooting)

---

## Требования

- **Kubernetes** 1.25+, **Helm** 3.10+
- **PostgreSQL** 14+
- **Keycloak** 20+ (для production)
- **Docker** 24+ (для сборки)

---

## CI/CD Pipeline

### Особенности сборки

✅ **Drizzle ORM** — миграции уже сгенерированы в `drizzle/`, не требуется `generate` в CI/CD  
✅ Работает с **Nexus** и приватными registry  
✅ Multi-stage Dockerfile для минимального размера образа

### Пример CI/CD (GitLab CI / GitHub Actions)

```yaml
# .gitlab-ci.yml
stages:
  - build
  - deploy

build:
  stage: build
  script:
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_TAG .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_TAG
  only:
    - tags

deploy:
  stage: deploy
  script:
    - helm upgrade --install feature-flags ./helm \
        -f helm/values-production.yaml \
        --set image.repository=$CI_REGISTRY_IMAGE \
        --set image.tag=$CI_COMMIT_TAG \
        -n feature-flags --create-namespace
  only:
    - tags
```

### Переменные CI/CD

```bash
# Docker Registry credentials
CI_REGISTRY_IMAGE="your-registry.io/feature-flags-backend"
CI_REGISTRY_USER="deployer"
CI_REGISTRY_PASSWORD="token"

# Kubernetes credentials (для Helm)
KUBECONFIG="base64-encoded-kubeconfig"
```

---

## Docker

### Сборка образа

```bash
cd feature-flags-backend-service

# Локальная сборка
docker build -t feature-flags-backend:latest .

# Сборка для registry
docker build -t your-registry.io/feature-flags-backend:1.0.0 .
docker push your-registry.io/feature-flags-backend:1.0.0
```

### Multi-platform сборка

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t your-registry.io/feature-flags-backend:1.0.0 \
  --push .
```

### Локальный запуск

```bash
docker run -p 4000:4000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/db" \
  -e AUTH_MODE="dev" \
  feature-flags-backend:latest
```

---

## Kubernetes + Helm

### Быстрый старт

```bash
# 1. Создайте Secret
kubectl create secret generic feature-flags-secrets \
  --from-literal=DATABASE_URL="postgresql://user:pass@postgres:5432/feature_flags" \
  --from-literal=API_KEYS="key1,key2" \
  -n feature-flags --create-namespace

# 2. Установите через Helm
helm install feature-flags ./helm \
  -f helm/values-production.yaml \
  --set image.repository="your-registry.io/feature-flags-backend" \
  --set image.tag="1.0.0" \
  --set keycloak.url="https://keycloak.your-domain.com" \
  --set keycloak.realm="your-realm" \
  -n feature-flags

# 3. Проверьте статус
kubectl get pods -n feature-flags
kubectl logs -f deployment/feature-flags-feature-flags-backend -n feature-flags
```

### Обновление

```bash
helm upgrade feature-flags ./helm \
  -f helm/values-production.yaml \
  --set image.tag="1.1.0" \
  -n feature-flags
```

### Удаление

```bash
helm uninstall feature-flags -n feature-flags
```

---

## Настройка БД и миграций

### Создание БД

```sql
CREATE DATABASE feature_flags;
CREATE USER feature_flags_user WITH ENCRYPTED PASSWORD 'password';
GRANT ALL PRIVILEGES ON DATABASE feature_flags TO feature_flags_user;
\c feature_flags
GRANT ALL ON SCHEMA public TO feature_flags_user;
```

### Миграции Drizzle

Миграции применяются автоматически через init container:

```yaml
# В values-production.yaml
initContainers:
  - name: run-migrations
    image: your-registry.io/feature-flags-backend:1.0.0
    command: ["npm", "run", "db:migrate"]
    env:
      - name: DATABASE_URL
        valueFrom:
          secretKeyRef:
            name: feature-flags-secrets
            key: DATABASE_URL
```

**Важно:** 
- Миграции Drizzle уже сгенерированы в `drizzle/` и включены в Docker-образ
- Папка `drizzle/` должна существовать в репозитории (если её нет, создайте: `mkdir drizzle && touch drizzle/.gitkeep`)
- Не требуется запускать `drizzle-kit generate` в CI/CD — это решает проблему с Nexus и безопасностью

### Ручной запуск миграций

```bash
# Из контейнера
kubectl exec -it deployment/feature-flags-feature-flags-backend -n feature-flags -- \
  npm run db:migrate

# Локально
DATABASE_URL="postgresql://..." npm run db:migrate
```

---

## Keycloak

### Настройка клиента

1. **Clients** → **Create client**
   - Client ID: `feature-flags-api`
   - Client authentication: **OFF**
   - Standard flow: **OFF**

2. **Realm roles** → создать `feature-flags-admin`

3. **Users** → назначить роль пользователям

### Конфигурация Helm

```yaml
keycloak:
  url: "https://keycloak.your-domain.com"
  realm: "your-realm"
  clientId: "feature-flags-api"
  adminRole: "feature-flags-admin"
```

---

## Troubleshooting

### Pod не запускается

```bash
kubectl describe pod -l app.kubernetes.io/name=feature-flags-backend -n feature-flags
kubectl logs -l app.kubernetes.io/name=feature-flags-backend -n feature-flags --previous
```

### Ошибка подключения к БД

```bash
kubectl get secret feature-flags-secrets -n feature-flags -o yaml
kubectl exec -it deployment/feature-flags-feature-flags-backend -n feature-flags -- \
  wget -qO- postgres-host:5432 || echo "No connection"
```

### Миграции не применились

```bash
# Проверьте логи init container
kubectl logs deployment/feature-flags-feature-flags-backend -c run-migrations -n feature-flags

# Запустите вручную
kubectl exec -it deployment/feature-flags-feature-flags-backend -n feature-flags -- \
  npm run db:migrate
```

### Keycloak 401

1. Проверьте срок действия токена
2. Проверьте `KEYCLOAK_URL` и `KEYCLOAK_REALM`
3. Убедитесь, что у пользователя есть роль `feature-flags-admin`

---

## Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `DATABASE_URL` | PostgreSQL connection string | **обязательно** |
| `AUTH_MODE` | `keycloak`, `dev`, `none` | `dev` |
| `API_KEYS` | API ключи для /evaluate (через запятую) | — |
| `KEYCLOAK_URL` | URL Keycloak | `http://localhost:8080` |
| `KEYCLOAK_REALM` | Realm | `FeatureFlags` |
| `KEYCLOAK_CLIENT_ID` | Client ID | `feature-flags-api` |
| `KEYCLOAK_ADMIN_ROLE` | Роль администратора | `feature-flags-admin` |
| `PORT` | Порт сервера | `4000` |
| `CORS_ORIGINS` | Разрешённые origins | `http://localhost:3000` |

