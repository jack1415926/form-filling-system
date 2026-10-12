const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const folder='.local/dual-workspace-20261012';
const fixture=JSON.parse(fs.readFileSync(folder+'/fixture.json','utf8'));
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const context=await browser.newContext({baseURL:process.env.DUAL_BASE_URL || 'http://localhost:5173'});
    const page=await context.newPage(), errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/');
    await page.getByLabel('用户名',{exact:true}).fill(fixture.accounts[0].username);
    await page.getByLabel('密码',{exact:true}).fill(fixture.accounts[0].password);
    await page.getByRole('button',{name:/登\s*录/}).click();
    await page.getByRole('heading',{name:/欢迎回来/}).waitFor();
    async function openRequest() {
      await page.locator('.workspace-card').filter({hasText:'我的申请'}).click();
      await page.getByRole('button',{name:'行动负责人关联（临时）',exact:true}).click();
    }
    async function openAction(prefix) {
      await page.getByRole('tab',{name:prefix==='ecr'?'ECR 评估':'ECO 执行',exact:true}).click();
      await page.getByLabel('行动筛选',{exact:true}).click();
      await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({hasText:'全部行动'}).click();
      await page.getByRole('button',{name:'编辑',exact:true}).first().click();
      await page.locator('.ant-drawer-open').getByLabel('负责人用户',{exact:true}).waitFor();
    }
    await openRequest();
    for(const [prefix,index,saveName] of [['ecr',1,'保存评估'],['eco',0,'保存行动']]) {
      await openAction(prefix);
      const drawer=page.locator('.ant-drawer-open');
      await drawer.getByText(prefix==='ecr'?'历史ECR负责人':'历史ECO负责人',{exact:true}).waitFor();
      await drawer.getByLabel('负责人用户',{exact:true}).click();
      await drawer.getByLabel('负责人用户',{exact:true}).fill(fixture.accounts[index].username);
      await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({hasText:fixture.accounts[index].username}).click();
      await drawer.getByRole('button',{name:saveName,exact:true}).click();
      await drawer.waitFor({state:'hidden'});
    }
    await page.reload(); await page.getByRole('heading',{name:/欢迎回来/}).waitFor(); await openRequest();
    for(const [prefix,index] of [['ecr',1],['eco',0]]) {
      await openAction(prefix);
      const drawer=page.locator('.ant-drawer-open');
      await drawer.getByText(`${fixture.accounts[index].username}（${fixture.accounts[index].username}）`,{exact:true}).waitFor();
      const record=await (await context.request.get(`/api/changes/${fixture.records['行动负责人关联（临时）']}/${prefix}-actions/`)).json();
      assert.equal(record.actions[0].owner_user_id,fixture.accounts[index].id);
      assert.equal(record.actions[0].owner,prefix==='ecr'?'历史ECR负责人':'历史ECO负责人');
      await drawer.locator('.ant-drawer-close').click();
    }
    assert.deepEqual(errors,[]);
    const result={action_owner_save_reopen:'passed',self_selection:true,old_text_preserved:true,errors};
    fs.writeFileSync(folder+'/action-owners-browser-verification.json',JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
