// Isolated, disposable PostgreSQL. Never connects to production or sends emails.
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const root = new URL(process.env.INQUIRY_TEST_PG_URL ?? 'postgresql://ig_test@127.0.0.1:56487/postgres');
if (!['127.0.0.1','localhost'].includes(root.hostname) || root.username !== 'ig_test') throw Error('Isolated local ig_test required');
const rootUrl=root.toString(), name=`inquiry_${randomUUID().replaceAll('-','')}`;
root.pathname=`/${name}`; const url=root.toString();
function sql(text,target=url,fail=false) {
 const r=spawnSync('psql',[target,'-X','-A','-t','-q','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8'});
 if(fail){if(r.status===0)throw Error('Expected SQL failure'); return r.stderr;}
 if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();
}
function parallel(text){return new Promise((resolve)=>{const p=spawn('psql',[url,'-X','-A','-t','-q','-v','ON_ERROR_STOP=1']);let out='',err='';p.stdout.on('data',c=>out+=c);p.stderr.on('data',c=>err+=c);p.on('close',code=>resolve({code,out:out.trim(),err}));p.stdin.end(text);});}
const check=(v,m)=>{if(!v)throw Error(m);};
const submit=(id=randomUUID(),ip='a',hash='b')=>`select public.submit_business_inquiry('${id}','ko','Contact','Company','sender@example.com','Inquiry',true,repeat('${ip}',64),repeat('${hash}',64));`;
const asService=(s)=>`set role service_role;${s}`;
try{
 sql(`create database ${name}`,rootUrl);
 sql(`do $$ begin if not exists(select from pg_roles where rolname='anon')then create role anon;end if;if not exists(select from pg_roles where rolname='authenticated')then create role authenticated;end if;if not exists(select from pg_roles where rolname='service_role')then create role service_role bypassrls;end if;end $$;grant usage on schema public to anon,authenticated,service_role;`);
 // pg_cron is unavailable in a plain Homebrew fixture. Record and assert scheduling
 // intent only; actual cron execution is explicitly outside this local check.
 sql(`create schema cron;create table cron.jobs(name text,schedule text,command text);create function cron.schedule(text,text,text)returns bigint language sql as 'insert into cron.jobs values($1,$2,$3);select 1::bigint';`);
 sql(await readFile(new URL('../supabase/migrations/20260910130000_business_inquiries.sql',import.meta.url),'utf8'));
 check(sql(`select count(*) from cron.jobs where name='business-inquiry-retention' and schedule='17 * * * *' and command='select public.maintain_business_inquiries()';`)==='1','cron registration');
 for(const role of ['anon','authenticated']){
  check(sql(`set role ${role};select * from public.business_inquiries`,url,true).includes('permission denied'),'table access');
  for(const call of [submit(),'select public.maintain_business_inquiries();','select * from public.claim_business_inquiry();','select public.business_inquiry_health();',`select public.begin_business_inquiry_send('${randomUUID()}','${randomUUID()}');`,`select public.finish_business_inquiry('${randomUUID()}','${randomUUID()}','unknown');`])check(sql(`set role ${role};${call}`,url,true).includes('permission denied'),'RPC access');
 }
 check(sql(asService(submit().replace("'Contact'","''")),url,true).includes('INQUIRY_INVALID'),'invalid');
 const id=randomUUID();check(sql(asService(submit(id)))==='f','new');check(sql(asService(submit(id)))==='t','replay');check(sql(asService(submit(id,'a','c')),url,true).includes('INQUIRY_IDEMPOTENCY_CONFLICT'),'conflict');
 sql('truncate public.business_inquiries');
 const same=await Promise.all(Array.from({length:6},()=>parallel(asService(submit(id)))));
 check(same.every(r=>r.code===0)&&same.filter(r=>r.out==='f').length===1,'concurrent same key');
 const rate=await Promise.all(Array.from({length:8},()=>parallel(asService(submit()))));
 check(rate.filter(r=>r.code===0).length===2 && rate.filter(r=>r.err.includes('INQUIRY_RATE_LIMITED')).length===6,'atomic IP rate');
 check(sql(asService(submit(id)))==='t','replay after quota');
 sql('truncate public.business_inquiries');
 sql(`insert into public.business_inquiries(id,locale,contact_name,company,email,message,ip_hash,payload_hash)select gen_random_uuid(),'en','A','B','c@example.com','D',repeat('c',64),repeat('b',64) from generate_series(1,99);`);
 const global=await Promise.all(['a','d','e','f'].map(ip=>parallel(asService(submit(randomUUID(),ip)))));
 check(global.filter(r=>r.code===0).length===1,'global quota');
 sql('truncate public.business_inquiries');sql(asService(submit(id)));
 const claims=await Promise.all(Array.from({length:4},()=>parallel(asService('select id from public.claim_business_inquiry();'))));
 check(claims.every(r=>r.code===0)&&claims.filter(r=>r.out===id).length===1,'exclusive claim');
 let token=sql(`select attempt_token from public.business_inquiries where id='${id}'`);
 check(sql(asService(`select public.begin_business_inquiry_send('${id}','${randomUUID()}');`))==='f','token ownership');
 check(sql(asService(`select public.begin_business_inquiry_send('${id}','${token}');`))==='t','begin');
 // Simulate process death / begin response loss. No SES call, no finish required.
 sql(`update public.business_inquiries set lease_expires_at=now()-interval '1 second' where id='${id}';`);
 check(sql(asService('select id from public.claim_business_inquiry();'))==='','expired sending not re-sent');
 check(sql(`select status from public.business_inquiries where id='${id}'`)==='delivery_unknown','unknown recovery');
 check(sql(asService(`select public.finish_business_inquiry('${id}','${token}','sent','late');`))==='f','late ack cannot mutate');
 sql('truncate public.business_inquiries');sql(asService(submit(id)));
 sql(asService('select id from public.claim_business_inquiry();'));token=sql(`select attempt_token from public.business_inquiries where id='${id}'`);
 sql(`update public.business_inquiries set lease_expires_at=now()-interval '1 second' where id='${id}'`);sql(asService('select id from public.claim_business_inquiry();'));
 check(sql(`select attempt_token::text from public.business_inquiries where id='${id}'`)!==token,'claimed recovery rotates token');
 token=sql(`select attempt_token from public.business_inquiries where id='${id}'`);sql(asService(`select public.begin_business_inquiry_send('${id}','${token}');select public.finish_business_inquiry('${id}','${token}','sent','ses-id');`));
 check(sql(`select contact_name is null and company is null and email is null and message is null and status='sent' from public.business_inquiries where id='${id}'`)==='t','success erases PII');
 sql('truncate public.business_inquiries');sql(asService(submit(id)));
 for(let i=0;i<3;i++){sql(asService('select id from public.claim_business_inquiry();'));token=sql(`select attempt_token from public.business_inquiries where id='${id}'`);sql(asService(`select public.begin_business_inquiry_send('${id}','${token}');select public.finish_business_inquiry('${id}','${token}','throttled');`));sql(`update public.business_inquiries set available_at=now()-interval '1 second'`);}
 check(sql(`select status||':'||attempt_count from public.business_inquiries where id='${id}'`)==='failed:3','retry bound');
 for(const status of ['pending','claimed','sending','failed','delivery_unknown','sent']) sql(`insert into public.business_inquiries(id,locale,contact_name,company,email,message,ip_hash,payload_hash,status,created_at)values(gen_random_uuid(),'ko','A','B','c@example.com','D',repeat('d',64),repeat('e',64),'${status}',now()-interval '8 days')`);
 sql(asService('select public.maintain_business_inquiries();'));check(sql(`select count(*) from public.business_inquiries where created_at<now()-interval '7 days'`)==='0','independent retention');
 check(!sql(asService('select public.business_inquiry_health();')).includes('example.com'),'health PII');
 console.log('PASS: permissions, validation, atomic idempotency/IP/global quotas, exclusive claim, durable sending recovery, attempt ownership, bounded retries, PII erasure, retention. Cron scheduling contract only (fixture stub).');
}finally{sql(`drop database if exists ${name} with(force)`,rootUrl);}
