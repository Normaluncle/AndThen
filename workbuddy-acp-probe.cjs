const {spawn}=require('node:child_process');
const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'workbuddy-probe-results','acp');fs.mkdirSync(root,{recursive:true});
const cli='C:/Users/Administrator/AppData/Local/Programs/WorkBuddyAI/resources/app.asar.unpacked/cli/bin/codebuddy';
const requestedContext=process.argv[2]||'both';
if(!['both','300000','1000000'].includes(requestedContext))throw Error('Context must be both, 300000 or 1000000');
const child=spawn(process.execPath,[cli,'--acp','--model','deepseek-v4.1-flash','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--system-prompt','Reply directly to text-only tests. Never call tools or access files.'],{cwd:root,windowsHide:true,env:{...process.env,CODEBUDDY_SKIP_GIT_BASH_CHECK:'1',ACC_PRODUCT_CONFIG_PATH:path.join(root,'product-resolved.json')}});
let seq=0,buffer='',stderr='';const pending=new Map(),events=[];
function call(method,params){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout '+method));},45000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
child.stderr.on('data',d=>stderr+=d.toString());
child.stdout.on('data',d=>{buffer+=d.toString();let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);let msg;try{msg=JSON.parse(line);}catch{continue;}events.push(msg);if(msg.id!==undefined&&pending.has(msg.id)){const p=pending.get(msg.id);pending.delete(msg.id);clearTimeout(p.timer);msg.error?p.reject(Error(JSON.stringify(msg.error))):p.resolve(msg.result);}else if(msg.id!==undefined&&msg.method){child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Client does not permit tool requests'}})+'\n');}}});
(async()=>{try{
 const init=await call('initialize',{protocolVersion:1,clientCapabilities:{},clientInfo:{name:'codex-connectivity-probe',version:'1'}});console.log(JSON.stringify({step:'initialize',result:init}));
 const session=await call('session/new',{cwd:root,mcpServers:[]});console.log(JSON.stringify({step:'new',result:session}));
 await call('session/prompt',{sessionId:session.sessionId,prompt:[{type:'text',text:'Reply only WB_ACP_READY. Do not use tools.'}]});
 const refreshed=await call('session/set_config_option',{sessionId:session.sessionId,configId:'model',value:'deepseek-v4.1-flash'});console.log(JSON.stringify({step:'model_refresh',result:refreshed}));
 const context=refreshed.configOptions?.find(o=>o.id==='context_window')||session.configOptions?.find(o=>o.id==='context_window');
 if(context){for(const option of context.options.filter(o=>requestedContext==='both'||o.value===requestedContext)){const changed=await call('session/set_config_option',{sessionId:session.sessionId,configId:'context_window',value:option.value});console.log(JSON.stringify({step:'set_context',requested:option.value,result:changed}));const reply=await call('session/prompt',{sessionId:session.sessionId,prompt:[{type:'text',text:'Text-only connectivity test. Reply only WB_CONTEXT_OK. Do not use tools.'}]});console.log(JSON.stringify({step:'prompt',context:option.value,result:reply}));}}
 else throw Error('NO_CONTEXT_OPTION');
}catch(e){console.log(JSON.stringify({error:e.message,stderr:stderr.slice(-1500)}));process.exitCode=1;}finally{fs.writeFileSync(path.join(root,'events.json'),JSON.stringify(events,null,2));fs.writeFileSync(path.join(root,'stderr.txt'),stderr);child.kill();}})();
