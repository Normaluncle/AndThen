export const initialDesignState={provenance:'test_fixture',followed:false,authorFollowed:false,reason:0,read:[],draft:'',published:false,interview:1,answers:[],paused:false,consent:false,reminders:true};
export function designReducer(state,action){
 switch(action.type){
  case 'follow':return {...state,followed:true,reason:action.reason??0};
  case 'unfollow':return {...state,followed:false};
  case 'author-follow':return {...state,authorFollowed:!state.authorFollowed};
  case 'read':return {...state,read:[...new Set([...state.read,action.id])]};
  case 'draft':return {...state,draft:action.value};
  case 'answer':return state.paused||state.interview>=5?state:{...state,interview:state.interview+1,answers:[...state.answers,action.value]};
  case 'pause':return {...state,paused:!state.paused};
  case 'consent':return {...state,consent:action.value};
  case 'publish':return state.consent?{...state,published:true}:state;
  case 'withdraw':return {...state,published:false};
  case 'reminders':return {...state,reminders:!state.reminders};
  default:return state;
 }
}
