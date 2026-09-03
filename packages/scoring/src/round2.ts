// round2 по D-021: округление half-up по десятичному представлению числа
// (не banker's и не по двоичному значению: (2.675).toFixed(2) дал бы «2.67»,
// потому что double 2.675 чуть меньше; десятичное представление — «2.675»).

/**
 * Верхняя граница домена: сотые должны оставаться в безопасных целых
 * (Number.MAX_SAFE_INTEGER / 100 ≈ 9e13), а String(value) — без экспоненты
 * в целой части. Score/penalty/coverage лежат в 0..100 с большим запасом.
 */
const MAX_ABS_VALUE = 1e12;

/**
 * Округляет до двух знаков half-up по кратчайшему десятичному представлению
 * числа. Работает в целых сотых (без умножения на 100 в float): решение
 * принимает третья десятичная цифра строкового представления.
 * Отрицательные значения округляются симметрично (от нуля); в домене score
 * они не встречаются.
 */
export function round2(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`round2 ожидает конечное число, получено: ${value}`);
  }
  if (Math.abs(value) > MAX_ABS_VALUE) {
    throw new Error(`round2 поддерживает |value| <= ${MAX_ABS_VALUE}, получено: ${value}`);
  }
  const sign = value < 0 ? -1 : 1;
  const [integerPart = '0', fractionPart = ''] = toPlainDecimalString(Math.abs(value)).split('.');
  const keptHundredths =
    Number(integerPart) * 100 + Number(fractionPart.slice(0, 2).padEnd(2, '0'));
  const roundUp = fractionPart.charAt(2) >= '5' && fractionPart.charAt(2) <= '9';
  return (sign * (keptHundredths + (roundUp ? 1 : 0))) / 100;
}

/** Разворачивает экспоненциальную запись (`1e-9`) в обычную десятичную строку. */
function toPlainDecimalString(value: number): string {
  const text = String(value);
  const exponentIndex = text.search(/e/i);
  if (exponentIndex === -1) {
    return text;
  }
  const mantissa = text.slice(0, exponentIndex);
  const exponent = Number(text.slice(exponentIndex + 1));
  const [integerDigits = '0', fractionDigits = ''] = mantissa.split('.');
  const digits = integerDigits + fractionDigits;
  const pointIndex = integerDigits.length + exponent;
  if (pointIndex <= 0) {
    return `0.${'0'.repeat(-pointIndex)}${digits}`;
  }
  if (pointIndex >= digits.length) {
    return digits + '0'.repeat(pointIndex - digits.length);
  }
  return `${digits.slice(0, pointIndex)}.${digits.slice(pointIndex)}`;
}
