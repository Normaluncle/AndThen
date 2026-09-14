// Pending candidates also have a source ID, but the public story projection is
// unavailable until authorization. Keep their official-summary card instead.
export function followingItems(stories,candidates){
 return {
  stories:stories.filter(story=>story.available!==false||!candidates.some(candidate=>candidate.linked_source_id===story.source_id)),
  candidates:candidates.filter(candidate=>!stories.some(story=>story.source_id===candidate.linked_source_id&&story.available!==false)),
 };
}
