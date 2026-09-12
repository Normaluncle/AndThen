const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const cli='C:/Users/Administrator/AppData/Local/Programs/WorkBuddyAI/resources/app.asar.unpacked/cli/bin/codebuddy';
const root=path.join(__dirname,'workbuddy-probe-results');
fs.mkdirSync(root,{recursive:true});
const mode=process.argv[2]||'single';
async function run(id,prompt,options={}){
 const dir=path.join(root,options.workspace||id); fs.mkdirSync(dir,{recursive:true});
 const start=Date.now(); const events=[]; let stderr=''; let buffer=''; let timedOut=false;
 const args=[cli,'--print','--verbose','--output-format','stream-json','--model','deepseek-v4.1-flash','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--no-session-persistence','--max-turns','1','--system-prompt','You are a text-only connectivity test worker. Answer the supplied task directly. Do not call tools or access files.',prompt];
 if(options.persist) args.splice(args.indexOf('--no-session-persistence'),1);
 if(options.resume) args.splice(args.length-1,0,'--resume',options.resume);
 const child=spawn(process.execPath,args,{cwd:dir,windowsHide:true,env:{...process.env,CODEBUDDY_SKIP_GIT_BASH_CHECK:'1'}});
 console.log(JSON.stringify({event:'started',id,pid:child.pid,time:new Date(start).toISOString()}));
 const timer=setTimeout(()=>{timedOut=true;child.kill();},150000);
 child.stdout.on('data',data=>{buffer+=data.toString();let pos;while((pos=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,pos);buffer=buffer.slice(pos+1);try{const value=JSON.parse(line);events.push({elapsedMs:Date.now()-start,value}); if(['assistant','result'].includes(value.type))console.log(JSON.stringify({id,elapsedMs:Date.now()-start,event:value.type}));}catch{}}});
 child.stderr.on('data',d=>{stderr+=d.toString();});
 return await new Promise(resolve=>{child.on('error',e=>{stderr+=e.message;});child.on('close',(code,signal)=>{clearTimeout(timer);if(buffer.trim()){try{events.push({elapsedMs:Date.now()-start,value:JSON.parse(buffer)});}catch{}}
 const result={id,pid:child.pid,start:new Date(start).toISOString(),end:new Date().toISOString(),durationMs:Date.now()-start,code,signal,timedOut,events,stderr};
 fs.writeFileSync(path.join(dir,options.workspace?id+'-result.json':'result.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({id,code,timedOut,durationMs:result.durationMs,events:events.map(e=>({elapsedMs:e.elapsedMs,type:e.value.type,model:e.value.model||e.value.message?.model,subtype:e.value.subtype,result:e.value.result,content:e.value.message?.content,errors:e.value.errors})),stderr:stderr.slice(-2500)}));resolve(result);});});
}
module.exports={run,root};
if(require.main===module)(async()=>{const tasks=mode==='parallel'?[['parallel-a','Independent worker A. Return only WB_PARALLEL_A_OK and the exact value of 137*149.'],['parallel-b','Independent worker B. Return only WB_PARALLEL_B_OK and the exact sum of the squares of integers 1 through 20.']]:[['single','Return only WB_CLI_OK_20260912 and the value of 17*19.']];const results=await Promise.all(tasks.map(t=>run(...t)));const overlapMs=results.length>1?Math.max(0,Math.min(...results.map(r=>Date.parse(r.end)))-Math.max(...results.map(r=>Date.parse(r.start)))):0;fs.writeFileSync(path.join(root,mode+'-summary.json'),JSON.stringify({mode,overlapMs,runs:results.map(({events,stderr,...r})=>r)},null,2));console.log(JSON.stringify({mode,overlapMs,finished:true}));})();
