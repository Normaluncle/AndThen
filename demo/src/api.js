// Session remains in memory: refresh requires reauthentication, never logs credentials.
let token = '';
export function setToken(value) { token = value; }
export async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token ? {Authorization:'Bearer '+token}: {})},body:body===undefined?undefined:JSON.stringify(body)});
  const data = await r.json();
  if (!r.ok) {
    const code=data.error?.code||data.error_code;
    const message=r.status===410?'该内容已撤回或不再提供':(data.error?.message||data.message||'请求未成功');
    const error = new Error(message+' · '+(code||r.status));
    error.status = r.status;
    throw error;
  }
  return data.data;
}
