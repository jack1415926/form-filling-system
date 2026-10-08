import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import { checkedSubmission, checkedReviewers, newestSubmission, recoverSubmissionFailure, submissionConfirmed, submissionError } from '../src/submission.ts'
import { ApiError } from '../src/api.ts'

const reviewers=[{id:2,username:'reviewer1',display_name:'One'},{id:3,username:'reviewer2',display_name:'Two'}]
const change={id:1,applicant:4,current_review_round:0,title:'Submit',ecr_no:'SUB-001',eco_no:'',affected_products:'',affected_region:'',initiating_factory:'',affected_factories:'',ccb_owner:'',change_owner:'',planned_eco_date:null,change_reason:'',status:'draft',review_mode:'',submitted_at:null,created_at:'2026-10-04T01:00:00Z',updated_at:'2026-10-04T01:00:00.123456Z'}
const draft={change,reviewers:[],review_arrangement_locked:false,issue_blockers:[]}
const submitted=(mode='designated')=>({change:{...change,status:'pending',review_mode:mode,submitted_at:'2026-10-04T01:01:00Z',updated_at:'2026-10-04T01:01:00.123456Z'},reviewers:mode==='designated'?reviewers:[],review_arrangement_locked:false,issue_blockers:[]})

test('returned designated/public submissions confirm their original round and arrangement and recover editing', async()=>{
 for(const mode of ['designated','public']) {
  const payload={review_mode:mode,reviewer_ids:mode==='designated'?[2,3]:[],expected_round:0,request_id:'e36fb1a7-2314-44a6-9b19-a34e733292aa'}
  const returned={...submitted(mode),request_id:payload.request_id,change:{...submitted(mode).change,status:'returned',current_review_round:1}}
  assert.equal(submissionConfirmed(returned,change,payload),true)
  const otherMode=mode==='public'?'designated':'public'
  for(const invalid of [draft,{...returned,request_id:'different-request'},{...returned,change:{...returned.change,current_review_round:2}},{...returned,reviewers:[reviewers[0]]},{...returned,change:{...returned.change,review_mode:otherMode},reviewers:otherMode==='public'?[]:reviewers}]) {
   assert.equal(submissionConfirmed(invalid,change,payload),false)
  }
  assert.equal(submissionConfirmed(newestSubmission(returned,draft),change,payload),true)
  let cache=returned
  const recovery=await recoverSubmissionFailure({failure:new ApiError(0,'lost'),payload,owner:change,previousUnknown:true,cached:()=>cache,accept:value=>(cache=value),read:async()=>{throw new Error('Confirmed cache must not need another read')}})
  assert.equal(recovery.unknown,null);assert.equal(recovery.error,null);assert.equal(cache.change.status,'returned')
 }
})

test('unsent opinion responses block submission even after all persisted opinions have been answered',()=>{
 const returned={...change,status:'returned',review_mode:'designated',current_review_round:1}
 assert.match(submissionError(returned,'designated',[2],reviewers,true),/未发送.*审核回应/)
 assert.equal(submissionError(returned,'designated',[2],reviewers,false),null)
})

test('reviewer lists validate identity, types and uniqueness without exposing extra account requirements',()=>{
 assert.deepEqual(checkedReviewers(reviewers),reviewers)
 for(const value of [{},null,[{}],[reviewers[0],reviewers[0]],[{...reviewers[0],id:-1}],[{...reviewers[0],username:null}]])assert.throws(()=>checkedReviewers(value))
})
test('submission eligibility requires title/ECR and follows each mode minimum',()=>{
 assert.match(submissionError({...change,title:' '},'public',[],reviewers),/标题/)
 assert.match(submissionError({...change,ecr_no:''},'designated',[2],reviewers),/ECR/)
 assert.match(submissionError(change,'',[],reviewers),/方式/)
 assert.match(submissionError(change,'designated',[],reviewers),/至少/)
 assert.match(submissionError(change,'designated',[2,2],reviewers),/失效/)
 assert.match(submissionError(change,'designated',[5],reviewers),/失效/)
 assert.equal(submissionError(change,'public',[],reviewers.slice(0,1)),'系统中的有效审核员不足两人，请联系账号维护人员设置审核员身份。')
 assert.equal(submissionError(change,'designated',[2],reviewers),null)
 assert.equal(submissionError(change,'public',[],reviewers),null)
})
test('cold GET accepts valid blank/legacy records and rejects missing metadata or mismatched owners',()=>{
 assert.equal(checkedSubmission(draft,change),draft)
 const legacy={...draft,change:{...change,status:'pending'}};assert.equal(checkedSubmission(legacy,change),legacy)
 for(const invalid of [{},[],{...draft,change:{...change,id:9}},{...draft,change:{...change,applicant:9}},{...draft,change:{...change,review_mode:undefined}},{...draft,change:{...change,submitted_at:undefined}},{...draft,change:{...change,updated_at:'invalid'}},{...draft,change:{...change,change_reason:null}},{...draft,reviewers:null}])assert.throws(()=>checkedSubmission(invalid,change))
})
test('POST confirmation requires a locked state with the same mode and exact unique assigned people',()=>{
 const payload={review_mode:'designated',reviewer_ids:[3,2]}
 assert.equal(checkedSubmission(submitted(),change,payload).change.status,'pending')
 for(const data of [draft,submitted('public'),{...submitted(),reviewers:[reviewers[0]]},{...submitted(),reviewers:[reviewers[0],reviewers[0]]},{...submitted(),change:{...submitted().change,submitted_at:null}}])assert.throws(()=>checkedSubmission(data,change,payload))
 assert.equal(checkedSubmission(submitted('public'),change,{review_mode:'public',reviewer_ids:[]}).change.review_mode,'public')
})
test('delayed reads retain the newer submission and microsecond timestamps protect lock metadata',()=>{
 const complete=submitted();assert.equal(newestSubmission(complete,draft),complete)
 const old={...complete,change:{...complete.change,updated_at:'2026-10-04T01:01:00.123455Z'}}
 assert.equal(newestSubmission(complete,old),complete)
 assert.equal(newestSubmission(undefined,complete),complete)
})
test('a malformed cold query never poisons the submission cache and normal retry recovers',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});const queryKey=['submission',4,1]
 let incoming={};const read=()=>client.fetchQuery({queryKey,queryFn:async()=>checkedSubmission(incoming,change)})
 try{
  await assert.rejects(read());assert.equal(client.getQueryData(queryKey),undefined)
  incoming=submitted();await read();assert.equal(client.getQueryData(queryKey).change.status,'pending')
 }finally{client.clear()}
})

