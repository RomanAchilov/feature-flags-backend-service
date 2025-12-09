import { describe, expect, it } from "vitest";
import {
	decrypt,
	decryptIfNeeded,
	encrypt,
	isEncrypted,
} from "../../src/config/secrets";

describe("secrets", () => {
	const TEST_PASSWORD = "test-master-password-123";

	describe("encrypt/decrypt", () => {
		it("должен корректно шифровать и расшифровывать строку", () => {
			const plaintext = "my_super_secret_password";
			const encrypted = encrypt(plaintext, TEST_PASSWORD);
			const decrypted = decrypt(encrypted, TEST_PASSWORD);

			expect(decrypted).toBe(plaintext);
		});

		it("должен создавать разные шифротексты для одного значения", () => {
			const plaintext = "same_value";
			const encrypted1 = encrypt(plaintext, TEST_PASSWORD);
			const encrypted2 = encrypt(plaintext, TEST_PASSWORD);

			// Salt и IV случайные, поэтому шифротексты разные
			expect(encrypted1).not.toBe(encrypted2);

			// Но оба расшифровываются в одно значение
			expect(decrypt(encrypted1, TEST_PASSWORD)).toBe(plaintext);
			expect(decrypt(encrypted2, TEST_PASSWORD)).toBe(plaintext);
		});

		it("должен корректно обрабатывать unicode строки", () => {
			const plaintext = "Пароль с русскими символами 🔐";
			const encrypted = encrypt(plaintext, TEST_PASSWORD);
			const decrypted = decrypt(encrypted, TEST_PASSWORD);

			expect(decrypted).toBe(plaintext);
		});

		it("должен корректно обрабатывать пустую строку", () => {
			const plaintext = "";
			const encrypted = encrypt(plaintext, TEST_PASSWORD);
			const decrypted = decrypt(encrypted, TEST_PASSWORD);

			expect(decrypted).toBe(plaintext);
		});

		it("должен падать при неверном пароле", () => {
			const plaintext = "secret";
			const encrypted = encrypt(plaintext, TEST_PASSWORD);

			expect(() => decrypt(encrypted, "wrong-password")).toThrow();
		});

		it("должен падать при повреждённом шифротексте", () => {
			const plaintext = "secret";
			const encrypted = encrypt(plaintext, TEST_PASSWORD);
			const corrupted = `${encrypted.slice(0, -5)}AAAAA`;

			expect(() => decrypt(corrupted, TEST_PASSWORD)).toThrow();
		});

		it("должен падать при неверном формате", () => {
			expect(() => decrypt("not-encrypted", TEST_PASSWORD)).toThrow(
				/Неверный формат/,
			);
			expect(() => decrypt("ENC()", TEST_PASSWORD)).toThrow();
		});
	});

	describe("isEncrypted", () => {
		it("должен определять зашифрованные значения", () => {
			expect(isEncrypted("ENC(abc123)")).toBe(true);
			expect(isEncrypted("ENC(some/base64+value==)")).toBe(true);
		});

		it("должен определять незашифрованные значения", () => {
			expect(isEncrypted("plain_password")).toBe(false);
			expect(isEncrypted("not_enc(value)")).toBe(false);
			expect(isEncrypted("ENC")).toBe(false);
			expect(isEncrypted("ENC()")).toBe(false);
		});
	});

	describe("decryptIfNeeded", () => {
		it("должен расшифровывать ENC() значения", () => {
			const plaintext = "secret_value";
			const encrypted = encrypt(plaintext, TEST_PASSWORD);
			const result = decryptIfNeeded(encrypted, TEST_PASSWORD);

			expect(result).toBe(plaintext);
		});

		it("должен возвращать plain значения как есть", () => {
			const plaintext = "not_encrypted_value";
			const result = decryptIfNeeded(plaintext, TEST_PASSWORD);

			expect(result).toBe(plaintext);
		});

		it("должен падать если ENC() без пароля", () => {
			const encrypted = encrypt("secret", TEST_PASSWORD);

			expect(() => decryptIfNeeded(encrypted, undefined)).toThrow(
				/ENCRYPTION_PASSWORD не задан/,
			);
		});

		it("не должен требовать пароль для plain значений", () => {
			const result = decryptIfNeeded("plain_value", undefined);
			expect(result).toBe("plain_value");
		});
	});

	describe("формат вывода", () => {
		it("должен создавать формат ENC(base64)", () => {
			const encrypted = encrypt("test", TEST_PASSWORD);

			expect(encrypted).toMatch(/^ENC\([A-Za-z0-9+/=]+\)$/);
		});

		it("зашифрованное значение должно быть достаточно длинным", () => {
			const encrypted = encrypt("x", TEST_PASSWORD);
			// salt(32) + iv(16) + authTag(16) + ciphertext(1+) = минимум 65 байт = ~87 base64 символов
			const base64Content = encrypted.slice(4, -1); // убираем ENC()
			expect(base64Content.length).toBeGreaterThan(80);
		});
	});
});
