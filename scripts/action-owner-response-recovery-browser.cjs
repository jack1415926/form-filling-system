// All APIs are isolated mocks; this probe never creates real users or records.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const folder='.local/comprehensive-review-20261012';fs.mkdirSync(folder,{recursive:true});
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const context=await browser.newContext();const page=await context.newPage();
    const user={id:101,username:'mock-owner',display_name:'模拟用户',role:'filler',can_review:true,can_manage_feedback:false};
    const record={id:201,applicant:101,title:'响应恢复模拟',ecr_no:'MOCK',eco_no:'',affected_products:'',affected_region:'',initiating_factory:'',affected_factories:'',ccb_owner:'',change_owner:'',planned_eco_date:null,change_reason:'',status:'draft',review_mode:'',submitted_at:null,current_review_round:0,created_at:'2026-10-12T00:00:00Z',updated_at:'2026-10-12T00:00:00Z'};
    const people=[{id:7,username:'old-owner',display_name:'原负责人'},{id:8,username:'new-owner',display_name:'新负责人'}];
    const data={updated_at:record.updated_at,actions:Array.from({length:61},(_,i)=>({id:'ecr_'+String(i+1).padStart(3,'0'),number:1,function:'评估',text:'行动'+(i+1),question_answer:'Y',owner:'',owner_user_id:i===0?7:null,owner_user:i===0?{...people[0],is_active:true}:null,result:'',status:'',date:null}))};
    let wrote=null;
    await page.route('**/api/**',async route=>{
      const path=new URL(route.request().url()).pathname;let json;
      if(path==='/api/auth/me/')json=user;
      else if(path==='/api/changes/')json=[record];
      else if(path==='/api/changes/201/')json=record;
      else if(path==='/api/auth/csrf/')json={csrfToken:'mock-token'};
      else if(path==='/api/action-owners/')json=people;
      else if(path==='/api/review/inbox/')json={actor_id:101,role:'filler',count:0,unread_count:0,items:[]};
      else if(path==='/api/system-feedback/inbox/')json={unread_count:0,items:[]};
      else if(path==='/api/changes/201/ecr-actions/')json=data;
      else if(path==='/api/changes/201/ecr-actions/ecr_001/'){
        wrote=route.request().postDataJSON().owner_user_id;
        const malformed=structuredClone(data);malformed.updated_at='2026-10-12T00:00:01Z';
        delete malformed.actions[0].owner_user_id;delete malformed.actions[0].owner_user;
        json=malformed;
      }else json=[];
      await route.fulfill({json});
    });
    await page.goto(process.env.DUAL_BASE_URL || 'http://localhost:5173');
    await page.locator('.workspace-card').filter({hasText:'我的申请'}).click();
    await page.getByRole('button',{name:'响应恢复模拟',exact:true}).click();
    await page.getByRole('tab',{name:'ECR 评估',exact:true}).click();
    await page.getByRole('button',{name:'编辑',exact:true}).first().click();
    let drawer=page.locator('.ant-drawer-open');
    await drawer.getByLabel('负责人用户',{exact:true}).click();
    await drawer.getByLabel('负责人用户',{exact:true}).fill('new-owner');
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({hasText:'new-owner'}).click();
    await drawer.getByRole('button',{name:'保存评估',exact:true}).click();
    if(process.env.OWNER_RESPONSE_EXPECT_BUG==='1'){
      await drawer.waitFor({state:'hidden'});
      const result={server_received_owner:wrote,ui_first_row:await page.getByRole('row').filter({hasText:'行动1'}).first().innerText(),silent_unlink:true};
      assert.equal(wrote,8);assert.match(result.ui_first_row,/尚未关联用户/);
      fs.writeFileSync(folder+'/owner-response-before.json',JSON.stringify(result,null,2));console.log(JSON.stringify({bug_reproduced:true}));
    }else{
      await drawer.getByText('保存失败，填写内容仍保留',{exact:true}).waitFor();
      await drawer.getByText('新负责人（new-owner）',{exact:true}).waitFor();
      assert.equal(wrote,8);
      const result={input_preserved:true,malformed_success_rejected:true,cache_preserved:true};
      fs.writeFileSync(folder+'/owner-response-after.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
