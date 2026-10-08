import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import { canEdit, actorUser } from '../src/workflow.ts'
import { checkedReview, actionConfirmed, actionCanRetry, approvalProgress, approvalBlockReason, editReply, reviewPath } from '../src/review.ts'

const actor={id:3,username:'reviewer',display_name:'Reviewer',role:'reviewer'}
const round={number:1,title:'Submitted title',ecr_no:'ECR-1',eco_no:'ECO-1',review_mode:'public',state:'pending',submitted_at:'2026-10-05T01:00:00Z',approved_at:null,returned_at:null,returned_by:null,return_reason:'',reviewers:[],approvals:[]}
const data={change_id:1,updated_at:'2026-10-05T01:00:00Z',current_round:1,round,is_current:true,can_view_form:false,can_approve:true,can_return:true,can_feedback:true,form:null,history:[round],feedback:[],issues:[],unresolved_count:0,issue_blockers:[],confirmed_requests:[]}
const change={id:1,applicant:2,current_review_round:1,title:'Revised',ecr_no:'ECR-1',eco_no:'ECO-1',affected_products:'',affected_region:'',initiating_factory:'',affected_factories:'',ccb_owner:'',change_owner:'',change_reason:'',planned_eco_date:null,status:'returned',review_mode:'public',submitted_at:'2026-10-05T01:00:00Z',created_at:'2026-10-05T00:00:00Z',updated_at:'2026-10-05T01:01:00Z'}

test('first public submission permits approval without return; individual approval and issue resolution do not imply whole approval',()=>{
 assert.equal(approvalBlockReason(data,actor.id,0),null)
 assert.match(approvalProgress(round),/0\/2/)
 const one={...data,round:{...round,approvals:[{...actor,approved_at:round.submitted_at}]}}
 assert.match(approvalBlockReason(one,actor.id,0),/你已同意批准/)
 assert.equal(approvalBlockReason(one,4,0),null)
 assert.match(approvalProgress(one.round),/还需 1 名/)
 assert.match(approvalProgress({...one.round,state:'approved',approvals:[...one.round.approvals,{...actor,id:4,approved_at:round.submitted_at}]}),/2\/2.*整份申请审核已通过/)
 assert.match(approvalBlockReason({...data,can_approve:false,unresolved_count:1},actor.id,0),/未解决意见/)
 assert.equal(approvalBlockReason({...data,issues:[{state:'resolved'}]},actor.id,0),null)
 assert.match(approvalProgress({...round,state:'returned'}),/重新计算/)
 assert.match(approvalProgress({...round,review_mode:'designated',reviewers:[actor]}),/0\/1/)
})

test('disabled approval always explains draft, permission, old round or terminal state',()=>{
 assert.match(approvalBlockReason(data,actor.id,1),/未提交/)
 assert.match(approvalBlockReason({...data,can_approve:false},actor.id,0),/权限/)
 assert.match(approvalBlockReason({...data,is_current:false},actor.id,0),/历史轮次/)
 assert.match(approvalBlockReason({...data,round:{...round,state:'returned'}},actor.id,0),/重新提交/)
 assert.match(approvalBlockReason({...data,round:{...round,state:'approved'}},actor.id,0),/已批准/)
})

test('only the filler can edit draft or returned states; reviewer identity is not replaced with applicant',()=>{
 for(const state of ['draft','returned']){assert.equal(canEdit({status:state}),true);assert.equal(canEdit({status:state},'reviewer'),false)}
 for(const state of ['pending','approved'])assert.equal(canEdit({status:state}),false)
 const client=new QueryClient();client.setQueryData(['me'],actor);assert.equal(actorUser(client).id,3);assert.notEqual(actorUser(client).id,change.applicant);client.clear()
})

test('reply drafts retain their editing version through refresh and further typing; clearing allows a fresh baseline',()=>{
 const original=editReply(undefined,'Draft',2)
 const afterRefresh=editReply(original,'Still editing old draft',3)
 assert.equal(afterRefresh.version,2)
 assert.equal(afterRefresh.text,'Still editing old draft')
 const cleared=editReply(afterRefresh,'',3)
 assert.equal(editReply(cleared,'New draft after checking current record',3).version,3)
})

test('unknown approvals release recovery protection when the current round is terminal or permission is lost',()=>{
 const action={kind:'approve',request_id:'unknown'}
 assert.equal(actionCanRetry(action,data),true)
 for(const state of ['returned','approved'])assert.equal(actionCanRetry(action,{...data,round:{...round,state}}),false)
 assert.equal(actionCanRetry(action,{...data,can_approve:false}),false)
 assert.equal(actionCanRetry(action,{...data,is_current:false}),false)
})

