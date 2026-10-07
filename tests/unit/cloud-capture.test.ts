import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecordRepository } from '../../src/data/RecordRepository'
import { BrowserFileStore } from '../../src/data/FileStore'
import { CaptureCoordinator } from '../../src/services/CaptureCoordinator'
import { MockDeviceAdapter } from '../../src/services/MockDeviceAdapter'
import { createReading } from '../../src/domain/reading'
import { chooseFallback, localScentLabels } from '../../src/domain/fallback'
import { CloudGenerationAdapter } from '../../src/services/CloudGenerationAdapter'
import { fixedScores, imageResponse, interpretation } from '../fixtures/cloud'
import type { ArtworkSubmission } from '../../src/domain/artwork'
import { validateSnapshot } from '../../src/data/snapshot'

const repos:RecordRepository[]=[], coordinators:CaptureCoordinator[]=[]
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{promise,resolve}}
function setup(options:{imageGate?:ReturnType<typeof deferred>;textGate?:ReturnType<typeof deferred>;imageFailure?:boolean;saveFailure?:boolean;budget?:number}={}){
  const files=new BrowserFileStore(`cloud-files-${crypto.randomUUID()}`), repo=new RecordRepository(`cloud-${crypto.randomUUID()}`,files,async()=>({width:1024,height:1024}));repos.push(repo)
  const calls:{path:string;body:any}[]=[]
  const fetcher:typeof fetch=async(url,init)=>{
    const body=JSON.parse(String(init?.body)),path=String(url);calls.push({path,body})
    if(path.endsWith('/interpret')){await options.textGate?.promise;const identity={recordId:body.recordId,attemptId:body.attemptId,generationId:body.generationId,requestId:body.requestId};const text=interpretation(identity,body.variantIndex);text.title=`气味作品 ${body.variantIndex}`;return Response.json({...identity,status:'ready',interpretation:text})}
    await options.imageGate?.promise
    if(options.imageFailure)return Response.json({error:{code:'UPSTREAM_FAILED',message:'图像生成失败',retryable:true,requestId:body.requestId}},{status:502})
    return Response.json(imageResponse({recordId:body.recordId,attemptId:body.attemptId,generationId:body.generationId,requestId:body.requestId},body.interpretation))
  }
  const generator=new CloudGenerationAdapter('https://api.example',fetcher);generator.configureAccess('test-access')
  let failures=options.saveFailure?1:0
  const submissions:ArtworkSubmission[]=[]
  const save=async(input:ArtworkSubmission)=>{submissions.push(input);if(failures-->0)throw new Error('磁盘写入失败');return repo.commitArtwork(input)}
  const c=new CaptureCoordinator(repo,new MockDeviceAdapter(),generator,options.budget,save);coordinators.push(c);repo.onReadingDeleted(id=>c.readingDeleted(id))
  const saveReading=()=>repo.save(createReading({captureSessionId:crypto.randomUUID(),source:'mock',rawScores:[.1,.1,.1,.84,.1,.39,.1,.73],rawScale:'0-1',resultValid:true,preview:false,quality:'unknown'}))
  return{repo,c,calls,saveReading,submissions,options,generator}
}
afterEach(async()=>{coordinators.splice(0).forEach(c=>c.stop());vi.useRealTimers();await Promise.all(repos.splice(0).map(r=>r.db.delete()))})
describe('TASK-05 real App pipeline with explicitly simulated HTTP',()=>{
  it('TASK-10 accepts a 100-second first generation with one 120-second deadline and restores its snapshot',async()=>{
    const textGate=deferred(),imageGate=deferred(),s=setup({textGate,imageGate}),r=await s.saveReading()
    vi.useFakeTimers({toFake:['Date']})
    const start=Date.now(),pending=s.c.beginPreview(r)
    await vi.waitFor(()=>expect(s.calls).toHaveLength(1))
    expect(s.calls[0].body.remainingBudgetMs).toBeGreaterThan(119_000)
    expect(s.calls[0].body.remainingBudgetMs).toBeLessThanOrEqual(120_000)
    vi.setSystemTime(start+70_000);textGate.resolve()
    await vi.waitFor(()=>expect(s.calls).toHaveLength(2))
    expect(s.calls[1].body.remainingBudgetMs).toBeGreaterThan(49_000)
    expect(s.calls[1].body.remainingBudgetMs).toBeLessThanOrEqual(50_000)
    s.c.routeChanged(`/scent/${r.id}`);s.c.routeChanged(`/result/${r.id}`)
    expect(s.c.getSnapshot().preview?.deadline).toBe(start+120_000)
    vi.setSystemTime(start+100_000);imageGate.resolve();await pending
    expect(s.c.getSnapshot().preview?.phase).toBe('ready')
    expect(await s.repo.availableVersions(r.id)).toHaveLength(1)
    const snapshot=(await s.repo.snapshots.latest()).snapshot!
    expect(snapshot.readings[0].cloudAttempt?.deadline).toBe(start+120_000)
    expect(()=>validateSnapshot(snapshot,snapshot.meta.namespace)).not.toThrow()
    // Legacy one-minute records remain recoverable; budgets over two minutes do not.
    snapshot.readings[0].cloudAttempt!.deadline=start+60_000
    expect(()=>validateSnapshot(snapshot,snapshot.meta.namespace)).not.toThrow()
    snapshot.readings[0].cloudAttempt!.deadline=start+120_001
    expect(()=>validateSnapshot(snapshot,snapshot.meta.namespace)).toThrow()
  })
  it('TASK-10 expires at 120 seconds during image transport and rejects its late response',async()=>{
    const imageGate=deferred(),s=setup({imageGate}),r=await s.saveReading()
    vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout']})
    const pending=s.c.beginPreview(r)
    await vi.waitFor(()=>expect(s.calls).toHaveLength(2))
    const deadline=s.c.getSnapshot().preview!.deadline
    await vi.advanceTimersByTimeAsync(deadline-Date.now()-1)
    expect(s.c.getSnapshot().preview?.phase).toBe('generating')
    await vi.advanceTimersByTimeAsync(1)
    expect(s.c.getSnapshot().preview?.phase).toBe('timeout')
    imageGate.resolve();await pending
    expect(await s.repo.availableVersions(r.id)).toHaveLength(0)
    expect((await s.repo.get(r.id))?.interpretation).toBeDefined()
    expect(s.calls).toHaveLength(2)
  })
  it('TASK-08 deleting the old main does not cancel or replace the newer in-flight generation',async()=>{
    const s=setup(),r=await s.saveReading(),perfume=await s.repo.archive(r.id,{name:'稳定封面'})
    await s.c.beginPreview(r);const old=(await s.repo.artwork(r.id))!.generation
    const gate=deferred();s.options.imageGate=gate
    const pending=s.c.beginPreview((await s.repo.get(r.id))!,true)
    await vi.waitFor(()=>expect(s.calls).toHaveLength(4));const attempt=s.c.getSnapshot().preview!.attemptId
    await s.repo.deleteGeneration(old.id)
    expect(s.c.getSnapshot().preview).toMatchObject({attemptId:attempt,phase:'generating'})
    expect((await s.repo.get(r.id))?.selectedGenerationId).toBeUndefined()
    gate.resolve();await pending
    expect(await s.repo.availableVersions(r.id)).toHaveLength(1)
    expect(s.c.getSnapshot().preview?.phase).toBe('ready')
    expect((await s.repo.getPerfume(perfume.id))?.coverGenerationId).toBeUndefined()
    expect((await s.repo.getPerfume(perfume.id))?.initialCoverPending).toBe(false)
  })
  it('TASK-08 clear all isolates a late image and retains an empty protected library',async()=>{
    const imageGate=deferred(),s=setup({imageGate}),r=await s.saveReading(),pending=s.c.beginPreview(r)
    await vi.waitFor(()=>expect(s.calls).toHaveLength(2));await s.repo.clearAll();imageGate.resolve();await pending
    expect(await s.repo.library()).toEqual({readings:[],generations:[],perfumes:[]})
    expect((await s.repo.snapshots.latest()).snapshot?.meta.explicitlyCleared).toBe(true)
  })
  it('persists text before image, shares identity/deadline across navigation and rapid clicks, then commits a local cloud version',async()=>{
    const imageGate=deferred(),s=setup({imageGate}),reading=await s.saveReading(),p=s.c.beginPreview(reading)
    await vi.waitFor(()=>expect(s.calls).toHaveLength(2));const text=(await s.repo.get(reading.id))!.interpretation
    expect(text?.title).toBe('气味作品 0');expect(await s.repo.availableVersions(reading.id)).toHaveLength(0)
    const attempt=s.c.getSnapshot().preview!
    s.c.routeChanged(`/scent/${reading.id}`);s.c.routeChanged(`/result/${reading.id}`)
    await Promise.all([s.c.beginPreview(reading),s.c.beginPreview(reading,true)])
    expect(s.c.getSnapshot().preview?.attemptId).toBe(attempt.attemptId);expect(s.calls).toHaveLength(2)
    expect(s.calls[0].body.attemptId).toBe(s.calls[1].body.attemptId);expect(s.calls[0].body.requestId).not.toBe(s.calls[1].body.requestId);expect(s.calls[1].body.remainingBudgetMs).toBeLessThanOrEqual(s.calls[0].body.remainingBudgetMs)
    imageGate.resolve();await p
    expect(s.c.getSnapshot().preview?.phase).toBe('ready');expect((await s.repo.artwork(reading.id))?.blob?.size).toBeGreaterThan(0)
    expect((await s.repo.availableVersions(reading.id))[0].textSnapshot).toEqual(text)
    const snapshot=await s.repo.snapshots.latest();expect(snapshot.snapshot?.readings[0].cloudAttempt?.phase).toBe('ready')
  })
  it('regenerates interpretation, increments variant, selects new main and keeps stable cover and old version',async()=>{
    const s=setup(),r=await s.saveReading(),perfume=await s.repo.archive(r.id,{name:'用户香水名'});await s.c.beginPreview(r)
    const original=(await s.repo.artwork(r.id))!.generation
    await s.c.beginPreview((await s.repo.get(r.id))!,true)
    expect(s.calls.filter(x=>x.path.endsWith('interpret'))).toHaveLength(2);expect(s.calls[2].body.variantIndex).toBe(1)
    const library=await s.repo.library();expect(library.readings[0].selectedGenerationId).not.toBe(original.id);expect(library.perfumes.find(p=>p.id===perfume.id)?.coverGenerationId).toBe(original.id);expect(library.perfumes[0].name).toBe('用户香水名');expect(await s.repo.availableVersions(r.id)).toHaveLength(2)
  })
  it.each(['interrupted','timeout'] as const)('keeps the paid Prompt when %s lands during text snapshot protection',async phase=>{
    const s=setup(),r=await s.saveReading(),gate=deferred(),entered=deferred()
    const commit=s.repo.snapshots.commit.bind(s.repo.snapshots)
    let held=false
    vi.spyOn(s.repo.snapshots,'commit').mockImplementation(async snapshot=>{
      if(!held&&snapshot.readings.some(x=>x.cloudAttempt?.interpretation)){held=true;entered.resolve();await gate.promise}
      return commit(snapshot)
    })
    const running=s.c.beginPreview(r);await entered.promise;s.c.stopPreview(phase);gate.resolve();await running
    await vi.waitFor(async()=>expect((await s.repo.get(r.id))?.cloudAttempt?.phase).toBe(phase))
    expect((await s.repo.get(r.id))?.cloudAttempt?.interpretation).toBeDefined()
    await s.c.beginPreview((await s.repo.get(r.id))!)
    expect(s.calls.filter(c=>c.path.endsWith('/interpret'))).toHaveLength(1)
    expect(await s.repo.availableVersions(r.id)).toHaveLength(1)
  })
  it('never downgrades a committed image when cancellation lands during its snapshot',async()=>{
    const s=setup(),r=await s.saveReading(),gate=deferred(),entered=deferred(),commit=s.repo.snapshots.commit.bind(s.repo.snapshots)
    let held=false
    vi.spyOn(s.repo.snapshots,'commit').mockImplementation(async snapshot=>{
      if(!held&&snapshot.generations.length){held=true;entered.resolve();await gate.promise}
      return commit(snapshot)
    })
    const running=s.c.beginPreview(r);await entered.promise;s.c.stopPreview();gate.resolve();await running
    await s.repo.retryProtection()
    expect((await s.repo.get(r.id))?.cloudAttempt?.phase).toBe('ready')
    expect(s.c.getSnapshot().preview?.phase).toBe('ready')
    expect(await s.repo.availableVersions(r.id)).toHaveLength(1)
  })
  it('image failure keeps old version/text, resume creates new identities but reuses exact successful Prompt/variant',async()=>{
    const s=setup(),r=await s.saveReading();await s.c.beginPreview(r);const old=(await s.repo.artwork(r.id))!.generation
    s.options.imageFailure=true;await s.c.beginPreview((await s.repo.get(r.id))!,true)
    expect((await s.repo.artwork(r.id))!.generation).toEqual(old)
    const failed=s.calls.at(-1)!.body,oldCallCount=s.calls.length;s.options.imageFailure=false;await s.c.beginPreview((await s.repo.get(r.id))!)
    expect(s.calls.length-oldCallCount).toBe(1);const resumed=s.calls.at(-1)!.body
    expect(resumed.attemptId).not.toBe(failed.attemptId);expect(resumed.generationId).not.toBe(failed.generationId);expect(resumed.requestId).not.toBe(failed.requestId);expect(resumed.interpretation).toEqual(failed.interpretation)
    expect(await s.repo.availableVersions(r.id)).toHaveLength(2)
  })
  it.each(['cancel','timeout','delete','navigate'] as const)('rejects late image after %s without version or resurrection',async action=>{
    const imageGate=deferred(),s=setup({imageGate}),r=await s.saveReading(),p=s.c.beginPreview(r)
    await vi.waitFor(()=>expect(s.calls).toHaveLength(2))
    if(action==='delete')await s.repo.deleteReading(r.id);else if(action==='navigate')s.c.routeChanged('/home');else s.c.stopPreview(action==='timeout'?'timeout':'interrupted')
    imageGate.resolve();await p
    expect(await s.repo.availableVersions(r.id)).toHaveLength(0)
    expect(!!await s.repo.get(r.id)).toBe(action!=='delete')
  })
  it('old late response cannot replace a new retry',async()=>{
    const gate=deferred(),s=setup({imageGate:gate}),r=await s.saveReading(),old=s.c.beginPreview(r)
    await vi.waitFor(()=>expect(s.calls).toHaveLength(2));s.c.stopPreview();s.options.imageGate=undefined
    await s.c.beginPreview((await s.repo.get(r.id))!);const selected=(await s.repo.get(r.id))!.selectedGenerationId;gate.resolve();await old
    expect((await s.repo.get(r.id))!.selectedGenerationId).toBe(selected);expect(await s.repo.availableVersions(r.id)).toHaveLength(1)
  })
  it('save-only retry reuses exact bytes and version identity without HTTP calls',async()=>{
    const s=setup({saveFailure:true}),r=await s.saveReading();await s.c.beginPreview(r)
    expect(s.c.getSnapshot().preview).toMatchObject({phase:'save-failed',canRetrySave:true});expect(await s.repo.availableVersions(r.id)).toHaveLength(0)
    await Promise.all([s.c.retryArtworkSave(),s.c.retryArtworkSave()]);expect(s.calls).toHaveLength(2);expect(s.submissions).toHaveLength(2);expect(s.submissions[1].blob).toBe(s.submissions[0].blob);expect(s.submissions[1].generationId).toBe(s.submissions[0].generationId)
    expect((await s.repo.get(r.id))!.fallbackPresentation).toBeUndefined();expect(await s.repo.availableVersions(r.id)).toHaveLength(1)
  })
  it('cold reopen never calls the service and manual resume skips the successful interpretation',async()=>{
    const s=setup({imageFailure:true}),r=await s.saveReading();await s.c.beginPreview(r);s.repo.db.close();await s.repo.db.open();expect(s.calls).toHaveLength(2)
    s.options.imageFailure=false;await s.c.beginPreview((await s.repo.get(r.id))!);expect(s.calls).toHaveLength(3);expect(s.calls[2].path).toContain('generate-image')
  })
  it('shared budget actually times out while transport ignores abort',async()=>{
    const gate=deferred(),s=setup({textGate:gate,budget:50}),r=await s.saveReading(),p=s.c.beginPreview(r)
    await vi.waitFor(()=>expect(s.c.getSnapshot().preview?.phase).toBe('timeout'));gate.resolve();await p
    expect((await s.repo.get(r.id))?.interpretation).toBeUndefined();expect(s.calls).toHaveLength(1)
  })
  it('configuration/authorization failure makes no request and persists fallback without creating a version/cover',async()=>{
    const s=setup(),r=await s.saveReading();s.generator.configureAccess('');await s.repo.archive(r.id,{name:'未出图'});await s.c.beginPreview(r)
    expect(s.calls).toHaveLength(0);expect((await s.repo.get(r.id))!.fallbackPresentation?.resourceKey).toBe('lemon');expect((await s.repo.library()).perfumes[0]).toMatchObject({initialCoverPending:true});expect(await s.repo.availableVersions(r.id)).toHaveLength(0)
  })
})
describe('nine local fallback choices',()=>{
  it.each(Object.keys(fixedScores))('selects highest %s without changing scores',key=>{
    const scores={...fixedScores,[key]:100};expect(chooseFallback(scores).resourceKey).toBe(key);expect(scores[key as keyof typeof scores]).toBe(100)
  })
  it('uses fixed ties, neutral for zeros and three local labels',()=>{
    const zeros=Object.fromEntries(Object.keys(fixedScores).map(k=>[k,0])) as typeof fixedScores
    expect(chooseFallback(zeros).resourceKey).toBe('neutral');expect(chooseFallback({...zeros,vanilla:90,lemon:90}).resourceKey).toBe('vanilla');expect(localScentLabels(zeros)).toEqual(['香草','柠檬','玫瑰'])
  })
})
