// Разбор заголовка Cookie без внешней зависимости: API использует ровно одну
// httpOnly-сессионную куку, полный парсер cookie-jar не нужен.

export function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined || header === '') {
    return null;
  }
  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const key = part.slice(0, separatorIndex).trim();
    if (key !== name) {
      continue;
    }
    const rawValue = part.slice(separatorIndex + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch {
      // Некорректный percent-encoding — кука невалидна, а не ошибка запроса.
      return null;
    }
  }
  return null;
}
