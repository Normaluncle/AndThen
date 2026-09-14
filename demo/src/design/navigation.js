import {searchOptions} from './search-model.js';
import {designScreen} from './logic.js';

export const personalTabs = [
  ['profile','home','我的主页'], ['answers','comment','我的回答'],
  ['saved','star','我的收藏'], ['following','heart','我的关注'],
  ['notifications','bell','消息通知'], ['history','clock','浏览历史'],
  ['settings','settings','设置与资料'],
];
export const developerScreens = ['10','13','14','15'];
export const canUseDeveloperPages = user => user?.role === 'admin';
const resourceKeyByScreen = {'02':'source','06':'interview','07':'draft','08':'followup','11':'case'};
export function routeFor(screen, options = {}) {
  if (screen === '05') return {screen:'09', tab:'answers'};
  if (screen === '03') return {screen:'09', tab:'following'};
  if (screen === '04') return {screen:'09', tab:'notifications'};
  if (screen === '09') return {screen, tab:personalTabs.some(([id]) => id === options.tab) ? options.tab : 'settings'};
  const resolved=designScreen(`screen=${screen}`);
  if(resolved==='01')return {screen:resolved,...searchOptions(options)};
  const resourceKey=resourceKeyByScreen[resolved];
  if(resourceKey&&options[resourceKey])return {screen:resolved,[resourceKey]:options[resourceKey]};
  return {screen:resolved,...(resourceKey&&options.story?{story:options.story}:{})};
}
export function readRoute(search) {
  const params = new URLSearchParams(search);
  return routeFor(designScreen(search), Object.fromEntries(['q','from','to','sort','page','tab','story','source','followup','case','interview','draft'].map(key=>[key,params.get(key)])));
}
export function routeUrl(route) {
  const params = new URLSearchParams({screen:route.screen});
  if (route.tab) params.set('tab',route.tab);
  for(const key of ['q','from','to','sort','page','story','source','followup','case','interview','draft']) if(route[key]) params.set(key,route[key]);
  return `/?${params}`;
}
export function mayOpenRoute(route,user) {return !developerScreens.includes(route.screen) || canUseDeveloperPages(user);}
export const workflowScreens = ['02','06','07','08','11'];
export function nextRoute(current, screen, options = {}) {
  return routeFor(screen, {...(workflowScreens.includes(current.screen) && workflowScreens.includes(screen) ? {story:current.story} : {}), ...options});
}
export function draftVersionRoute(current, draft) {
  return current.screen==='07' && draft?.id && draft.id!==current.draft
    ? routeFor('07',{draft:draft.id}) : null;
}
