// node scripts/install-cover-images.mjs <directory containing CF001.jpg ... CF150.webp>
// Produces a reviewed SQL activation file; never guesses a database connection.
import {readFile,readdir,copyFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const input=process.argv[2];if(!input)throw new Error('Provide the directory containing the actual CF001-CF150 image files.');
const manifest=path.join(root,'assets/cover-library-150/catalog.json');const rows=JSON.parse(await readFile(manifest,'utf8'));
const destination=path.join(root,'demo/public/covers');await mkdir(destination,{recursive:true});const sql=[];let installed=0;
for(const filename of await readdir(path.resolve(input))){const match=/^(CF\d{3})\.(jpg|jpeg|png|webp)$/i.exec(filename);if(!match)continue;const row=rows.find(row=>row.id===match[1].toUpperCase());if(!row)continue;
 const bytes=await readFile(path.join(path.resolve(input),filename));const ext=match[2].toLowerCase();const valid=ext==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):ext==='webp'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':bytes[0]===255&&bytes[1]===216;
 if(!valid)throw new Error(`Invalid image signature: ${filename}`);
 const output=`${row.id}.${ext}`;const target=path.join(destination,output);if(path.resolve(input,filename)!==target)await copyFile(path.resolve(input,filename),target);
 row.image_url='/covers/'+output;row.status='ready';sql.push(`UPDATE cover_catalog SET image_url='${row.image_url}',status='ready' WHERE id='${row.id}';`);installed++;
}
await writeFile(manifest,JSON.stringify(rows,null,2));await writeFile(path.join(destination,'catalog.json'),JSON.stringify(rows));await writeFile(path.join(root,'assets/cover-library-150/activate-images.sql'),'BEGIN;\n'+sql.join('\n')+'\nCOMMIT;\n');
console.log(JSON.stringify({installed,pending:rows.filter(row=>!row.image_url).length,activation:'assets/cover-library-150/activate-images.sql'}));
