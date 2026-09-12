import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../http/errors.js';
import { parseOfficialJson } from './transport.js';

export interface OAuthApplication { appId: string; appKey: string; redirectUri: string }

function redirectUri(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw AppError.validation('OAuth callback requires a registered HTTPS address'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw AppError.validation('OAuth callback requires a registered HTTPS address');
  return value; // Exact registered bytes are reused in authorization and exchange.
}

export function authorizationUrl(app: OAuthApplication, state: string) {
  if (!app.appId || !/^[a-zA-Z0-9_-]{32,128}$/.test(state)) throw AppError.validation('Invalid OAuth initiation');
  const url = new URL('https://openapi.zhihu.com/authorize');
  url.search = new URLSearchParams({ app_id: app.appId, redirect_uri: redirectUri(app.redirectUri), response_type: 'code', state }).toString();
  return url.toString();
}

/** A cookie alone is not callback correlation. Missing state must fail closed. */
export function callbackCode(query: Record<string, unknown>, expectedState: string) {
  const state = query.state;
  if (typeof state !== 'string' || !/^[a-zA-Z0-9_-]{32,128}$/.test(expectedState)
    || Buffer.byteLength(state) !== Buffer.byteLength(expectedState)
    || !timingSafeEqual(Buffer.from(state), Buffer.from(expectedState))) throw AppError.forbidden('OAuth callback does not match its initiating request');
  const primary = query.authorization_code, alternate = query.code;
  if (primary !== undefined && alternate !== undefined && primary !== alternate) throw AppError.validation('Ambiguous OAuth authorization code');
  const code = primary ?? alternate;
  if (typeof code !== 'string' || code.length < 1 || code.length > 4096 || query.error !== undefined) throw AppError.validation('OAuth authorization was not completed');
  return code;
}

async function request(path: '/access_token' | '/user', init: RequestInit, transport: typeof fetch) {
  try {
    const response = await transport('https://openapi.zhihu.com' + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok || !response.body) throw new Error('unavailable');
    const reader = response.body.getReader();
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 65536) { await reader.cancel(); throw new Error('response limit'); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    return parseOfficialJson(Buffer.concat(chunks).toString('utf8'));
  } catch {
    // Never propagate provider errors, URLs, codes or tokens to logs/responses.
    throw AppError.serviceUnavailable('Zhihu authorization service is unavailable');
  }
}

export async function exchangeCode(app: OAuthApplication, code: string, transport: typeof fetch = fetch) {
  if (!app.appId || !app.appKey || !code || code.length > 4096) throw AppError.validation('OAuth configuration or authorization code is missing');
  const raw = await request('/access_token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ app_id: app.appId, app_key: app.appKey, grant_type: 'authorization_code', redirect_uri: redirectUri(app.redirectUri), code }).toString() }, transport);
  const token = z.object({ access_token: z.string().min(1).max(8192), token_type: z.string().regex(/^Bearer$/i), expires_in: z.number().int().positive().max(31536000) }).safeParse(raw);
  if (!token.success) throw AppError.serviceUnavailable('Zhihu did not return a valid authorization token');
  return token.data;
}

export async function authorizedProfile(accessToken: string, transport: typeof fetch = fetch) {
  if (!accessToken) throw AppError.unauthorized();
  const raw = await request('/user', { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } }, transport);
  const optionalText = (max: number) => z.preprocess(value => value === null || value === '' ? undefined : value, z.string().max(max).optional());
  const parsed = z.object({ uid: z.union([z.string().regex(/^\d+$/), z.number().int().safe().positive()]).transform(String),
    hash_id: optionalText(256), fullname: optionalText(200), headline: optionalText(2000),
    avatar_path: z.preprocess(value => value === null || value === '' ? undefined : value, z.string().url().refine(value => ['https:', 'http:'].includes(new URL(value).protocol)).optional()) }).safeParse(raw);
  if (!parsed.success || /^0+$/.test(parsed.data.uid)) throw AppError.serviceUnavailable('Zhihu did not return a valid user identity');
  // Email/phone/gender and the OpenAPI user URL are deliberately not account keys.
  return parsed.data;
}

function encryptionKey(hex: string) {
  if (!/^[a-fA-F0-9]{64}$/.test(hex)) throw AppError.serviceUnavailable('OAuth token encryption is not configured');
  return Buffer.from(hex, 'hex');
}
export function sealToken(token: string, keyHex: string, accountId: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(keyHex), iv);
  cipher.setAAD(Buffer.from('zhihu:' + accountId));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}
export function openToken(sealed: string, keyHex: string, accountId: string) {
  try {
    const [version, iv, tag, ciphertext, extra] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext || extra) throw new Error('format');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(keyHex), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from('zhihu:' + accountId));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch { throw AppError.serviceUnavailable('Stored Zhihu authorization is unavailable'); }
}
