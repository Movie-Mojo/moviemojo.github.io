const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
(async () => {
 const source = readFileSync('supabase/functions/movie-data/handler.js','utf8');
 const { createHandler, movieURL } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
 assert.equal(movieURL({path:"trending/movie/week",params:{page:2}}).pathname,"/3/trending/movie/week");
 assert.throws(()=>movieURL({path:"trending/movie/week",params:{with_genres:"35"}}));
 let gateStatus=200, allowed=true, upstreamStatus=200, calls=[], clock=1000;
 const env = n => ({TMDB_API_KEY:'server-only-test-key',SUPABASE_URL:'https://database.test',SUPABASE_ANON_KEY:'public-test-key'})[n];
 const handler=createHandler({env, now:()=>clock, fetch:async (url,options)=>{
  calls.push({url:String(url),options});
  return String(url).includes('/rpc/') ? Response.json(allowed,{status:gateStatus}) : Response.json(upstreamStatus===200 ? {title:'Inception'} : {secret:'server-only-test-key'},{status:upstreamStatus});
 }});
 const request=(body={path:'movie/27205',params:{append_to_response:'watch/providers,videos,external_ids'}},options={})=>new Request('https://proxy.test',{method:'POST',headers:{origin:'https://moviemojo.dev',authorization:'Bearer user-jwt','Content-Type':'application/json',...options.headers},body:JSON.stringify(body),...options});
 assert.equal((await handler(request({}, {method:'OPTIONS',body:undefined}))).status,204);
 assert.equal((await handler(request(undefined,{headers:{origin:'https://evil.test',authorization:'Bearer user-jwt'}}))).status,403);
 assert.equal((await handler(request(undefined,{headers:{origin:'https://moviemojo.dev'}}))).status,401);
 for(const body of [{path:'https://evil.test'}, {path:'movie/1/../../account'}, {path:'account'}, {path:'movie/1',params:{api_key:'injected'}}, {path:'discover/movie',params:{page:501}}, {path:'discover/movie',params:{include_adult:true}}, {path:'search/movie',params:{query:'x'.repeat(201)}}, {path:'movie/1',params:null}, {path:'discover/movie',params:{'primary_release_date.gte':'2026-02-30'}}]) {
  if(body.params===null) continue; // null means no optional filters
  assert.equal((await handler(request(body))).status,400,JSON.stringify(body));
 }
 assert.equal((await handler(request({path:'search/movie',params:{query:'x'.repeat(5000)}}))).status,400);
 assert.equal(calls.length,0,'invalid requests must not reach database or TMDB');
 gateStatus=403; assert.equal((await handler(request())).status,403);
 assert.equal(calls.filter(c=>c.url.includes('themoviedb')).length,0);
 gateStatus=503; assert.equal((await handler(request())).status,503);
 gateStatus=200; allowed=false; const limited=await handler(request()); assert.equal(limited.status,429); assert.equal(limited.headers.get('Retry-After'),'60');
 allowed=true; const res=await handler(request()); assert.equal(res.status,200); assert.equal(res.headers.get('Access-Control-Allow-Origin'),'https://moviemojo.dev'); assert.equal(res.headers.get('Cache-Control'),'no-store'); assert.deepEqual(await res.json(),{title:'Inception'});
 assert(calls.at(-1).url.includes('api_key=server-only-test-key'));
 const before=calls.filter(c=>c.url.includes('themoviedb')).length;
 await handler(request()); assert.equal(calls.filter(c=>c.url.includes('themoviedb')).length,before,'cache hit skips TMDB');
 allowed=false; assert.equal((await handler(request())).status,429,'cache must not bypass authorization/limits'); allowed=true;
 clock+=300001; await handler(request()); assert.equal(calls.filter(c=>c.url.includes('themoviedb')).length,before+1,'cache expires');
 upstreamStatus=500; const failed=await handler(request({path:'movie/2'})); assert.equal(failed.status,502); assert(!(await failed.text()).includes('server-only-test-key'));
 const search=movieURL({path:'search/movie',params:{query:'x & api_key=evil',page:1}}); assert.equal(search.searchParams.get('query'),'x & api_key=evil'); assert.equal(search.searchParams.has('api_key'),false);
 for(const path of ['watch/providers/movie','discover/movie','search/movie','movie/1']) assert(movieURL({path,params:path==='search/movie'?{query:'test'}:{}}).hostname==='api.themoviedb.org');
 const missing=createHandler({env:()=>undefined,fetch:()=>{throw Error('must not fetch')}}); assert.equal((await missing(request())).status,503);
 console.log('PASS: proxy allowlist, bounded inputs, authentication gate, shared-limit responses, cache authorization/expiry, secret-free errors, fixed upstream host.');
})().catch(e=>{console.error(e);process.exit(1)});
