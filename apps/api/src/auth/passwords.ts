// Хэширование паролей: алгоритм bcrypt, cost 12 (D-011). Реализация — bcryptjs
// (чистый JS, без нативных postinstall-скриптов, которые pnpm 10 блокирует);
// формат хэша совместим с нативным bcrypt. Ввод длиннее 72 байт отклоняется
// zod-схемой contracts ещё до хэширования (bcrypt молча усекает на 72, D-111).

import bcrypt from 'bcryptjs';

export const BCRYPT_ROUNDS = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
