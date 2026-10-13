const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.setContent('<div id="cast-picker"></div>');
 await page.evaluate(()=>{
  window.$=selector=>document.querySelector(selector);window.state={filters:{}};
  window.esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  window.image=path=>'https://image.tmdb.org/t/p/w92'+path;
  window.tmdb=async()=>({results:[{id:1,name:'Less popular',known_for_department:'Acting',popularity:1},{id:2,name:'Popular actor',known_for_department:'Acting',popularity:50},{id:3,name:'Another actor',known_for_department:'Acting',popularity:20},{id:4,name:'Director',known_for_department:'Directing',popularity:100},{id:5,name:'Adult',known_for_department:'Acting',adult:true,popularity:100}]});
 });
 await page.addScriptTag({content:fs.readFileSync('cast-picker.js','utf8')});await page.evaluate(()=>bindCastPicker());
 for(const id of [2,3,1]) {
  await page.locator('#cast-search').fill('actor');await page.locator('[data-person]').first().waitFor();
  if(id===2){assert.equal(await page.locator('[data-person]').first().getAttribute('data-person'),'2');assert.equal(await page.locator('[data-person="4"]').count(),0);assert.equal(await page.locator('[data-person="5"]').count(),0);}
  await page.locator(`[data-person="${id}"]`).click();
 }
 assert.equal(await page.locator('.cast-chip').count(),3);assert.equal(await page.locator('#cast-search').isDisabled(),true);
 await page.locator('[data-remove-person="2"]').click();assert.equal(await page.locator('#cast-search').isDisabled(),false);
 await page.locator('#cast-match').selectOption('all');assert.equal(await page.locator('#cast-match').inputValue(),'all');
 await browser.close();console.log('PASS: popularity ordering, acting-only suggestions, three-person cap, removal, matching controls.');
})().catch(error=>{console.error(error);process.exit(1);});