test('unknown batch returns cannot be retried after terminal state or changes to an included opinion',()=>{
 const action={kind:'return',request_id:'unknown',issues:[{issue_id:1,version:2,text:'Still missing'}]}
 const available={...data,issues:[{id:1,version:2,can_reject:true}]}
 assert.equal(actionCanRetry(action,available),true)
 assert.equal(actionCanRetry(action,{...available,round:{...round,state:'returned'}}),false)
 assert.equal(actionCanRetry(action,{...available,issues:[{id:1,version:3,can_reject:true}]}),false)
 assert.equal(actionCanRetry(action,{...available,issues:[]}),false)
})

test('unknown responses and resolutions require the same issue version, allowed state and individual permission',()=>{
 const returned={...data,round:{...round,state:'returned'},issues:[{id:1,version:2,can_respond:true,can_resolve:false}]}
 const response={kind:'respond',request_id:'unknown',issue_id:1,version:2,text:'Reply'}
 assert.equal(actionCanRetry(response,returned),true)
 assert.equal(actionCanRetry({...response,version:1},returned),false)
 assert.equal(actionCanRetry(response,{...returned,round}),false)
 assert.equal(actionCanRetry(response,{...returned,issues:[]}),false)
 const pending={...data,issues:[{id:1,version:2,can_respond:false,can_resolve:true}]}
 const resolve={...response,kind:'resolve'}
 assert.equal(actionCanRetry(resolve,pending),true)
 assert.equal(actionCanRetry(resolve,{...pending,issues:[{id:1,version:2,can_resolve:false}]}),false)
 assert.equal(actionCanRetry(resolve,{...pending,round:{...round,state:'approved'}}),false)
})

test('an original receipt still confirms success even when the resulting state disallows replay',()=>{
 const action={kind:'return',request_id:'original',issues:[{tab:'overview',text:'Issue'}]}
 const returned={...data,round:{...round,state:'returned'},can_return:false,confirmed_requests:['original']}
 assert.equal(actionConfirmed(action,returned,actor.id),true)
 assert.equal(actionCanRetry(action,returned),false)
})
test('review response binds the viewed round and rejects missing permission flags or hidden forms',()=>{
 assert.equal(checkedReview(data,1,1),data)
 for(const invalid of [{}, {...data,change_id:2},{...data,round:{...round,number:2}},{...data,can_return:undefined},{...data,can_view_form:true},{...data,history:[] ,feedback:[{}]}])assert.throws(()=>checkedReview(invalid,1,1))
 assert.throws(()=>checkedReview({...data,can_view_form:true,form:{id:1,status:'pending'}},1,1))
 assert.throws(()=>checkedReview({...data,can_view_form:true,form:{...change,current_review_round:2}},1,1))
 assert.equal(reviewPath(1,2),'/api/changes/1/review-rounds/2/')
})
test('formal operation confirmation requires the original UUID, not text or another vote',()=>{
 const confirmed={...data,confirmed_requests:['one'],round:{...round,approvals:[{...actor,approved_at:'2026-10-05T01:01:00Z'}]}}
 for(const kind of ['return','respond','resolve']){
  assert.equal(actionConfirmed({kind,request_id:'one'},confirmed,3),true)
  assert.equal(actionConfirmed({kind,request_id:'other'},confirmed,3),false)
 }
 assert.equal(actionConfirmed({kind:'approve',request_id:'one'},confirmed,3),true)
 assert.equal(actionConfirmed({kind:'approve',request_id:'one'},confirmed,4),false)
 assert.equal(actionConfirmed({kind:'approve',request_id:'other'},confirmed,3),false)
})
test('issue response requires complete state, version, ownership permissions and event history',()=>{
 const issue={id:1,tab:'questions',location:'5',text:'Need explanation',source_round:1,author:actor,state:'awaiting_reply',version:1,can_respond:true,can_resolve:false,can_reject:false,events:[{kind:'return',text:'Need explanation',state:'awaiting_reply',version:1,round_number:1,author_id:3,request_id:'one',created_at:round.submitted_at}]}
 const value={...data,issues:[issue],unresolved_count:1}
 assert.equal(checkedReview(value,1,1),value)
 for(const bad of [{...issue,state:'done'},{...issue,version:0},{...issue,can_resolve:undefined},{...issue,events:[]},{...issue,tab:'unknown'}])assert.throws(()=>checkedReview({...value,issues:[bad]},1,1))
 for(const bad of [{...value,confirmed_requests:undefined},{...value,issue_blockers:[1]},{...value,unresolved_count:-1}])assert.throws(()=>checkedReview(bad,1,1))
})
