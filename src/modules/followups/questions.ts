import type { Statement } from '../../ai/evidence.js';
type Message={id:string;role:string;question:string|null;authorMessage:string|null;sequence:number;visibility:string};
/** Freeze context into the author's reviewable draft; never read private chat at public-read time. */
export function attachInterviewQuestions(statements:Statement[],messages:Message[]):Statement[]{
 const questions=new Map<string,string>();let last:string|undefined;
 for(const m of [...messages].sort((a,b)=>a.sequence-b.sequence)){
  if(m.role==='ai')last=m.question??undefined;
  else if(m.role==='author'&&last)questions.set(`message:${m.id}`,last);
 }
 return statements.map(s=>{
  const matches=[...new Set(s.evidence_refs.map(ref=>questions.get(ref)).filter((q):q is string=>!!q))];
  // Multiple distinct answers in a synthesized paragraph have no single question.
  const {question:ignored,...rest}=s;
  return matches.length===1?{...rest,question:matches[0]}:rest;
 });
}
