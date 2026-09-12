import { z } from 'zod';
import { AppError } from '../../http/errors.js';

// Node 24 exposes the source token to JSON revivers. Preserve large numeric IDs
// before their rounded Number representation can enter the application.
export function parseOfficialJson(raw: string): unknown {
  return JSON.parse(raw, (_key: string, value: unknown, context?: { source?: string }) => {
    if (typeof value === 'number' && !Number.isSafeInteger(value) && context?.source && /^\d+$/.test(context.source)) return context.source;
    return value;
  });
}

export async function officialGet<T>(secret: string | undefined, path: string, params: Record<string, string>, schema: z.ZodType<T, z.ZodTypeDef, unknown>, transport: typeof fetch = fetch, oauthToken?: string): Promise<T> {
  if (!secret) throw AppError.serviceUnavailable('Zhihu credential is not configured');
  const url = new URL(path, 'https://developer.zhihu.com');
  if (url.origin !== 'https://developer.zhihu.com' || !url.pathname.startsWith('/api/v1/')) throw AppError.validation('Invalid official endpoint');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  try {
    const response = await transport(url, { method: 'GET', redirect: 'error', headers: {
      Authorization: `Bearer ${secret}`, 'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
      'Content-Type': 'application/json', ...(oauthToken ? { 'X-OAuth-Token': oauthToken } : {}),
    }, signal: AbortSignal.timeout(20000) });
    if (response.status === 429) throw new AppError({ code: 'quota_exhausted', message: '知乎接口暂达调用限制，请稍后再试' });
    if (!response.ok || !response.body) throw AppError.serviceUnavailable('知乎官方接口暂不可用');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 1_000_000) { await reader.cancel(); throw AppError.serviceUnavailable('Official response exceeds budget'); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const envelope = z.object({ Code: z.number(), Data: z.unknown() }).parse(parseOfficialJson(Buffer.concat(chunks).toString('utf8')));
    if ([30001, 30002].includes(envelope.Code)) throw new AppError({ code: 'quota_exhausted', message: '知乎接口暂达调用限制，请稍后再试' });
    if ([20001, 30003].includes(envelope.Code)) throw AppError.forbidden('知乎官方接口未允许本次读取');
    if (envelope.Code === 10001) throw AppError.sourceIncomplete('官方未能返回这篇内容；可能不可用或不属于凭证账号');
    if (envelope.Code !== 0) throw AppError.serviceUnavailable('知乎官方接口暂不可用');
    return schema.parse(envelope.Data);
  } catch (error) {
    if (error instanceof AppError) throw error;
    // Neither provider Message nor malformed response/transport error may expose credentials.
    throw AppError.serviceUnavailable('知乎响应未能通过验证或请求超时');
  }
}
