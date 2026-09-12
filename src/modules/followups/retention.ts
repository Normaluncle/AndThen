import { AppError } from '../../http/errors.js';

export const PRIVATE_RETENTION_MS = 30 * 86400000;

export function privateExpired(updatedAt: Date, now = new Date()) {
  return updatedAt.getTime() <= now.getTime() - PRIVATE_RETENTION_MS;
}

export function requirePrivateFresh(updatedAt: Date, now = new Date()) {
  if (privateExpired(updatedAt, now)) throw AppError.withdrawn('Private content retention period expired');
}

/** Historical publication hashes remain audit receipts, not hashes of this projection. */
export function publicStatements(items: unknown[]) {
  return items.filter(item => typeof item === 'object' && item !== null && 'visibility' in item && item.visibility === 'public');
}
