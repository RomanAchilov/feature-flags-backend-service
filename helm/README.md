# Feature Flags Backend — Helm Chart

Быстрый деплой сервиса фича-флагов в Kubernetes.

## 🚀 Быстрый старт (5 минут)

```bash
# 1. Создать namespace
kubectl create namespace feature-flags

# 2. Создать Secret с DATABASE_URL
kubectl create secret generic feature-flags-secrets \
  --from-literal=DATABASE_URL="postgresql://user:pass@postgres:5432/db" \
  --from-literal=API_KEYS="your-client-api-key" \
  -n feature-flags

# 3. Установить Helm чарт
helm install feature-flags ./helm \
  --set keycloak.url="https://keycloak.your-domain.com" \
  --set keycloak.realm="your-realm" \
  --set secrets.existingSecret="feature-flags-secrets" \
  -n feature-flags

# 4. Проверить
kubectl get pods -n feature-flags
```

## 📋 Конфигурация

### Минимальные значения для production

```yaml
# values-custom.yaml
image:
  repository: your-registry.io/feature-flags-backend
  tag: "1.0.0"

keycloak:
  url: "https://keycloak.your-domain.com"
  realm: "your-realm"
  clientId: "feature-flags-api"
  adminRole: "feature-flags-admin"

secrets:
  existingSecret: "feature-flags-secrets"

ingress:
  enabled: true
  hosts:
    - host: feature-flags-api.your-domain.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: feature-flags-tls
      hosts:
        - feature-flags-api.your-domain.com
```

### Установка с кастомными значениями

```bash
helm install feature-flags ./helm -f values-custom.yaml -n feature-flags
```

## 🔐 Секреты

### Обязательные

| Ключ | Описание |
|------|----------|
| `DATABASE_URL` | PostgreSQL connection string |

### Опциональные

| Ключ | Описание |
|------|----------|
| `API_KEYS` | Ключи для /evaluate endpoint (через запятую) |
| `ENCRYPTION_PASSWORD` | Мастер-пароль для ENC() значений |

### Создание Secret

```bash
# Простой способ
kubectl create secret generic feature-flags-secrets \
  --from-literal=DATABASE_URL="postgresql://..." \
  -n feature-flags

# Из файла
kubectl create secret generic feature-flags-secrets \
  --from-env-file=.env.production \
  -n feature-flags
```

## 🔄 Обновление

```bash
helm upgrade feature-flags ./helm \
  -f values-custom.yaml \
  --set image.tag="1.0.1" \
  -n feature-flags
```

## 📊 Мониторинг

Health endpoint: `GET /health`

Prometheus annotations уже настроены:
```yaml
prometheus.io/scrape: "true"
prometheus.io/port: "4000"
prometheus.io/path: "/health"
```

## 🔍 Troubleshooting

```bash
# Логи
kubectl logs -f -l app.kubernetes.io/name=feature-flags-backend -n feature-flags

# События
kubectl describe pod -l app.kubernetes.io/name=feature-flags-backend -n feature-flags

# Проверить Secret
kubectl get secret feature-flags-secrets -n feature-flags -o yaml
```

## 📚 Полная документация

См. [DEPLOYMENT.md](../DEPLOYMENT.md)

