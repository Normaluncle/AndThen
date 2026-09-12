// Layout only: never invent wording or drop an author's characters.
export function formatParagraphs(text=''){
 if(text.includes('\n'))return text;
 let paragraph='',parts=[];
 for(const chunk of text.match(/[^。！？.!?]+[。！？.!?]*|[。！？.!?]+/g)||[text]){
  paragraph+=chunk;
  if(paragraph.length>=90){parts.push(paragraph);paragraph='';}
 }
 if(paragraph)parts.push(paragraph);
 return parts.join('\n\n');
}
export function articleLength(statements=[]){return statements.filter(s=>s.visibility==='public').reduce((n,s)=>n+Array.from(s.text.replace(/\s/g,'')).length,0);}
