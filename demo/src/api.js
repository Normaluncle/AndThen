// Session remains in memory: refresh requires reauthentication, never logs credentials.
let token = '';
export function setToken(value) { token = value; }
export async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token ? {Authorization:'Bearer '+token}: {})},body:body===undefined?undefined:JSON.stringify(body)});
  const data = await r.json();
  if (!r.ok) throw new Error((data.error?.message || data.message || '请求未成功') + ' · '+(data.error?.code || r.status));
  return data.data;
}
