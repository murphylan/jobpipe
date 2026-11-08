import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { publishEvent } from "./publish";
import { processInboxOnce } from "../engine/daemon";
import { readKnowledge } from "../knowledge";
import { queryActivityFeed, writeWaitingAnswer } from "../engine/console";
import { readHatchEnvironment } from "../muse-hatch";
const helper = path.resolve('integrations/muse/hatch/jobpipe_executor/scripts/jobpipe.py');
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
function fixture() {
 const base = mkdtempSync(path.join(tmpdir(), 'jobpipe-hatch-')); dirs.push(base);
 mkdirSync(path.join(base, 'docs/skill'), {recursive:true}); mkdirSync(path.join(base,'vm'));
 writeFileSync(path.join(base,'AGENTS.md'),'Use inbox; user approves apply'); writeFileSync(path.join(base,'docs/skill/inbox-contract.md'),'Only Engine writes business files');
 writeFileSync(path.join(base,'vm/task.txt'),'筛选演练，不投递');
 return base;
}
function python(args: string[], ok = true) { const p=spawnSync('python3',[helper,...args],{encoding:'utf8'}); if(ok)expect(p.status,p.stderr).toBe(0);else expect(p.status).not.toBe(0);return p; }
function process(base: string) { return processInboxOnce(base,{nowMs:Date.now()+2000}); }
function transfer(base:string,file:string) { const item=JSON.parse(readFileSync(file,'utf8'));const dest=path.join(base,'data/inbox',item.taskId+'.json');mkdirSync(path.dirname(dest),{recursive:true});copyFileSync(file,dest);utimesSync(dest,new Date(0),new Date(0));return item; }
function request(base:string,session='run-one',name='one',activity?:string) {
 const req=path.join(base,'vm',name+'-request.json'),state=path.join(base,'vm',name+'-state.json');
 python(['request','--stage','screening','--task-file',path.join(base,'vm/task.txt'),'--session-id',session,'--out',req]);
 const event=transfer(base,req); expect(process(base)[0].outcome).toBe('committed');
 const snapshot=path.join(base,'data/agent-contexts',event.taskId+'.json');
 const load=['load','--snapshot',snapshot,'--receipt',path.join(base,'data/receipts',event.taskId+'.json'),'--request',req,'--state',state,'--workspace',base,...(activity?['--activity-id',activity]:[])];
 const metadata=JSON.parse(python(load).stdout);return {req,state,event,snapshot,load,metadata};
}
it('Muse file transport loads an Engine-built context and publishes real ordered activity/waiting/resume signals',()=>{
 const base=fixture(); const run=request(base);
 expect(existsSync(path.join(base,'data/activity.json'))).toBe(false);
 expect(run.metadata.knowledgeAvailable).toBe(false);
 const report=(status:string,name:string,extra:string[]=[])=>{const file=path.join(base,'vm',name+'.json');python(['report','--state',run.state,'--status',status,'--title','实际筛选任务','--out',file,...extra]);transfer(base,file);expect(process(base)[0].outcome).toBe('committed');return file;};
 const first=report('running','start',['--scope','batch']);
 expect(queryActivityFeed(base,{}).running[0].scope).toBe('batch');
 expect(queryActivityFeed(base,{}).running).toHaveLength(1);
 expect(readHatchEnvironment(base).lastContext?.digest).toBe(run.metadata.digest);
 const bytes=readFileSync(path.join(base,'data/activity.json'),'utf8');transfer(base,first);expect(process(base)[0].outcome).toBe('duplicate');expect(readFileSync(path.join(base,'data/activity.json'),'utf8')).toBe(bytes);
 report('waiting','wait');
 publishEvent(base,{event:'AGENT_WAITING',payload:{waitingId:'question',question:'Which site?',sourceActivityId:run.metadata.activityId}});process(base);
 expect(queryActivityFeed(base,{}).activities[0].status).toBe('waiting');
 const blocked=path.join(base,'vm/blocked.json');python(['report','--state',run.state,'--status','running','--title','Resume','--out',blocked],false);expect(existsSync(blocked)).toBe(false);
 expect(writeWaitingAnswer(base,{waitingId:'question',action:'answer',answer:'Confirmed site'}).ok).toBe(true);process(base);
 const item=JSON.parse(readFileSync(path.join(base,'data/waiting.json'),'utf8')).items[0];const answer=path.join(base,'vm/answer.json');writeFileSync(answer,JSON.stringify(item));
 report('running','resume',['--resume-answer',answer]);report('failed','failure');
 const restarted=request(base,'run-two','two',run.metadata.activityId);const file=path.join(base,'vm/restart.json');
 python(['report','--state',restarted.state,'--status','running','--title','Retry after reviewing Receipts','--restart-of','run-one','--out',file]);transfer(base,file);expect(process(base)[0].outcome).toBe('committed');
 expect(queryActivityFeed(base,{}).activities[0].runId).toBe('run-two');
 expect(existsSync(path.join(base,'data/applications.json'))).toBe(false);
});
it('confirmed Knowledge survives a new context request and stale snapshots fail closed',()=>{
 const base=fixture();publishEvent(base,{event:'KNOWLEDGE_CHANGED',payload:{action:'add',title:'Account method',body:'Use confirmed company email',tags:['agent-context']}});process(base);
 publishEvent(base,{event:'KNOWLEDGE_CHANGED',payload:{action:'add',title:'Private',body:'DO_NOT_EXPORT',tags:['credential','agent-context']}});process(base);
 const old=request(base);const content=readFileSync(old.snapshot,'utf8');expect(content).toContain('Use confirmed company email');expect(content).not.toContain('DO_NOT_EXPORT');
 const entry=readKnowledge(base).entries.find(e=>e.title==='Account method')!;
 publishEvent(base,{event:'KNOWLEDGE_CHANGED',payload:{action:'update',id:entry.id,expectedUpdatedAt:entry.updatedAt,title:entry.title,body:'Use the new confirmed method',tags:entry.tags}});process(base);
 const stale=path.join(base,'vm/stale.json');python(['report','--state',old.state,'--status','running','--title','Stale run','--out',stale]);transfer(base,stale);expect(process(base)[0].outcome).toBe('rejected');
 const fresh=request(base,'fresh-run','fresh');const snapshot=JSON.parse(readFileSync(fresh.snapshot,'utf8'));const selected=JSON.parse(snapshot.content).knowledge;
 expect(selected.map((e:{body:string})=>e.body)).toEqual(['Use the new confirmed method']);
 expect(fresh.metadata.knowledgeAvailable).toBe(true);expect(fresh.metadata.digest).not.toBe(old.metadata.digest);
});
it('rejects tampered context/Receipt, unsafe requests, and unproved completion',()=>{
 const base=fixture(),run=request(base);
 const snapshot=JSON.parse(readFileSync(run.snapshot,'utf8'));snapshot.content+=' ';writeFileSync(run.snapshot,JSON.stringify(snapshot));
 python(run.load,false);
 const start = path.join(base, 'vm/local-start.json');python(['report','--state',run.state,'--status','running','--title','Test proof validation','--out',start]);
 const target=path.join(base,'vm/no-proof.json');python(['report','--state',run.state,'--status','done','--title','No proof','--out',target],false);expect(existsSync(target)).toBe(false);
 publishEvent(base,{event:'AGENT_CONTEXT_REQUESTED',payload:{sessionId:'../escape',stage:'screening',task:'Invalid'}});expect(process(base)[0].outcome).toBe('rejected');
});

it('context-bound completion cannot use a copied fake business Receipt',()=>{
 const base=fixture(),run=request(base);const start=path.join(base,'vm/start.json');
 python(['report','--state',run.state,'--status','running','--title','Start','--out',start]);transfer(base,start);expect(process(base)[0].outcome).toBe('committed');
 const proof=path.join(base,'vm/proof.json');writeFileSync(proof,JSON.stringify({receipts:[{taskId:'fake-proof',event:'SCREENED',status:'committed'}]}));
 const done=path.join(base,'vm/done.json');python(['report','--state',run.state,'--status','done','--title','Cannot fabricate completion','--proof-file',proof,'--out',done]);transfer(base,done);expect(process(base)[0].outcome).toBe('rejected');
 expect(queryActivityFeed(base,{}).activities[0].status).toBe('running');
});
