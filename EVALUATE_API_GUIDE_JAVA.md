# Гайд: Использование API `/evaluate` для Java разработчиков

Этот гайд описывает, как вызвать API endpoint `/evaluate` из Java приложения, используя различные популярные HTTP-клиенты.

## 📋 Содержание

- [Структура API](#структура-api)
- [Модели данных (POJO классы)](#модели-данных-pojo-классы)
- [Базовый пример с OkHttp](#базовый-пример-с-okhttp)
- [Пример с Spring RestTemplate](#пример-с-spring-resttemplate)
- [Пример с Spring WebClient](#пример-с-spring-webclient)
- [Пример с Apache HttpClient](#пример-с-apache-httpclient)
- [Обработка ошибок](#обработка-ошибок)
- [Настройка таймаутов](#настройка-таймаутов)
- [Аутентификация](#аутентификация)
- [Полный пример сервиса](#полный-пример-сервиса)

---

## Структура API

### Endpoint

```
POST /evaluate
```

### Тело запроса

```json
{
  "environment": "development" | "staging" | "production",
  "user": {
    "id": "string",                    // обязательное
    "segments": ["string"],            // опциональное
    "phoneNumber": "string",           // опциональное
    "birthDate": "string"              // опциональное
  },
  "flags": ["string"]                  // массив ключей флагов
}
```

### Ответ при успехе

```json
{
  "flags": {
    "flag-key-1": true,
    "flag-key-2": false
  }
}
```

### Ответ при ошибке

```json
{
  "error": {
    "code": "bad_request" | "internal_error",
    "message": "string",
    "details": {}                      // только для bad_request
  }
}
```

---

## Модели данных (POJO классы)

Создайте POJO классы для запроса и ответа:

```java
// EvaluateRequest.java
package com.example.featureflags.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class EvaluateRequest {
    private Environment environment;
    private UserContext user;
    private List<String> flags;

    // Конструкторы
    public EvaluateRequest() {}

    public EvaluateRequest(Environment environment, UserContext user, List<String> flags) {
        this.environment = environment;
        this.user = user;
        this.flags = flags;
    }

    // Getters и Setters
    public Environment getEnvironment() {
        return environment;
    }

    public void setEnvironment(Environment environment) {
        this.environment = environment;
    }

    public UserContext getUser() {
        return user;
    }

    public void setUser(UserContext user) {
        this.user = user;
    }

    public List<String> getFlags() {
        return flags;
    }

    public void setFlags(List<String> flags) {
        this.flags = flags;
    }

    public enum Environment {
        development, staging, production
    }
}

// UserContext.java
package com.example.featureflags.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class UserContext {
    private String id;
    private List<String> segments;
    private String phoneNumber;
    private String birthDate;

    // Конструкторы
    public UserContext() {}

    public UserContext(String id) {
        this.id = id;
    }

    // Getters и Setters
    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public List<String> getSegments() {
        return segments;
    }

    public void setSegments(List<String> segments) {
        this.segments = segments;
    }

    public String getPhoneNumber() {
        return phoneNumber;
    }

    public void setPhoneNumber(String phoneNumber) {
        this.phoneNumber = phoneNumber;
    }

    public String getBirthDate() {
        return birthDate;
    }

    public void setBirthDate(String birthDate) {
        this.birthDate = birthDate;
    }
}

// EvaluateResponse.java
package com.example.featureflags.dto;

import java.util.Map;

public class EvaluateResponse {
    private Map<String, Boolean> flags;

    // Конструкторы
    public EvaluateResponse() {}

    public EvaluateResponse(Map<String, Boolean> flags) {
        this.flags = flags;
    }

    // Getters и Setters
    public Map<String, Boolean> getFlags() {
        return flags;
    }

    public void setFlags(Map<String, Boolean> flags) {
        this.flags = flags;
    }
}

// ApiError.java
package com.example.featureflags.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class ApiError {
    private String code;
    private String message;
    private Map<String, Object> details;

    // Конструкторы
    public ApiError() {}

    // Getters и Setters
    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public Map<String, Object> getDetails() {
        return details;
    }

    public void setDetails(Map<String, Object> details) {
        this.details = details;
    }
}

// ErrorResponse.java
package com.example.featureflags.dto;

public class ErrorResponse {
    private ApiError error;

    // Конструкторы
    public ErrorResponse() {}

    // Getters и Setters
    public ApiError getError() {
        return error;
    }

    public void setError(ApiError error) {
        this.error = error;
    }
}
```

---

## Базовый пример с OkHttp

### Зависимости (Maven)

```xml
<dependencies>
    <dependency>
        <groupId>com.squareup.okhttp3</groupId>
        <artifactId>okhttp</artifactId>
        <version>4.12.0</version>
    </dependency>
    <dependency>
        <groupId>com.fasterxml.jackson.core</groupId>
        <artifactId>jackson-databind</artifactId>
        <version>2.15.2</version>
    </dependency>
</dependencies>
```

### Пример использования

```java
// FeatureFlagsClient.java
package com.example.featureflags.client;

import com.example.featureflags.dto.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.*;
import java.io.IOException;
import java.util.List;
import java.util.Map;

public class FeatureFlagsClient {
    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final String apiBaseUrl;

    public FeatureFlagsClient(String apiBaseUrl) {
        this.apiBaseUrl = apiBaseUrl;
        this.httpClient = new OkHttpClient.Builder()
            .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
            .writeTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
            .build();
        this.objectMapper = new ObjectMapper();
    }

    public Map<String, Boolean> evaluateFlags(
            EvaluateRequest.Environment environment,
            UserContext user,
            List<String> flags) throws FeatureFlagsException {
        
        EvaluateRequest request = new EvaluateRequest(environment, user, flags);
        
        try {
            String jsonBody = objectMapper.writeValueAsString(request);
            RequestBody body = RequestBody.create(
                jsonBody,
                MediaType.parse("application/json; charset=utf-8")
            );

            Request httpRequest = new Request.Builder()
                .url(apiBaseUrl + "/evaluate")
                .post(body)
                .addHeader("Content-Type", "application/json")
                .build();

            try (Response response = httpClient.newCall(httpRequest).execute()) {
                String responseBody = response.body() != null 
                    ? response.body().string() 
                    : null;

                if (!response.isSuccessful()) {
                    handleError(response.code(), responseBody);
                }

                EvaluateResponse evaluateResponse = objectMapper.readValue(
                    responseBody,
                    EvaluateResponse.class
                );
                return evaluateResponse.getFlags();
            }
        } catch (IOException e) {
            throw new FeatureFlagsException("Ошибка при выполнении запроса", e);
        }
    }

    private void handleError(int statusCode, String responseBody) 
            throws FeatureFlagsException {
        try {
            if (responseBody != null) {
                ErrorResponse errorResponse = objectMapper.readValue(
                    responseBody,
                    ErrorResponse.class
                );
                if (errorResponse.getError() != null) {
                    throw new FeatureFlagsException(
                        errorResponse.getError().getMessage(),
                        statusCode
                    );
                }
            }
            throw new FeatureFlagsException(
                "HTTP " + statusCode + ": Ошибка при выполнении запроса",
                statusCode
            );
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new FeatureFlagsException(
                "HTTP " + statusCode + ": Ошибка при выполнении запроса",
                statusCode
            );
        }
    }
}

// FeatureFlagsException.java
package com.example.featureflags.client;

public class FeatureFlagsException extends Exception {
    private final int statusCode;

    public FeatureFlagsException(String message) {
        super(message);
        this.statusCode = 0;
    }

    public FeatureFlagsException(String message, int statusCode) {
        super(message);
        this.statusCode = statusCode;
    }

    public FeatureFlagsException(String message, Throwable cause) {
        super(message, cause);
        this.statusCode = 0;
    }

    public int getStatusCode() {
        return statusCode;
    }
}

// Пример использования
public class Example {
    public static void main(String[] args) {
        FeatureFlagsClient client = new FeatureFlagsClient("http://localhost:4000/api");
        
        UserContext user = new UserContext("user-123");
        user.setSegments(List.of("premium", "beta"));
        
        try {
            Map<String, Boolean> flags = client.evaluateFlags(
                EvaluateRequest.Environment.production,
                user,
                List.of("new-feature", "dark-mode", "experimental-ui")
            );
            
            flags.forEach((key, value) -> 
                System.out.println(key + ": " + (value ? "Включен" : "Выключен"))
            );
        } catch (FeatureFlagsException e) {
            System.err.println("Ошибка: " + e.getMessage());
        }
    }
}
```

---

## Пример с Spring RestTemplate

### Зависимости (Maven)

```xml
<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
</dependencies>
```

### Конфигурация

```java
// FeatureFlagsConfig.java
package com.example.featureflags.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

@Configuration
public class FeatureFlagsConfig {
    
    @Bean
    public RestTemplate restTemplate() {
        RestTemplate restTemplate = new RestTemplate(getClientHttpRequestFactory());
        return restTemplate;
    }

    private ClientHttpRequestFactory getClientHttpRequestFactory() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10000);  // 10 секунд
        factory.setReadTimeout(30000);     // 30 секунд
        return factory;
    }
}
```

### Сервис

```java
// FeatureFlagsService.java
package com.example.featureflags.service;

import com.example.featureflags.dto.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

@Service
public class FeatureFlagsService {
    private final RestTemplate restTemplate;
    private final String apiBaseUrl;

    public FeatureFlagsService(
            RestTemplate restTemplate,
            @Value("${feature-flags.api.base-url:http://localhost:4000/api}") 
            String apiBaseUrl) {
        this.restTemplate = restTemplate;
        this.apiBaseUrl = apiBaseUrl;
    }

    public Map<String, Boolean> evaluateFlags(
            EvaluateRequest.Environment environment,
            UserContext user,
            List<String> flags) throws FeatureFlagsException {
        
        EvaluateRequest request = new EvaluateRequest(environment, user, flags);
        
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        
        HttpEntity<EvaluateRequest> entity = new HttpEntity<>(request, headers);
        
        try {
            ResponseEntity<EvaluateResponse> response = restTemplate.exchange(
                apiBaseUrl + "/evaluate",
                HttpMethod.POST,
                entity,
                EvaluateResponse.class
            );
            
            return response.getBody() != null 
                ? response.getBody().getFlags() 
                : Map.of();
                
        } catch (HttpClientErrorException | HttpServerErrorException e) {
            handleHttpError(e);
            return Map.of(); // Недостижимо, но компилятор требует
        } catch (RestClientException e) {
            throw new FeatureFlagsException(
                "Ошибка при выполнении запроса: " + e.getMessage(),
                e
            );
        }
    }

    private void handleHttpError(HttpStatusCodeException e) 
            throws FeatureFlagsException {
        try {
            String responseBody = e.getResponseBodyAsString();
            if (responseBody != null && !responseBody.isEmpty()) {
                ObjectMapper objectMapper = new ObjectMapper();
                ErrorResponse errorResponse = objectMapper.readValue(
                    responseBody,
                    ErrorResponse.class
                );
                if (errorResponse.getError() != null) {
                    throw new FeatureFlagsException(
                        errorResponse.getError().getMessage(),
                        e.getStatusCode().value()
                    );
                }
            }
        } catch (com.fasterxml.jackson.core.JsonProcessingException ignored) {
            // Игнорируем ошибки парсинга, используем стандартное сообщение
        }
        
        throw new FeatureFlagsException(
            "HTTP " + e.getStatusCode().value() + ": " + e.getStatusText(),
            e.getStatusCode().value()
        );
    }
}
```

---

## Пример с Spring WebClient (реактивный подход)

### Зависимости (Maven)

```xml
<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-webflux</artifactId>
    </dependency>
</dependencies>
```

### Сервис

```java
// FeatureFlagsReactiveService.java
package com.example.featureflags.service;

import com.example.featureflags.dto.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.List;
import java.util.Map;

@Service
public class FeatureFlagsReactiveService {
    private final WebClient webClient;
    private final String apiBaseUrl;

    public FeatureFlagsReactiveService(
            @Value("${feature-flags.api.base-url:http://localhost:4000/api}") 
            String apiBaseUrl) {
        this.apiBaseUrl = apiBaseUrl;
        this.webClient = WebClient.builder()
            .baseUrl(apiBaseUrl)
            .defaultHeader("Content-Type", "application/json")
            .build();
    }

    public Mono<Map<String, Boolean>> evaluateFlags(
            EvaluateRequest.Environment environment,
            UserContext user,
            List<String> flags) {
        
        EvaluateRequest request = new EvaluateRequest(environment, user, flags);
        
        return webClient
            .post()
            .uri("/evaluate")
            .bodyValue(request)
            .retrieve()
            .bodyToMono(EvaluateResponse.class)
            .map(EvaluateResponse::getFlags)
            .timeout(Duration.ofSeconds(30))
            .onErrorMap(WebClientResponseException.class, this::handleWebClientError)
            .onErrorMap(Exception.class, e -> 
                new FeatureFlagsException("Ошибка при выполнении запроса", e)
            );
    }

    private FeatureFlagsException handleWebClientError(WebClientResponseException e) {
        try {
            String responseBody = e.getResponseBodyAsString();
            if (responseBody != null && !responseBody.isEmpty()) {
                ObjectMapper objectMapper = new ObjectMapper();
                ErrorResponse errorResponse = objectMapper.readValue(
                    responseBody,
                    ErrorResponse.class
                );
                if (errorResponse.getError() != null) {
                    return new FeatureFlagsException(
                        errorResponse.getError().getMessage(),
                        e.getStatusCode().value()
                    );
                }
            }
        } catch (com.fasterxml.jackson.core.JsonProcessingException ignored) {
            // Игнорируем ошибки парсинга
        }
        
        return new FeatureFlagsException(
            "HTTP " + e.getStatusCode().value() + ": " + e.getStatusText(),
            e.getStatusCode().value()
        );
    }
}

// Пример использования в контроллере
@RestController
@RequestMapping("/api/features")
public class FeatureFlagsController {
    private final FeatureFlagsReactiveService service;

    public FeatureFlagsController(FeatureFlagsReactiveService service) {
        this.service = service;
    }

    @GetMapping("/evaluate")
    public Mono<Map<String, Boolean>> evaluateFlags(
            @RequestParam String userId,
            @RequestParam List<String> flags) {
        
        UserContext user = new UserContext(userId);
        return service.evaluateFlags(
            EvaluateRequest.Environment.production,
            user,
            flags
        );
    }
}
```

---

## Пример с Apache HttpClient

### Зависимости (Maven)

```xml
<dependencies>
    <dependency>
        <groupId>org.apache.httpcomponents.client5</groupId>
        <artifactId>httpclient5</artifactId>
        <version>5.2.1</version>
    </dependency>
    <dependency>
        <groupId>com.fasterxml.jackson.core</groupId>
        <artifactId>jackson-databind</artifactId>
        <version>2.15.2</version>
    </dependency>
</dependencies>
```

### Пример использования

```java
// FeatureFlagsApacheClient.java
package com.example.featureflags.client;

import com.example.featureflags.dto.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.hc.client5.http.classic.methods.HttpPost;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.CloseableHttpResponse;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.core5.http.io.entity.EntityUtils;
import org.apache.hc.core5.http.io.entity.StringEntity;
import org.apache.hc.core5.util.Timeout;

import java.util.List;
import java.util.Map;

public class FeatureFlagsApacheClient {
    private final CloseableHttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final String apiBaseUrl;

    public FeatureFlagsApacheClient(String apiBaseUrl) {
        this.apiBaseUrl = apiBaseUrl;
        this.httpClient = HttpClients.custom()
            .setConnectionTimeToLive(Timeout.ofSeconds(10))
            .build();
        this.objectMapper = new ObjectMapper();
    }

    public Map<String, Boolean> evaluateFlags(
            EvaluateRequest.Environment environment,
            UserContext user,
            List<String> flags) throws FeatureFlagsException {
        
        EvaluateRequest request = new EvaluateRequest(environment, user, flags);
        
        try {
            String jsonBody = objectMapper.writeValueAsString(request);
            
            HttpPost httpPost = new HttpPost(apiBaseUrl + "/evaluate");
            httpPost.setHeader("Content-Type", "application/json");
            httpPost.setEntity(new StringEntity(jsonBody));
            
            try (CloseableHttpResponse response = httpClient.execute(httpPost)) {
                String responseBody = EntityUtils.toString(response.getEntity());
                int statusCode = response.getCode();
                
                if (statusCode >= 200 && statusCode < 300) {
                    EvaluateResponse evaluateResponse = objectMapper.readValue(
                        responseBody,
                        EvaluateResponse.class
                    );
                    return evaluateResponse.getFlags();
                } else {
                    handleError(statusCode, responseBody);
                    return Map.of(); // Недостижимо
                }
            }
        } catch (Exception e) {
            throw new FeatureFlagsException("Ошибка при выполнении запроса", e);
        }
    }

    private void handleError(int statusCode, String responseBody) 
            throws FeatureFlagsException {
        try {
            if (responseBody != null && !responseBody.isEmpty()) {
                ErrorResponse errorResponse = objectMapper.readValue(
                    responseBody,
                    ErrorResponse.class
                );
                if (errorResponse.getError() != null) {
                    throw new FeatureFlagsException(
                        errorResponse.getError().getMessage(),
                        statusCode
                    );
                }
            }
        } catch (com.fasterxml.jackson.core.JsonProcessingException ignored) {
            // Игнорируем ошибки парсинга
        }
        
        throw new FeatureFlagsException(
            "HTTP " + statusCode + ": Ошибка при выполнении запроса",
            statusCode
        );
    }

    public void close() throws Exception {
        httpClient.close();
    }
}
```

---

## Обработка ошибок

### Кастомный Exception Handler

```java
// FeatureFlagsException.java
package com.example.featureflags.exception;

public class FeatureFlagsException extends Exception {
    private final int statusCode;
    private final String errorCode;

    public FeatureFlagsException(String message) {
        super(message);
        this.statusCode = 0;
        this.errorCode = null;
    }

    public FeatureFlagsException(String message, int statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.errorCode = null;
    }

    public FeatureFlagsException(String message, Throwable cause) {
        super(message, cause);
        this.statusCode = 0;
        this.errorCode = null;
    }

    public FeatureFlagsException(String message, int statusCode, String errorCode) {
        super(message);
        this.statusCode = statusCode;
        this.errorCode = errorCode;
    }

    public int getStatusCode() {
        return statusCode;
    }

    public String getErrorCode() {
        return errorCode;
    }

    public boolean isClientError() {
        return statusCode >= 400 && statusCode < 500;
    }

    public boolean isServerError() {
        return statusCode >= 500;
    }
}
```

### Улучшенная обработка ошибок в сервисе

```java
// Улучшенный метод обработки ошибок
private void handleError(int statusCode, String responseBody) 
        throws FeatureFlagsException {
    if (responseBody == null || responseBody.isEmpty()) {
        throw new FeatureFlagsException(
            "HTTP " + statusCode + ": Пустой ответ от сервера",
            statusCode
        );
    }

    try {
        ErrorResponse errorResponse = objectMapper.readValue(
            responseBody,
            ErrorResponse.class
        );
        
        if (errorResponse.getError() != null) {
            ApiError error = errorResponse.getError();
            throw new FeatureFlagsException(
                error.getMessage(),
                statusCode,
                error.getCode()
            );
        }
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
        // Если не удалось распарсить структурированную ошибку
        throw new FeatureFlagsException(
            "HTTP " + statusCode + ": " + responseBody,
            statusCode
        );
    }
}
```

---

## Настройка таймаутов

### OkHttp

```java
OkHttpClient httpClient = new OkHttpClient.Builder()
    .connectTimeout(10, TimeUnit.SECONDS)      // Таймаут подключения
    .readTimeout(30, TimeUnit.SECONDS)          // Таймаут чтения
    .writeTimeout(30, TimeUnit.SECONDS)         // Таймаут записи
    .callTimeout(60, TimeUnit.SECONDS)          // Общий таймаут запроса
    .build();
```

### Spring RestTemplate

```java
SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
factory.setConnectTimeout(Duration.ofSeconds(10));  // Таймаут подключения
factory.setReadTimeout(Duration.ofSeconds(30));     // Таймаут чтения
RestTemplate restTemplate = new RestTemplate(factory);
```

### Spring WebClient

```java
WebClient webClient = WebClient.builder()
    .baseUrl(apiBaseUrl)
    .clientConnector(new ReactorClientHttpConnector(
        HttpClient.create()
            .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 10000)
            .responseTimeout(Duration.ofSeconds(30))
    ))
    .build();
```

---

## Аутентификация

### Использование API ключа

```java
// Для OkHttp
Request httpRequest = new Request.Builder()
    .url(apiBaseUrl + "/evaluate")
    .post(body)
    .addHeader("Content-Type", "application/json")
    .addHeader("X-API-Key", "your-api-key-here")
    .build();

// Для Spring RestTemplate
HttpHeaders headers = new HttpHeaders();
headers.setContentType(MediaType.APPLICATION_JSON);
headers.set("X-API-Key", "your-api-key-here");
HttpEntity<EvaluateRequest> entity = new HttpEntity<>(request, headers);

// Для Spring WebClient
return webClient
    .post()
    .uri("/evaluate")
    .header("X-API-Key", "your-api-key-here")
    .bodyValue(request)
    .retrieve()
    .bodyToMono(EvaluateResponse.class);
```

### Использование Bearer токена (Keycloak)

```java
// Для OkHttp
Request httpRequest = new Request.Builder()
    .url(apiBaseUrl + "/evaluate")
    .post(body)
    .addHeader("Content-Type", "application/json")
    .addHeader("Authorization", "Bearer " + token)
    .build();

// Для Spring RestTemplate
HttpHeaders headers = new HttpHeaders();
headers.setContentType(MediaType.APPLICATION_JSON);
headers.setBearerAuth(token);
HttpEntity<EvaluateRequest> entity = new HttpEntity<>(request, headers);
```

---

## Полный пример сервиса

Полноценный пример сервиса с обработкой всех случаев:

```java
// FeatureFlagsService.java
package com.example.featureflags.service;

import com.example.featureflags.dto.*;
import com.example.featureflags.exception.FeatureFlagsException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@Service
public class FeatureFlagsService {
    private static final Logger logger = LoggerFactory.getLogger(FeatureFlagsService.class);
    
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final String apiBaseUrl;
    private final String apiKey;

    public FeatureFlagsService(
            RestTemplate restTemplate,
            ObjectMapper objectMapper,
            @Value("${feature-flags.api.base-url:http://localhost:4000/api}") 
            String apiBaseUrl,
            @Value("${feature-flags.api.key:}") 
            String apiKey) {
        this.restTemplate = restTemplate;
        this.objectMapper = objectMapper;
        this.apiBaseUrl = apiBaseUrl;
        this.apiKey = apiKey;
    }

    /**
     * Оценивает флаги для указанного пользователя и окружения
     *
     * @param environment окружение (development, staging, production)
     * @param user контекст пользователя
     * @param flags список ключей флагов для оценки
     * @return карта ключей флагов и их значений (true/false)
     * @throws FeatureFlagsException если произошла ошибка при выполнении запроса
     */
    public Map<String, Boolean> evaluateFlags(
            EvaluateRequest.Environment environment,
            UserContext user,
            List<String> flags) throws FeatureFlagsException {
        
        if (flags == null || flags.isEmpty()) {
            throw new IllegalArgumentException("Список флагов не может быть пустым");
        }
        
        if (user == null || user.getId() == null || user.getId().isEmpty()) {
            throw new IllegalArgumentException("ID пользователя обязателен");
        }
        
        EvaluateRequest request = new EvaluateRequest(environment, user, flags);
        
        HttpHeaders headers = createHeaders();
        HttpEntity<EvaluateRequest> entity = new HttpEntity<>(request, headers);
        
        String url = apiBaseUrl + "/evaluate";
        logger.debug("Выполнение запроса к {} для пользователя {}", url, user.getId());
        
        try {
            ResponseEntity<EvaluateResponse> response = restTemplate.exchange(
                url,
                HttpMethod.POST,
                entity,
                EvaluateResponse.class
            );
            
            EvaluateResponse evaluateResponse = response.getBody();
            if (evaluateResponse == null || evaluateResponse.getFlags() == null) {
                throw new FeatureFlagsException("Пустой ответ от сервера");
            }
            
            logger.debug("Успешно получены результаты для {} флагов", 
                evaluateResponse.getFlags().size());
            
            return evaluateResponse.getFlags();
                
        } catch (HttpClientErrorException e) {
            logger.warn("Ошибка клиента при запросе к API: HTTP {}", e.getStatusCode().value());
            handleHttpError(e);
            return Map.of(); // Недостижимо
        } catch (HttpServerErrorException e) {
            logger.error("Ошибка сервера при запросе к API: HTTP {}", 
                e.getStatusCode().value());
            handleHttpError(e);
            return Map.of(); // Недостижимо
        } catch (RestClientException e) {
            logger.error("Ошибка при выполнении HTTP запроса", e);
            throw new FeatureFlagsException(
                "Ошибка при выполнении запроса: " + e.getMessage(),
                e
            );
        }
    }

    private HttpHeaders createHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        
        if (apiKey != null && !apiKey.isEmpty()) {
            headers.set("X-API-Key", apiKey);
        }
        
        return headers;
    }

    private void handleHttpError(HttpStatusCodeException e) 
            throws FeatureFlagsException {
        String responseBody = e.getResponseBodyAsString();
        
        if (responseBody != null && !responseBody.isEmpty()) {
            try {
                ErrorResponse errorResponse = objectMapper.readValue(
                    responseBody,
                    ErrorResponse.class
                );
                
                if (errorResponse.getError() != null) {
                    ApiError error = errorResponse.getError();
                    throw new FeatureFlagsException(
                        error.getMessage(),
                        e.getStatusCode().value(),
                        error.getCode()
                    );
                }
            } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
                logger.debug("Не удалось распарсить структурированную ошибку", ex);
            }
        }
        
        throw new FeatureFlagsException(
            "HTTP " + e.getStatusCode().value() + ": " + e.getStatusText(),
            e.getStatusCode().value()
        );
    }
}

// application.yml
feature-flags:
  api:
    base-url: http://localhost:4000/api
    key: ${FEATURE_FLAGS_API_KEY:}
```

### Пример использования в контроллере

```java
// FeatureFlagsController.java
package com.example.featureflags.controller;

import com.example.featureflags.dto.*;
import com.example.featureflags.exception.FeatureFlagsException;
import com.example.featureflags.service.FeatureFlagsService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/features")
public class FeatureFlagsController {
    private final FeatureFlagsService service;

    public FeatureFlagsController(FeatureFlagsService service) {
        this.service = service;
    }

    @PostMapping("/evaluate")
    public ResponseEntity<?> evaluateFlags(
            @RequestParam(defaultValue = "production") String environment,
            @RequestParam String userId,
            @RequestParam(required = false) List<String> segments,
            @RequestBody List<String> flags) {
        
        try {
            EvaluateRequest.Environment env = EvaluateRequest.Environment.valueOf(environment);
            
            UserContext user = new UserContext(userId);
            if (segments != null && !segments.isEmpty()) {
                user.setSegments(segments);
            }
            
            Map<String, Boolean> result = service.evaluateFlags(env, user, flags);
            return ResponseEntity.ok(result);
            
        } catch (IllegalArgumentException e) {
            return ResponseEntity
                .badRequest()
                .body(Map.of("error", e.getMessage()));
        } catch (FeatureFlagsException e) {
            return ResponseEntity
                .status(e.getStatusCode() > 0 ? e.getStatusCode() : 500)
                .body(Map.of("error", e.getMessage()));
        }
    }
}
```

---

## Полезные ссылки

- [OkHttp Documentation](https://square.github.io/okhttp/)
- [Spring RestTemplate](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/client/RestTemplate.html)
- [Spring WebClient](https://docs.spring.io/spring-framework/docs/current/reference/html/web-reactive.html#webflux-client)
- [Apache HttpClient](https://hc.apache.org/httpcomponents-client-5.2.x/)
- [Jackson ObjectMapper](https://github.com/FasterXML/jackson-databind)

---

## Рекомендации

1. **Используйте connection pooling** для повышения производительности
2. **Настройте retry механизм** для обработки временных сбоев
3. **Логируйте запросы и ответы** для отладки (осторожно с чувствительными данными)
4. **Кэшируйте результаты** там, где это возможно
5. **Используйте async/реактивные подходы** (WebClient) для высокой нагрузки
6. **Валидируйте входные данные** перед отправкой запроса
7. **Обрабатывайте все типы ошибок** (сетевые, HTTP, парсинг JSON)

