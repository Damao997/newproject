// 全站页面回归全部模拟接口，不访问业务数据库。
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { auth, resolveBrowserFixture, configureBrowserFixture } from './redesign-fixtures.mjs'
const base=process.env.REDESIGN_BASE_URL||'http://127.0.0.1:5177', output=new URL('../audit/redesign/',import.meta.url)
await mkdir(output,{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'}), findings=[], errors=[], requests=[]
const palettes=JSON.parse(await readFile(new URL('../src/lib/app-themes.json',import.meta.url),'utf8'))
const themes=Object.fromEntries(Object.entries(palettes).map(([key,palette])=>[key,palette.label]))
async function make(style='light',viewport={width:1440,height:900},scenario='success',loggedIn=true){
 const context=await browser.newContext({viewport,reducedMotion:'reduce'})
 configureBrowserFixture(context, { theme: style, revision: 1 })
 await context.addInitScript(({auth,style,loggedIn})=>{
  if(loggedIn)localStorage.setItem('auth-storage',JSON.stringify(auth))
  localStorage.setItem('sidebar-style-storage',JSON.stringify({state:{sidebarStyle:style},version:0}))
  localStorage.setItem('last-seen-version','999.0.0')
 },{auth,style,loggedIn})
 await context.route('**/api/v1/**',async route=>{
  if(scenario==='loading')await new Promise(done=>setTimeout(done,1200))
  const result=resolveBrowserFixture(route, scenario)
  if(result.code&&scenario==='success')requests.push(route.request().url())
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)})
 })
 return context
}
async function check(page,path,label,shot=false){
 const pageErrors=[],listener=e=>pageErrors.push(e.message);page.on('pageerror',listener)
 await page.goto(base+path);await page.locator('h1,input[aria-label="报告标题"],[data-route-error]').first().waitFor({timeout:10000}).catch(()=>{});await page.waitForTimeout(450)
 const state=await page.evaluate(()=>({heading:document.querySelector('h1')?.textContent,overflow:document.documentElement.scrollWidth-innerWidth,crash:document.body.textContent.includes('页面渲染出错'),invalid:/NaN|undefined/.test(document.querySelector('main')?.textContent||''),theme:document.documentElement.dataset.sidebar}))
 const entry={label,path,...state,pageErrors};findings.push(entry)
 if(state.overflow>2||state.crash||state.invalid||pageErrors.length)errors.push(entry)
 if(shot)await page.screenshot({path:new URL(label+'.png',output).pathname.replace(/^\/(\w:)/,'$1')})
 page.off('pageerror',listener)
}
try{
 const group=(prefix,names)=>names.map(p=>prefix+p)
 const paths=['/dashboard',...group('/dashboard/analysis/',['key-metrics','cash-flow','receivable-aging','inventory-aging','category-budget','subject-budget','expense','core-metrics']),...group('/indicators/',['operating','static','cashflow']),...group('/transactions/',['overview','aging','coverage','account-filter','collections/plans','collections/salesmen']),'/inventory','/reports','/reports/analyses','/reports/preview-report/edit','/reports/preview-report/read','/tools/enterprise-lookup','/data/browse','/data/import','/data/reclassify','/data/reclassify/consolidation',...group('/data/dimensions/',['operating','static','company','summary','formulas']),...group('/data/board/',['category','expense','subject','budget-ratio','product']),...group('/admin/',['users','roles','audit-logs']),'/no-access','/shared/preview']
 for(const style of Object.keys(themes)){
  const c=await make(style),p=await c.newPage()
  for(const path of style==='light'?paths:['/dashboard','/indicators/operating','/inventory','/reports/preview-report/edit','/admin/users'])await check(p,path,style+path.replaceAll('/','-'),['/dashboard','/indicators/operating','/reports/preview-report/edit'].includes(path))
  await c.close()
 }
 for(const size of [{width:1024,height:600},{width:800,height:450},{width:390,height:600}]){
  const c=await make('dark',size),p=await c.newPage()
  for(const path of ['/dashboard','/indicators/operating','/transactions/aging','/reports/preview-report/edit','/inventory','/admin/users'])await check(p,path,size.width+path.replaceAll('/','-'),true)
  await c.close()
 }
 const c=await make(),p=await c.newPage();await p.goto(base+'/indicators/operating')
 await p.getByRole('textbox',{name:'搜索科目'}).fill('燃气具')
 await p.getByRole('button',{name:'视图设置',exact:true}).click()
 await p.getByRole('menuitemradio',{name:'紧凑',exact:true}).click()
 await p.getByRole('menuitemradio',{name:'紧凑',exact:true}).press('Escape')
 assert.equal(await p.getByRole('button',{name:'视图设置',exact:true}).evaluate(el=>el===document.activeElement),true)
 await p.getByRole('button',{name:'用户菜单'}).click()
 await p.getByRole('menuitem',{name:'个人设置',exact:true}).waitFor()
 await p.getByRole('button',{name:'用户菜单'}).press('Escape')
 const remoteTheme = async key => {
  await p.evaluate(async key => {
    const headers={'Content-Type':'application/json'}
    const current=await (await fetch('/api/v1/auth/preferences',{headers})).json()
    await fetch('/api/v1/auth/preferences',{method:'PATCH',headers,body:JSON.stringify({revision:current.data.revision,changes:{theme:key}})})
    window.dispatchEvent(new Event('focus'))
  },key)
  await p.waitForFunction(key=>document.documentElement.dataset.sidebar===key,key)
 }
 for(const [key]of Object.entries(themes)){
  await remoteTheme(key)
  assert.equal(await p.getByRole('textbox',{name:'搜索科目'}).inputValue(),'燃气具')
  assert.equal(await p.locator('html').getAttribute('data-sidebar'),key)
 }
 await p.getByRole('button',{name:'清空科目搜索'}).click();assert.equal(await p.getByRole('textbox',{name:'搜索科目'}).inputValue(),'')
 await p.goto(base+'/reports/preview-report/edit');await p.locator('.tiptap').first().fill('主题切换后仍保留的模拟编辑内容')
 await remoteTheme('dark')
 assert.match(await p.locator('.tiptap').first().innerText(),/仍保留/);await c.close()
 for(const scenario of ['error','empty','loading']){const c=await make('dark',{width:390,height:600},scenario);await check(await c.newPage(),'/dashboard',scenario+'-dashboard',true);await c.close()}
 const lc=await make('dark',{width:390,height:600},'success',false);await check(await lc.newPage(),'/login','dark-login-mobile',true);await lc.close()
}finally{await writeFile(new URL('report.json',output),JSON.stringify({findings,errors,unmappedMockRequests:[...new Set(requests)]},null,2));await browser.close()}
console.log(JSON.stringify({checks:findings.length,errors,unmappedMockRequests:[...new Set(requests)]},null,2));assert.equal(errors.length,0,'存在溢出或运行错误，详见 audit/redesign/report.json')
