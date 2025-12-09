import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	scryptSync,
} from "node:crypto";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Модуль шифрования секретов (аналог Jasypt для Java)
// ─────────────────────────────────────────────────────────────────────────────
//
// Поддерживаемые форматы:
// 1. ENC(base64_encrypted_value) — зашифрованное значение (как в Jasypt)
// 2. Обычная строка — используется как есть
//
// Алгоритм: AES-256-GCM (рекомендуется для современных приложений)
// Ключ шифрования: Создаётся из мастер-пароля через scrypt
//
// Использование:
// 1. Установите переменную окружения ENCRYPTION_PASSWORD
// 2. Зашифруйте секрет: npx tsx src/config/secrets.ts encrypt "my_secret_password"
// 3. Используйте в .env: DATABASE_PASSWORD=ENC(base64_encrypted_value)
// ─────────────────────────────────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

// Паттерн для обнаружения зашифрованных значений (как в Jasypt)
const ENCRYPTED_PATTERN = /^ENC\((.+)\)$/;

/**
 * Генерирует ключ шифрования из мастер-пароля
 */
const deriveKey = (password: string, salt: Buffer): Buffer => {
	return scryptSync(password, salt, KEY_LENGTH);
};

/**
 * Шифрует строку
 * Формат вывода: base64(salt + iv + authTag + ciphertext)
 */
export const encrypt = (plaintext: string, password: string): string => {
	const salt = randomBytes(SALT_LENGTH);
	const key = deriveKey(password, salt);
	const iv = randomBytes(IV_LENGTH);

	const cipher = createCipheriv(ALGORITHM, key, iv);
	const encrypted = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();

	// Собираем всё вместе: salt + iv + authTag + encrypted
	const combined = Buffer.concat([salt, iv, authTag, encrypted]);
	return `ENC(${combined.toString("base64")})`;
};

/**
 * Расшифровывает строку в формате ENC(base64_value)
 */
export const decrypt = (encryptedValue: string, password: string): string => {
	const match = encryptedValue.match(ENCRYPTED_PATTERN);
	if (!match) {
		throw new Error(
			"Неверный формат зашифрованного значения. Ожидается: ENC(base64_value)",
		);
	}

	const combined = Buffer.from(match[1], "base64");

	// Извлекаем компоненты
	const salt = combined.subarray(0, SALT_LENGTH);
	const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
	const authTag = combined.subarray(
		SALT_LENGTH + IV_LENGTH,
		SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
	);
	const ciphertext = combined.subarray(
		SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
	);

	const key = deriveKey(password, salt);
	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(authTag);

	const decrypted = Buffer.concat([
		decipher.update(ciphertext),
		decipher.final(),
	]);

	return decrypted.toString("utf8");
};

/**
 * Проверяет, является ли значение зашифрованным
 */
export const isEncrypted = (value: string): boolean => {
	return ENCRYPTED_PATTERN.test(value);
};

/**
 * Расшифровывает значение, если оно зашифровано.
 * Иначе возвращает как есть.
 */
export const decryptIfNeeded = (
	value: string,
	password: string | undefined,
): string => {
	if (!isEncrypted(value)) {
		return value;
	}

	if (!password) {
		throw new Error(
			"Найдено зашифрованное значение, но ENCRYPTION_PASSWORD не задан",
		);
	}

	return decrypt(value, password);
};

// ─────────────────────────────────────────────────────────────────────────────
// Конфигурация окружения с поддержкой шифрования
// ─────────────────────────────────────────────────────────────────────────────

const ENCRYPTION_PASSWORD = process.env.ENCRYPTION_PASSWORD;

/**
 * Получает переменную окружения и расшифровывает, если нужно
 */
export const getSecret = (
	envName: string,
	defaultValue?: string,
): string | undefined => {
	const value = process.env[envName] ?? defaultValue;
	if (!value) return undefined;
	return decryptIfNeeded(value, ENCRYPTION_PASSWORD);
};

/**
 * Получает обязательную переменную окружения
 */
export const requireSecret = (envName: string): string => {
	const value = getSecret(envName);
	if (!value) {
		throw new Error(`Обязательная переменная окружения ${envName} не задана`);
	}
	return value;
};

// ─────────────────────────────────────────────────────────────────────────────
// Zod схема для секретов с автоматической расшифровкой
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Создаёт Zod-трансформер для автоматической расшифровки секретов
 */
export const encryptedString = () =>
	z.string().transform((val) => decryptIfNeeded(val, ENCRYPTION_PASSWORD));

// ─────────────────────────────────────────────────────────────────────────────
// CLI для шифрования/расшифровки секретов
// ─────────────────────────────────────────────────────────────────────────────

const runCli = () => {
	const args = process.argv.slice(2);
	const command = args[0];
	const value = args[1];
	const password = args[2] || process.env.ENCRYPTION_PASSWORD;

	if (!command || !value) {
		console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                  🔐 Feature Flags — Шифрование секретов                       ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║ Аналог Jasypt для Node.js/TypeScript                                          ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║ Использование:                                                                ║
║   npx tsx src/config/secrets.ts encrypt <значение> [пароль]                   ║
║   npx tsx src/config/secrets.ts decrypt <ENC(...)> [пароль]                   ║
║   npx tsx src/config/secrets.ts verify <ENC(...)> [пароль]                    ║
║                                                                               ║
║ Примеры:                                                                      ║
║   npx tsx src/config/secrets.ts encrypt "my_db_password" "master_password"    ║
║   npx tsx src/config/secrets.ts decrypt "ENC(abc...)" "master_password"       ║
║                                                                               ║
║ Переменные окружения:                                                         ║
║   ENCRYPTION_PASSWORD — мастер-пароль для шифрования (вместо аргумента)       ║
║                                                                               ║
║ Использование в .env:                                                         ║
║   DATABASE_PASSWORD=ENC(base64_encrypted_value_here)                          ║
║   API_SECRET=ENC(another_encrypted_value)                                     ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);
		process.exit(1);
	}

	if (!password) {
		console.error(
			"❌ Ошибка: Укажите пароль как аргумент или через ENCRYPTION_PASSWORD",
		);
		process.exit(1);
	}

	switch (command) {
		case "encrypt": {
			const encrypted = encrypt(value, password);
			console.log("\n✅ Зашифрованное значение:");
			console.log(encrypted);
			console.log("\nИспользуйте в .env или Kubernetes Secret.");
			break;
		}
		case "decrypt": {
			try {
				const decrypted = decrypt(value, password);
				console.log("\n✅ Расшифрованное значение:");
				console.log(decrypted);
			} catch (error) {
				console.error("❌ Ошибка расшифровки:", (error as Error).message);
				process.exit(1);
			}
			break;
		}
		case "verify": {
			try {
				const decrypted = decrypt(value, password);
				console.log(
					"✅ Проверка успешна! Значение корректно расшифровывается.",
				);
				console.log(`   Длина: ${decrypted.length} символов`);
			} catch (error) {
				console.error("❌ Проверка не пройдена:", (error as Error).message);
				process.exit(1);
			}
			break;
		}
		default:
			console.error(`❌ Неизвестная команда: ${command}`);
			process.exit(1);
	}
};

// Запускаем CLI только при прямом вызове файла
const isDirectRun = process.argv[1]?.includes("secrets");
if (isDirectRun) {
	runCli();
}