test('unknown submission followed by a definite rejection restores editing after a confirmed draft read',async()=>{
 let cache=draft;const payload={review_mode:'public',reviewer_ids:[]}
 const options={payload,owner:change,cached:()=>cache,accept:data=>(cache=data),read:async()=>draft}
 const first=await recoverSubmissionFailure({...options,failure:new ApiError(503,'unconfirmed'),previousUnknown:false})
 assert.equal(first.unknown,payload)
 const retry=await recoverSubmissionFailure({...options,failure:new ApiError(400,'reviewer capacity'),previousUnknown:true})
 assert.deepEqual(retry,{unknown:null,error:'reviewer capacity',refreshReviewers:true})
 assert.deepEqual(payload,{review_mode:'public',reviewer_ids:[]});assert.equal(cache.change.status,'draft')
})

test('a late POST error cannot restore unknown state after a trusted GET confirmed submission',async()=>{
 let cache=submitted('public'),reads=0;const payload={review_mode:'public',reviewer_ids:[]}
 const result=await recoverSubmissionFailure({failure:new ApiError(0,'late transport error'),payload,previousUnknown:false,owner:change,cached:()=>cache,accept:data=>(cache=data),read:async()=>{reads++;return draft}})
 assert.deepEqual(result,{unknown:null,error:null,refreshReviewers:false});assert.equal(reads,0);assert.equal(cache.change.status,'pending')
})

test('a confirmed submission arriving during recovery wins over an older draft read',async()=>{
 let cache=draft,resolveRead;const payload={review_mode:'public',reviewer_ids:[]}
 const result=recoverSubmissionFailure({failure:new ApiError(400,'rejected'),payload,previousUnknown:true,owner:change,cached:()=>cache,accept:data=>(cache=data),read:()=>new Promise(resolve=>{resolveRead=resolve})})
 cache=submitted('public');resolveRead(draft)
 assert.deepEqual(await result,{unknown:null,error:null,refreshReviewers:false});assert.equal(cache.change.status,'pending')
})

test('failed or malformed reconciliation keeps an earlier unknown request protected',async()=>{
 const payload={review_mode:'public',reviewer_ids:[]}
 for(const read of [async()=>{throw new ApiError(0,'read failed')},async()=>({change:{status:'draft'}})]){
  let cache=draft
  const result=await recoverSubmissionFailure({failure:new ApiError(400,'rejected'),payload,previousUnknown:true,owner:change,cached:()=>cache,accept:data=>(cache=data),read})
  assert.equal(result.unknown,payload);assert.equal(result.refreshReviewers,false);assert.match(result.error,/核对失败/);assert.equal(cache,draft)
 }
})

test('a different confirmed submission releases navigation and reports the actual locked intent',async()=>{
 let cache=submitted();const payload={review_mode:'public',reviewer_ids:[]}
 const result=await recoverSubmissionFailure({failure:new ApiError(0,'late failure'),payload,previousUnknown:true,owner:change,cached:()=>cache,accept:data=>(cache=data),read:async()=>draft})
 assert.equal(result.unknown,null);assert.match(result.error,/原请求不同/);assert.equal(result.refreshReviewers,false);assert.equal(cache.change.review_mode,'designated')
})

test('missing or malformed opinion submission restrictions reject the entire response',()=>{
 for(const invalid of [{...draft,review_arrangement_locked:undefined},{...draft,issue_blockers:undefined},{...draft,issue_blockers:[1]}])assert.throws(()=>checkedSubmission(invalid,change))
 const returned={...submitted(),change:{...submitted().change,status:'returned'},review_arrangement_locked:true,issue_blockers:['Respond to all issues']}
 assert.equal(checkedSubmission(returned,change).review_arrangement_locked,true)
})
