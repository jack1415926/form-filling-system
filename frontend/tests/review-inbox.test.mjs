import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkedInbox } from '../src/reviewInboxData.ts'

test('publication messages have a current-process destination regardless of applicant identity', () => {
  for (const stage of ['ecr', 'eco']) {
    const item = { context: 'publication', stage, change_id: 1, round: 2, title: 'Ready', ecr_no: 'ECR', eco_no: 'ECO', status: 'approved', count: 1, summary: 'Publish', open_issues: false, message_key: 'a'.repeat(64), is_read: false }
    const data = { actor_id: 3, count: 1, unread_count: 1, items: [item] }
    assert.equal(checkedInbox(data, { id: 3 }), data)
  }
})

test('unified accounts support mixed task contexts, independent read counts and strict response validation', () => {
  {
    const user={id:3}
    const common={round:1,title:'Request',ecr_no:'ECR',count:1,summary:'Task',open_issues:true,message_key:'a'.repeat(64)}
    const items=[{...common,change_id:1,context:'applicant',status:'returned',is_read:false},
      {...common,change_id:2,context:'reviewer',status:'pending',is_read:true}]
    const value={actor_id:3,count:2,unread_count:1,items}
    assert.equal(checkedInbox(value,user),value)
    assert.equal(checkedInbox({...value,count:0,unread_count:0,items:[]},user).count,0)
    assert.equal(checkedInbox({...value,unread_count:0,items:items.map(item=>({...item,is_read:true}))},user).count,2)
    for(const invalid of [null,{}, {...value,actor_id:4}, {...value,count:1},
      {...value,items:[{...items[0],context:undefined}]}, {...value,items:[{...items[0],context:'invalid'}]},
      {...value,items:[{...items[0],round:0}]}, {...value,items:[{...items[0],open_issues:undefined}]},
      {...value,items:[items[0],items[0]]},{...value,unread_count:0},
      {...value,items:[{...items[0],message_key:'old'}]}, {...value,items:[{...items[0],is_read:undefined}]}]) {
      assert.throws(()=>checkedInbox(invalid,user))
    }
  }
})
