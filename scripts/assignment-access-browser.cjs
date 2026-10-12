const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const folder = '.local/dual-workspace-20261012';
const fixture = JSON.parse(fs.readFileSync(folder+'/fixture.json','utf8'));
(async () => {
  const browser = await chromium.launch({channel:'msedge',headless:true});
  const contexts = [];
  async function login(account) {
    const context = await browser.newContext({baseURL:process.env.DUAL_BASE_URL || 'http://localhost:5173'});
    contexts.push(context); const page = await context.newPage();
    await page.goto('/');
    await page.getByLabel('用户名',{exact:true}).fill(account.username);
    await page.getByLabel('密码',{exact:true}).fill(account.password);
    const inbox = page.waitForResponse(response=>new URL(response.url()).pathname==='/api/review/inbox/');
    await page.getByRole('button',{name:/登\s*录/}).click();
    await page.getByRole('heading',{name:/欢迎回来/}).waitFor();
    if ((await (await inbox).json()).unread_count>0) await page.getByRole('button',{name:'稍后处理',exact:true}).click();
    await page.locator('.ant-modal:visible').waitFor({state:'hidden'});
    assert.equal(await page.locator('.workspace-card').count(),2);
    return page;
  }
  try {
    const a = await login(fixture.accounts[0]);
    await a.locator('.workspace-card').filter({hasText:'我的申请'}).click();
    await a.getByRole('button',{name:'普通账号指定审核（临时）',exact:true}).click();
    await a.getByRole('tab',{name:'提交审核',exact:true}).click();
    assert.equal(await a.getByRole('radio',{name:'公开审核',exact:true}).count(),0);
    await a.getByLabel('指定审核员',{exact:true}).click();
    await a.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({hasText:fixture.accounts[1].username}).click();
    await a.getByRole('heading',{name:/提交审核/}).click();
    await a.getByRole('button',{name:'提交申请',exact:true}).click();
    await a.getByRole('button',{name:'确认提交并锁定',exact:true}).click();
    await a.getByText('申请已锁定，等待本轮审核；可从悬浮入口查看审核意见和过程。',{exact:true}).waitFor();
    const b = await login(fixture.accounts[1]);
    await b.locator('.workspace-card').filter({hasText:'待我处理'}).click();
    assert.equal(await b.getByRole('tab',{name:'公开审核',exact:true}).count(),0);
    await b.getByRole('button',{name:'查看申请',exact:true}).click();
    await b.getByRole('button',{name:'本人同意批准',exact:true}).click();
    await b.getByRole('button',{name:'确认批准',exact:true}).click();
    await b.getByText('整份申请审核已通过。',{exact:true}).waitFor();
    await a.getByRole('button',{name:'工作台首页',exact:true}).click();
    await a.locator('.workspace-card').filter({hasText:'我的申请'}).click();
    await a.getByRole('row').filter({hasText:'普通账号指定审核（临时）'}).getByText('已批准',{exact:true}).waitFor();
    const result = {ordinary_account_assignment_flow:'passed',new_public_controls_absent:true};
    fs.writeFileSync(folder+'/assignment-browser-verification.json',JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
  } finally {for(const context of contexts) await context.close(); await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
