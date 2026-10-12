import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actionFields, actionPayload } from '../src/autosaveFields.ts'

import { checkedActionData } from '../src/actionOwners.ts'

test('action owner IDs use local string fields and sparse integer/null payloads without old text', () => {
  const fields=actionFields({owner_user_id:7,result:'Result',status:'',date:null})
  assert.equal(fields.owner_user_id,'7'); assert.equal('owner' in fields,false)
  assert.deepEqual(actionPayload({owner_user_id:'8'}),{owner_user_id:8})
  assert.deepEqual(actionPayload({owner_user_id:null}),{owner_user_id:null})
  assert.deepEqual(actionPayload({result:'Changed'}),{result:'Changed'})
})

test('both action responses reject missing or inconsistent owner metadata before replacing cached choices', () => {
  for (const prefix of ['ecr','eco']) {
    const data={updated_at:'2026-10-12T00:00:00Z',actions:Array.from({length:61},(_,i)=>({id:`${prefix}_${String(i+1).padStart(3,'0')}`,number:1,function:'Test',text:'Action',question_answer:'',owner:'Old text',owner_user_id:null,owner_user:null,result:'',status:'',date:null}))}
    assert.equal(checkedActionData(data,prefix),data)
    for (const mutation of [row=>delete row.owner_user_id,row=>delete row.owner_user,row=>{row.owner_user_id=3;row.owner_user={id:4,username:'wrong',display_name:'Wrong',is_active:true}}]) {
      const invalid=structuredClone(data);mutation(invalid.actions[0]);assert.throws(()=>checkedActionData(invalid,prefix),/响应不完整/)
    }
    assert.throws(()=>checkedActionData({...data,actions:[]},prefix),/响应不完整/)
    const disabled=structuredClone(data);disabled.actions[0].owner_user_id=3;disabled.actions[0].owner_user={id:3,username:'old',display_name:'Old',is_active:false}
    assert.equal(checkedActionData(disabled,prefix),disabled)
  }
})

