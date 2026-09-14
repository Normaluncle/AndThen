import catalog from '../public/covers/catalog.json';
// Reviewed catalogue URLs load directly from the CDN; no application-server image proxy.
export const coverPool=catalog.filter(item=>item.image_url).map(item=>({id:item.id,src:item.image_url,tags:item.tags,alt:item.alt}));
