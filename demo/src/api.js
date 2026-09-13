// Browser credentials live in an HttpOnly cookie. This flag is UI state only.
let signedIn = false;
export function hasSession(){return signedIn;}
export function setToken(value) { signedIn = !!value; }
export async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {method,credentials:'same-origin',headers:{'X-AndThen-Web':'1',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
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
