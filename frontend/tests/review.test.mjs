import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import { canEdit, actorUser } from '../src/workflow.ts'
import { checkedReview, actionConfirmed, reviewPath } from '../src/review.ts'
import { checkedSubmission, submissionConfirmed, recoverSubmissionFailure } from '../src/submission.ts'
import { ApiError } from '../src/api.ts'

const actor={id:3,username:'reviewer',display_name:'Reviewer',role:'reviewer'}
const round={number:1,title:'Submitted title',ecr_no:'ECR-1',eco_no:'ECO-1',review_mode:'public',state:'pending',submitted_at:'2026-10-05T01:00:00Z',approved_at:null,returned_at:null,returned_by:null,return_reason:'',reviewers:[],approvals:[]}
const data={change_id:1,updated_at:'2026-10-05T01:00:00Z',current_round:1,round,is_current:true,can_view_form:false,can_approve:true,can_return:true,can_feedback:true,form:null,history:[round],feedback:[]}
const change={id:1,applicant:2,current_review_round:1,title:'Revised',ecr_no:'ECR-1',eco_no:'ECO-1',affected_products:'',affected_region:'',initiating_factory:'',affected_factories:'',ccb_owner:'',change_owner:'',change_reason:'',planned_eco_date:null,status:'returned',review_mode:'public',submitted_at:'2026-10-05T01:00:00Z',created_at:'2026-10-05T00:00:00Z',updated_at:'2026-10-05T01:01:00Z'}

test('only the filler can edit draft or returned states; reviewer identity is not replaced with applicant',()=>{
 for(const state of ['draft','returned']){assert.equal(canEdit({status:state}),true);assert.equal(canEdit({status:state},'reviewer'),false)}
 for(const state of ['pending','approved'])assert.equal(canEdit({status:state}),false)
 const client=new QueryClient();client.setQueryData(['me'],actor);assert.equal(actorUser(client).id,3);assert.notEqual(actorUser(client).id,change.applicant);client.clear()
})
test('review response binds the viewed round and rejects missing permission flags or hidden forms',()=>{
 assert.equal(checkedReview(data,1,1),data)
 for(const invalid of [{}, {...data,change_id:2},{...data,round:{...round,number:2}},{...data,can_return:undefined},{...data,can_view_form:true},{...data,history:[] ,feedback:[{}]}])assert.throws(()=>checkedReview(invalid,1,1))
 assert.throws(()=>checkedReview({...data,can_view_form:true,form:{id:1,status:'pending'}},1,1))
 assert.throws(()=>checkedReview({...data,can_view_form:true,form:{...change,current_review_round:2}},1,1))
 assert.equal(reviewPath(1,2),'/api/changes/1/review-rounds/2/')
})
test('confirmation uses personal vote, returning actor and UUID instead of another person or text alone',()=>{
 const approved={...data,round:{...round,approvals:[{...actor,approved_at:'2026-10-05T01:01:00Z'}]}}
 assert.equal(actionConfirmed({kind:'approve'},approved,3),true);assert.equal(actionConfirmed({kind:'approve'},approved,4),false)
 const returned={...data,round:{...round,state:'returned',returned_by:actor,return_reason:'Reason'}}
 assert.equal(actionConfirmed({kind:'return',text:'Reason'},returned,3),true);assert.equal(actionConfirmed({kind:'return',text:'Other'},returned,3),false)
 const notes={...data,feedback:[{id:1,round_number:1,author:actor,request_id:'one',text:'Same',created_at:'2026-10-05T01:01:00Z'}]}
 assert.equal(actionConfirmed({kind:'feedback',request_id:'one'},notes,3),true);assert.equal(actionConfirmed({kind:'feedback',request_id:'two'},notes,3),false)
})
test('a successful submission already returned by an auditor still confirms the original request, not a new round',async()=>{
 const request_id='7353bd7d-7942-4db1-a816-e7b36cd0a0bd';const response={change,reviewers:[],request_id}
 const payload={review_mode:'public',reviewer_ids:[],expected_round:0,request_id}
 assert.equal(checkedSubmission(response,change,payload),response)
 assert.equal(submissionConfirmed(response,change,{...payload,request_id:'different'}),false)
 assert.equal(submissionConfirmed(response,change,{...payload,expected_round:1}),false)
 let cache=response
 const recovery=await recoverSubmissionFailure({failure:new ApiError(0,'lost'),payload,owner:change,previousUnknown:true,cached:()=>cache,accept:value=>(cache=value),read:async()=>response})
 assert.equal(recovery.unknown,null);assert.equal(recovery.error,null);assert.equal(canEdit(cache.change),true)
})
