// Uses only IDs obtained from authenticated API responses. No client roles.
export async function startOwnInterview(request,item,confirmation){
 if(!confirmation.ownsContent||!confirmation.privateInterview||!confirmation.modelProcessing)throw new Error('请先确认原回答归属与两项处理同意。');
 for(const purpose of ['private_interview','external_model_processing'])await request(`/sources/${item.source_id}/consents`,'POST',{purpose,version:'v1'});
 await request(`/cases/${item.id}/decision`,'POST',{decision:'accept'});
 return request(`/cases/${item.id}/interviews`,'POST',{mode:'ai',confirms_own_content:true,confirms_old_state:true});
}
export async function publishOwnDraft(request,draft,confirmed){
 if(!confirmed)throw new Error('请确认公开展示当前版本。');
 const workbench=await request('/me/workbench');
 const ownCase=workbench.items.find(item=>item.id===draft.caseId);
 if(!ownCase)throw new Error('无法核对原回答，请返回我的回答刷新。');
 await request(`/sources/${ownCase.source_id}/consents`,'POST',{purpose:'demo_public_display',version:'v1'});
 await request(`/drafts/${draft.id}/publish`,'POST',{content_hash:draft.contentHash,confirms_publication:true});
 return request('/drafts/'+draft.id);
}
export function notificationTarget(item){
 if(item.status==='withdrawn')throw new Error('作者已撤回这条更新。');
 if(!item.followupVersionId)throw new Error('这条通知没有可读取的更新。');
 return {followup:item.followupVersionId};
}
