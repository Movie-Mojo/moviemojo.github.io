const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const page=await context.newPage(); const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/cdn.jsdelivr.net/**',route=>route.fulfill({body:''}));
 await page.route('**/functions/v1/movie-data',route=>route.fulfill({json:{results:[{id:27205,release_date:'2010-07-16',vote_average:8.4,vote_count:100,genres:[{id:28,name:'Action'}]},{id:157336,release_date:'2014-11-07',vote_average:9,vote_count:100,genres:[{id:878,name:'Science Fiction'}]}]}}));
 await page.addInitScript(()=>{
  const user={id:'11111111-1111-1111-1111-111111111111',email:'test@example.invalid'};
  const fixture=window.securityFixture={factors:[],aal:'aal1',passwordUpdates:0,signouts:0,reauthNeeded:false,groupReads:0,removed:[],bio:'',name:'Test movie fan'};
  const history=[{id:'history2',title:'Interstellar',tmdb_id:'157336',release_year:2014},{id:'history1',title:'Inception',tmdb_id:'27205',release_year:2010}];
  const ok=data=>({data,error:null});
  window.supabase={createClient:()=>({
   functions:{invoke:async(name,options)=>{const response=await fetch('https://fhynhdekctvstiolykgo.supabase.co/functions/v1/'+name,{method:'POST',body:JSON.stringify(options.body)});return ok(await response.json());}},
   auth:{onAuthStateChange:fn=>setTimeout(()=>fn('INITIAL_SESSION',{user}),0),signOut:async()=>{fixture.signouts++;return ok(null);},refreshSession:async()=>{fixture.aal=fixture.factors.some(f=>f.status==='verified')?'aal2':'aal1';return ok({});},
    updateUser:async values=>{if(values.current_password!=='correct-test-password')return {error:{message:'Current password is incorrect'}};if(fixture.reauthNeeded && !values.nonce) return {error:{code:"reauthentication_needed",message:"Reauthentication required"}};fixture.reauthNeeded=false;fixture.passwordUpdates++;fixture.usedCurrentPassword=!!values.current_password;return ok({user});},
    reauthenticate:async()=>ok(null),
    mfa:{getAuthenticatorAssuranceLevel:async()=>ok({currentLevel:fixture.aal,nextLevel:fixture.nextLevelOverride || (fixture.factors.some(f=>f.status==='verified')?'aal2':'aal1')}),listFactors:async()=>ok({totp:fixture.factors,phone:[]}),
     enroll:async()=>{fixture.factors.push({id:'test-factor',status:'unverified',friendly_name:'Test authenticator'});return ok({id:'test-factor',totp:{qr_code:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="white"/><text x="20" y="100">Synthetic test QR</text></svg>'),secret:'SYNTHETIC-TEST-ONLY'}});},
     challengeAndVerify:async({factorId,code})=>{if(code!=='123456')return {error:{message:'Invalid authentication code'}};fixture.factors.find(f=>f.id===factorId).status='verified';fixture.aal='aal2';return ok({});},
     unenroll:async({factorId})=>{fixture.factors=fixture.factors.filter(f=>f.id!==factorId);return ok({});}
    }
   },
   rpc:async(name,args)=>{
    if(name==='mojo_personal_list') return ok('personal');
    if(name==='get_user_groups_with_counts'){fixture.groupReads++;return ok([{group_id:'personal',group_name:'My personal list',created_by:user.id,member_count:1}]);}
    if(name==='mojo_group_contributors')return ok([]);
    if(name==='mojo_watched_profile'){
     if(args.action==='remove')fixture.removed.push(args.movie);
     if(args.action==='restore')fixture.removed=fixture.removed.filter(id=>id!==args.movie);
     return ok({name:fixture.name,movies:history.filter(m=>!fixture.removed.includes(m.id)),excluded:history.filter(m=>fixture.removed.includes(m.id))});
    }
    return ok(null);
   },
   from:table=>{const chain={select(){return chain;},eq(){return chain;},order(){return chain;},limit(){return chain;},update(values){fixture.bio=values.bio;fixture.name=values.display_name;return chain;},maybeSingle:async()=>ok({approved:true,display_name:fixture.name,bio:fixture.bio,streaming_services:[],streaming_region:'US'}),then:resolve=>Promise.resolve(ok(table==='user_profiles'?[{id:user.id}]:[])).then(resolve)};return chain;}
  })};
 });
 await page.goto('http://localhost:8765/#profile');
 await page.locator('#profile-history .movie-card').first().waitFor();
 assert.equal(await page.getByRole('button',{name:'Open settings',exact:true}).count(),1);
 assert.equal(await page.locator('#streaming-profile').count(),0);
 await page.locator('#profile-bio').fill('I love <science fiction> & adventure.');
 await page.locator('#display-name-form button').click();
 await page.waitForFunction(()=>securityFixture.bio==='I love <science fiction> & adventure.');
 await page.locator('#profile-options').click();await page.locator('#profile-sort').selectOption('name');await page.locator('#profile-history-options button').click();
 assert.equal(await page.locator('#profile-history h3').first().textContent(),'Inception');
 await page.locator('#profile-options').click();assert.equal(await page.locator('.movie-options-section').nth(1).getAttribute('open'),null);await page.locator('.movie-options-section summary').nth(1).click();await page.locator('#profile-genre').selectOption('28');await page.locator('#profile-history-options button').click();
 await page.waitForFunction(()=>document.querySelectorAll('#profile-history .movie-card').length===1);
 await page.locator('#profile-edit-history').click();await page.locator('[data-profile-remove]').click();
 await page.waitForFunction(()=>securityFixture.removed.includes('history1'));
 await page.locator('#profile-excluded summary').click();await page.locator('[data-profile-restore]').click();
 await page.waitForFunction(()=>securityFixture.removed.length===0);
 await page.screenshot({path:'/tmp/mojo-profile-settings-page.png',fullPage:true});
 await page.getByRole('button',{name:'Open settings',exact:true}).click();
 assert.equal(await page.locator('[data-settings]').count(),4);
 await page.locator("dialog").evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
 await page.screenshot({path:'/tmp/mojo-settings-menu.png'});
 await page.locator('[data-settings="security"]').click();
 assert.equal(await page.getByText('SMS',{exact:false}).count(),0);
 await page.locator('#current-password').fill('correct-test-password');await page.locator('#settings-new-password').fill('new-test-password');await page.locator('#confirm-password').fill('different-test-password');
 await page.locator('#change-password-form button').click();assert.equal(await page.evaluate(()=>securityFixture.passwordUpdates),0);
 await page.locator('#confirm-password').fill('new-test-password');await page.locator('#change-password-form button').click();
 await page.waitForFunction(()=>securityFixture.passwordUpdates===1);
 assert.equal(await page.evaluate(()=>securityFixture.signouts),0);
 assert(await page.evaluate(()=>securityFixture.usedCurrentPassword));
 await page.evaluate(()=>securityFixture.reauthNeeded=true);
 await page.locator('#current-password').fill('correct-test-password');await page.locator('#settings-new-password').fill('another-test-password');await page.locator('#confirm-password').fill('another-test-password');await page.locator('#change-password-form button').click();
 await page.locator('#password-nonce').waitFor();await page.locator('#password-nonce').fill('123456');await page.locator('#change-password-form button').click();await page.waitForFunction(()=>securityFixture.passwordUpdates===2);
 await page.locator('#enroll-authenticator').click();await page.locator('.mfa-qr').waitFor();await page.locator('#cancel-enrollment').click();
 await page.waitForFunction(()=>securityFixture.factors.length===0);
 assert.equal(await page.locator('.mfa-qr').count(),0,'cancel removes setup secret from DOM');
 await page.getByRole('button',{name:'Open settings',exact:true}).click();await page.locator('[data-settings="security"]').click();await page.locator('#enroll-authenticator').click();
 await page.locator('#enroll-mfa-code').fill('000000');await page.locator('#enroll-mfa-form button[type="submit"], #enroll-mfa-form button').first().click();
 await page.getByText('Invalid authentication code',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>securityFixture.factors[0].status),'unverified');
 await page.locator('#enroll-mfa-code').fill('123456');await page.locator('#enroll-mfa-form button').first().click();
 await page.locator('[data-remove-factor]').waitFor();assert.equal(await page.locator('.mfa-qr').count(),0);
 await page.locator('#close-modal').click();
 await page.evaluate(()=>{securityFixture.aal='aal1';securityFixture.nextLevelOverride='aal1';securityFixture.groupReads=0;initialize(state.user);});
 await page.locator('#mfa-login-code').waitFor();assert.equal(await page.evaluate(()=>securityFixture.groupReads),0,'must not fetch lists before 2FA');
 await page.evaluate(()=>go('watchlist'));assert.equal(await page.locator('#watch-sort').count(),0);
 await page.locator('#mfa-login-code').fill('000000');await page.locator('#mfa-login-form button').click();await page.getByText('Invalid authentication code',{exact:true}).waitFor();
 await page.locator('#mfa-login-code').fill('123456');await page.locator('#mfa-login-form button').click();await page.locator('#watch-sort').waitFor();
 assert(await page.evaluate(()=>securityFixture.groupReads>0));
 await page.locator('[data-tab="profile"]').click();await page.getByRole('button',{name:'Open settings',exact:true}).click();await page.locator('[data-settings="security"]').click();
 await page.locator('[data-remove-factor]').click();await page.locator('#remove-mfa-code').fill('123456');await page.locator('#remove-mfa-form button').click();await page.getByRole('button',{name:'Set up authenticator',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>securityFixture.factors.length),0);
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS: profile bio/history/filter/edit, categorized settings, signed-in password change, QR cancellation and verification, MFA login gate and removal; no SMS UI.');
 await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
