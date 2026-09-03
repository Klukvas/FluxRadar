import { notFound } from './errors.ts';

/** Express 5 params can be arrays when a wildcard route is used; API routes require one value. */
export function requiredParam(value: string | string[] | undefined, name: string): string {
  if (typeof value === 'string' && value !== '') {
    return value;
  }
  throw notFound(`${name} is required`);
}
