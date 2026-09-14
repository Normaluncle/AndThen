import {readFileSync,writeFileSync} from 'node:fs';
const folder=new URL('../assets/cover-library-250/',import.meta.url);
const rows=JSON.parse(readFileSync(new URL('AndThen_250封面直链_大陆CDN.json',folder),'utf8'));
const mapping={'家庭亲情':'家庭生活','城市生活':'迁移生活','迁移旅行':'迁移生活','通用背景':'通用留白'};
const categories=new Set(['职场发展','人生选择','学习成长','情感关系','创业思考','家庭生活','健康恢复','自我反思','迁移生活','通用留白']);
const catalog=rows.map(row=>{
 const url=new URL(row['图片直链']),category=mapping[row['主类别']]||row['主类别'];
 if(!/^IMG\d{3}$/.test(row.ID)||url.protocol!=='https:'||url.hostname!=='img.cc0.cn'||url.username||url.password||!categories.has(category))throw new Error('Invalid catalogue entry '+row.ID);
 return {id:row.ID,category,tags:[...new Set([category,...row['复合标签'].split('/').map(t=>mapping[t.trim()]||t.trim()),...row['适用主题'].split('/')])],alt:row['适用主题']+'主题配图',source_url:row['图源分类页'],image_url:url.href,status:'ready'};
});
if(catalog.length!==250||new Set(catalog.map(r=>r.id)).size!==250)throw new Error('Expected 250 unique catalogue IDs');
writeFileSync(new URL('catalog.json',folder),JSON.stringify(catalog,null,2)+'\n');
writeFileSync(new URL('../demo/public/covers/catalog.json',import.meta.url),JSON.stringify(catalog,null,2)+'\n');
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
// Generate a reviewable seed artifact; never overwrite an applied migration.
const sql='INSERT INTO cover_catalog (id,category,tags,alt,source_url,image_url,status) VALUES\n'+catalog.map(r=>'('+[r.id,r.category,JSON.stringify(r.tags),r.alt,r.source_url,r.image_url,r.status].map(quote).join(',')+')').join(',\n')+'\nON CONFLICT (id) DO NOTHING;\n';
writeFileSync(new URL('seed-cdn-covers.sql',folder),sql);
console.log(JSON.stringify({entries:catalog.length,unique_urls:new Set(catalog.map(r=>r.image_url)).size,delivery:'browser_direct_cdn'}));
