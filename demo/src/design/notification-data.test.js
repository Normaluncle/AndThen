import test from 'node:test';
import assert from 'node:assert/strict';
import {groupNotifications,unreadNotificationCount} from './notification-data.js';
test('mobile reference retains the study notification in this week',()=>{const g=groupNotifications('全部',[],true);assert.deepEqual(g.map(a=>a.map(n=>n[0])),[['n1','n2'],['n3','n4']]);});
test('desktop reference keeps three today and two this week',()=>{assert.deepEqual(groupNotifications('全部',[]).map(g=>g.map(n=>n[0])),[['n1','n2','n3'],['n4','n5']]);});
test('unread badge and filtered rows use the same initial unread set',()=>{assert.equal(unreadNotificationCount([]),3);assert.equal(groupNotifications('未读 (3)',[]).flat().length,3);assert.equal(unreadNotificationCount(['n4']),3);assert.equal(unreadNotificationCount(['n1']),2);assert.deepEqual(groupNotifications('已读',['n1']).flat().map(n=>n[0]),['n1','n4','n5']);});
