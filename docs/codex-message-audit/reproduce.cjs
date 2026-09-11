// Offline audit: execute actual Edge Function bodies with mocked DB, clock and LINE.
// No network, production data or application source writes.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
let clock = '2026-09-11T03:05:00Z';
class Clock extends Date { constructor(...a) { super(...(a.length ? a : [clock])); } static now() { return new Date(clock).getTime(); } }
function dbMock(tables) {
  return { from(table) {
    const filters = []; let patch; let cap = Infinity; let sort;
    const q = {
      select() { return q; }, update(p) { patch = p; return q; },
      eq(k,v) { filters.push(r=>r[k]===v); return q; },
      neq(k,v) { filters.push(r=>r[k]!==v); return q; },
      not(k,op,v) { filters.push(r=>r[k]!==v); return q; },
      in(k,v) { filters.push(r=>v.includes(r[k])); return q; },
      lte(k,v) { filters.push(r=>r[k]<=v); return q; },
      gte(k,v) { filters.push(r=>r[k]>=v); return q; },
      order(k) { sort=k; return q; }, limit(n) { cap=n; return q; },
      then(resolve,reject) { try {
        let rows=(tables[table]||[]).filter(r=>filters.every(f=>f(r)));
        if(sort) rows.sort((a,b)=>String(a[sort]).localeCompare(String(b[sort])));
        rows=rows.slice(0,cap); if(patch) rows.forEach(r=>Object.assign(r,patch));
        return Promise.resolve({data:structuredClone(rows),error:null}).then(resolve,reject);
      } catch(e) { return Promise.reject(e).then(resolve,reject); } }
    }; return q;
  }};
}
function edge(name,tables,fetch) {
  let handler;
  const source=fs.readFileSync(path.join(root,`supabase/functions/${name}/index.ts`),'utf8').replace(/^import .*;\r?$/gm,'');
  const context=vm.createContext({Date:Clock,Response,console:{log(){},error(){}},fetch,createClient:()=>dbMock(tables),Deno:{env:{get:()=> 'mock'},serve:fn=>handler=fn}});
  vm.runInContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
  return {handler,context};
}
const store=()=>({id:'s1',name:'Audit Store',line_channel_access_token:'mock',reminder_enabled:true,reminder_time:'12:00',reminder_days_before:1,follow_enabled:true});
const reservation=(id='r1')=>({id,store_id:'s1',line_user_id:'mock-user',reservation_date:'2026-09-12',reservation_time:'14:00',status:'confirmed',customer_name:'Audit'});
const follow=(id='f1',rid='r1')=>({id,store_id:'s1',reservation_id:rid,line_user_id:'mock-user',base_date:'2026-09-01',scheduled_at:'2026-09-08T03:00:00.000Z',attempt_count:0,status:'scheduled'});
const ok=async()=>({ok:true,status:200,text:async()=>''});
const results=[];
function localRepo(){
 const files=new Map();const fakeFs={existsSync:p=>files.has(p),readFileSync:p=>files.get(p),mkdirSync(){},writeFileSync:(p,v)=>files.set(p,v)};
 const source=fs.readFileSync(path.join(root,'src/lib/follow-message-repository.ts'),'utf8');
 const sched={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/lib/follow-message-scheduler.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:sched.exports,Date:Clock});
 const out={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,{exports:out,process:{cwd:()=>'/audit'},console,Date:Clock,Math,require:m=>m==='fs'?fakeFs:m==='path'?path:m==='@/lib/env'?{getAppEnvironment:()=> 'local'}:m==='@/lib/supabase'?{createAdminClient:()=>{throw Error('network prohibited')}}:sched.exports});
 return {repo:out,setStore:s=>files.set(path.join('/audit','data','stores.json'),JSON.stringify([s])),rows:()=>JSON.parse(files.get(path.join('/audit','data','follow_messages.json'))||'[]')};
}
async function test(name,fn){ await fn();results.push({name,result:'PASS (current behavior reproduced)'}); }
(async()=>{
 await test('R1: JST boundary and 1/3/7/30 days, month/year rollover',async()=>{
   const e=edge('send-reminders',{},ok);
   for(const now of ['2026-09-10T14:59:00Z','2026-09-10T15:00:00Z','2026-12-31T15:00:00Z','2028-02-28T15:00:00Z']) {
     clock=now;
     for(const days of [1,3,7,30]) {
       const expected=new Date(new Date(now).getTime()+(9+days*24)*3600000).toISOString().slice(0,10);
       assert.equal(vm.runInContext(`getDateStringJstAfterDays(${days})`,e.context),expected);
     }
   } clock='2026-09-11T03:05:00Z';
 });
 await test('R2: same-hour repeated invocation sends twice',async()=>{
   let n=0;const e=edge('send-reminders',{stores:[store()],reservations:[reservation()]},async()=>{n++;return ok();});
   await e.handler();await e.handler();assert.equal(n,2);
 });
 await test('R3: missed hour is not recovered next hour/day',async()=>{
   let n=0;const e=edge('send-reminders',{stores:[store()],reservations:[reservation()]},async()=>{n++;return ok();});
   clock='2026-09-11T04:00:00Z';await e.handler();clock='2026-09-12T03:00:00Z';await e.handler();assert.equal(n,0);clock='2026-09-11T03:05:00Z';
 });
 await test('R4: non-hour reminder time never matches',async()=>{
   let n=0;const e=edge('send-reminders',{stores:[{...store(),reminder_time:'12:30'}],reservations:[reservation()]},async()=>{n++;return ok();});await e.handler();assert.equal(n,0);
 });
 await test('R5: network exception aborts remaining reminder batch',async()=>{
   let n=0;const e=edge('send-reminders',{stores:[store()],reservations:[reservation(),reservation('r2')]},async()=>{n++;throw Error('mock network failure');});await assert.rejects(e.handler(),/network/);assert.equal(n,1);
 });
 await test('R6: pending reservations are sent',async()=>{
   let n=0;const e=edge('send-reminders',{stores:[store()],reservations:[{...reservation(),status:'pending'}]},async()=>{n++;return ok();});await e.handler();assert.equal(n,1);
 });
 await test('F1: stale scheduled_at wins over current store days/time',async()=>{
   let n=0;const row=follow();const e=edge('send-follow-messages',{stores:[{...store(),follow_days_after:30,follow_time:'21:00'}],reservations:[{...reservation(),reservation_date:'2026-09-01'}],follow_messages:[row]},async()=>{n++;return ok();});await e.handler();assert.equal(n,1);assert.equal(row.status,'sent');
 });
 await test('F2: second invocation after claim can claim and send same row',async()=>{
   let n=0,release,entered;const gate=new Promise(r=>release=r);const started=new Promise(r=>entered=r);
   const row=follow();const e=edge('send-follow-messages',{stores:[store()],reservations:[{...reservation(),reservation_date:'2026-09-01'}],follow_messages:[row]},async()=>{n++;if(n===1){entered();await gate;}return ok();});
   const a=e.handler();await started;await e.handler();release();await a;assert.equal(n,2);assert.equal(row.attempt_count,2);
 });
 await test('F3: network failures exceed three attempts and remain scheduled',async()=>{
   const row=follow();const e=edge('send-follow-messages',{stores:[store()],reservations:[{...reservation(),reservation_date:'2026-09-01'}],follow_messages:[row]},async()=>{throw Error('mock network failure');});
   for(let i=0;i<4;i++)await assert.rejects(e.handler(),/network/);assert.equal(row.attempt_count,4);assert.equal(row.status,'scheduled');
 });
 await test('F4: 201 due rows leave at least one for next run',async()=>{
   const rows=Array.from({length:201},(_,i)=>({...follow('f'+i,'r'+i),line_user_id:'user'+i}));
   const reservations=rows.map((r,i)=>({...reservation(r.reservation_id),line_user_id:r.line_user_id,reservation_date:'2026-09-01'}));
   let n=0;const e=edge('send-follow-messages',{stores:[store()],reservations,follow_messages:rows},async()=>{n++;return ok();});await e.handler();assert.equal(n,200);assert.equal(rows.filter(r=>r.status==='scheduled').length,1);
 });
 await test('F5: HTTP 500 retries do stop after three attempts',async()=>{
   const row=follow();const e=edge('send-follow-messages',{stores:[store()],reservations:[{...reservation(),reservation_date:'2026-09-01'}],follow_messages:[row]},async()=>({ok:false,status:500,text:async()=> 'mock error'}));
   for(let i=0;i<4;i++)await e.handler();assert.equal(row.attempt_count,3);assert.equal(row.status,'failed');
 });
 await test('Q1: cancelling replacement does not restore original follow',async()=>{
   const x=localRepo();x.setStore({...store(),follow_days_after:7,follow_time:'12:00'});
   await x.repo.scheduleFollowMessageForReservation(reservation(),new Date(clock));
   await x.repo.scheduleFollowMessageForReservation({...reservation('r2'),reservation_date:'2026-09-20'},new Date(clock));
   await x.repo.cancelFollowMessageForReservation('r2',new Date(clock));
   assert.deepEqual(x.rows().map(r=>r.status),['superseded','cancelled']);
 });
 await test('Q2: editing reservation after computed follow time discards due queue as store_disabled',async()=>{
   const x=localRepo();x.setStore({...store(),follow_days_after:7,follow_time:'12:00'});
   await x.repo.scheduleFollowMessageForReservation(reservation(),new Date(clock));
   await x.repo.rescheduleFollowMessageForReservation(reservation(),new Date('2026-09-19T03:01:00Z'));
   assert.equal(x.rows()[0].status,'skipped');assert.equal(x.rows()[0].skip_reason,'store_disabled');
 });
 await test('Q3: enabling follow after booking does not backfill on edit',async()=>{
   const x=localRepo();x.setStore({...store(),follow_enabled:false});
   await x.repo.scheduleFollowMessageForReservation(reservation(),new Date(clock));
   x.setStore({...store(),follow_days_after:7,follow_time:'12:00'});
   assert.equal(await x.repo.rescheduleFollowMessageForReservation(reservation(),new Date(clock)),false);assert.equal(x.rows().length,0);
 });
 fs.writeFileSync(path.join(__dirname,'results.json'),JSON.stringify({method:'Actual Edge Function TS transpiled; in-memory Supabase mock; mocked LINE only',results},null,2)+'\n');console.log(JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
