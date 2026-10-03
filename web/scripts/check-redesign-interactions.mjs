// 手机交互回归，所有接口模拟且不允许业务写入。
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { auth, resolveBrowserFixture, configureBrowserFixture } from './redesign-fixtures.mjs'
const browser=await chromium.launch({headless:true,channel:'msedge'})
const context=await browser.newContext({viewport:{width:390,height:600},reducedMotion:'reduce'})
await context.addInitScript(auth=>{localStorage.setItem('auth-storage',JSON.stringify(auth));localStorage.setItem('last-seen-version','999.0.0');localStorage.setItem('sidebar-style-storage',JSON.stringify({state:{sidebarStyle:'dark'},version:0}))},auth)
await context.route('**/api/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(resolveBrowserFixture(route))}))
const page=await context.newPage(),output=new URL('../audit/redesign/',import.meta.url)
await mkdir(output,{recursive:true})
try{
 await page.goto('http://127.0.0.1:5177/transactions/aging')
 await page.getByRole('heading',{name:'账龄分析',exact:true}).waitFor()
 const obscured=await page.evaluate(()=>[...document.querySelectorAll('header button[aria-label]')].filter(button=>{
  const rect=button.getBoundingClientRect();if(!rect.width||!rect.height)return false
  const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)
  return rect.left<0||rect.right>innerWidth||!(hit===button||button.contains(hit))
 }).map(button=>button.getAttribute('aria-label')))
 assert.deepEqual(obscured,[],'手机顶栏每个操作必须可见且无互相遮挡')
 await page.getByRole('button',{name:'打开导航菜单'}).click();await page.getByRole('dialog').waitFor()
 await page.screenshot({path:new URL('390-navigation.png',output).pathname.replace(/^\/(\w:)/,'$1')})
 await page.getByRole('dialog').press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'})
 await page.getByRole('button',{name:'高级筛选',exact:true}).click()
 await page.getByLabel('仅显示小计',{exact:true}).check()
 await page.getByRole('button',{name:'高级筛选',exact:true}).click()
 assert.equal(await page.getByRole('button',{name:'清除筛选：仅显示小计',exact:true}).isVisible(),true)
 await page.getByRole('button',{name:'清除筛选：仅显示小计',exact:true}).click()
 assert.equal(await page.getByRole('button',{name:'高级筛选',exact:true}).evaluate(el=>el===document.activeElement),true)
 await page.getByRole('button',{name:'选择公司范围'}).click()
 await page.getByRole('textbox',{name:'搜索公司'}).waitFor()
 await page.screenshot({path:new URL('390-company-select.png',output).pathname.replace(/^\/(\w:)/,'$1')})
 await page.goto('http://127.0.0.1:5177/indicators/operating')
 await page.getByRole('button',{name:'视图设置',exact:true}).press('ArrowDown')
 await page.waitForTimeout(120)
 assert.match(await page.evaluate(()=>document.activeElement.getAttribute('role')||''),/^menuitem/)
 await page.locator('[role=menu]').press('End')
 assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('role')),'menuitemcheckbox')
 await page.locator('[role=menu]').press('Escape')
 assert.equal(await page.getByRole('button',{name:'视图设置',exact:true}).evaluate(el=>el===document.activeElement),true)
 console.log('通过：手机顶栏可见性、导航抽屉、高级筛选保持与清除、打开选择浮层、菜单方向键及焦点恢复')
}finally{await browser.close()}
