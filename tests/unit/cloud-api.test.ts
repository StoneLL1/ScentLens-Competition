import { describe, expect, it, vi } from 'vitest'
import { generationHandler } from '../../server/generation/handler'
import { ModelProvider } from '../../server/generation/provider'
import { callerId, interpretationPermit, redisAdmission, requireAdmission, type Admission } from '../../server/generation/security'
import { configFromEnv } from '../../server/generation/config'
import { CloudGenerationAdapter } from '../../src/services/CloudGenerationAdapter'
import { createReading } from '../../src/domain/reading'
import type { CloudAttempt } from '../../shared/generation'
import { ids, fixedScores, imageResponse, interpretation, png, testEnv } from '../fixtures/cloud'

function setup(overrides: { image?: unknown; failText?: boolean } = {}) {
  const calls: { url: string; body: Record<string, unknown> }[] = [], claims: string[] = []
  const admission: Admission = { async claim(_,stage,identity) { const key = `${stage}/${identity.attemptId}`; requireAdmission(claims.includes(key) ? 'DUPLICATE' : 'OK'); claims.push(key) } }
  const fetcher: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body)); calls.push({ url: String(url), body })
    if (overrides.failText) return new Response('sensitive-provider-error', { status: 500 })
    if (String(url).endsWith('images/generations')) return Response.json(overrides.image ?? { data: [{ b64_json: png().toString('base64') }] })
    const display = body.messages[0].content.includes('中文')
    return Response.json({ model:'actual-text-model', choices:[{ finish_reason:'stop', message: { content: display ? JSON.stringify({ title:'晨光里的柑橘与青草', keywords:['柑橘','青草'], description:'晨光中的柠檬与青草。' }) : 'A lemon in grass.\n' } }] })
  }
  const dependencies = { env:testEnv, admission: () => admission, provider:(config: ReturnType<typeof configFromEnv>)=>new ModelProvider(config,fetcher) }
  const call = async (stage:'interpret'|'image', body: unknown, headers: Record<string,string> = {}) => {
    const response = await generationHandler(stage,dependencies)(new Request(`https://app.example/api/${stage}`, { method:'POST',headers:{authorization:`Bearer ${testEnv.SCENT_ACCESS_KEY}`,'content-type':'application/json',...headers}, body: typeof body === 'string' ? body : JSON.stringify(body) }))
    const raw = await response.text()
    return { status:response.status, data:raw ? JSON.parse(raw) : null }
  }
  return { calls, claims, call, dependencies }
}
const request = () => ({ ...ids(), remainingBudgetMs:59000, scores:fixedScores, confidenceScale:'0-100',source:'mock',variantIndex:0 })

describe('TASK-05 server boundary (all providers simulated)',()=>{
  it('TASK-10 accepts 120 seconds for both stages while retaining smaller legacy budgets',async()=>{
    const s=setup(),input={...request(),remainingBudgetMs:120_000}
    const text=await s.call('interpret',input)
    expect(text.status).toBe(200)
    const body={...ids(input.recordId),interpretation:text.data.interpretation}
    const invalid=await s.call('image',{...body,remainingBudgetMs:120_001})
    expect(invalid.status).toBe(504);expect(s.calls).toHaveLength(2)
    const image=await s.call('image',{...body,remainingBudgetMs:120_000})
    expect(image.status).toBe(200);expect(s.calls).toHaveLength(3)
  })
  it('preserves raw English scene, separate Chinese provenance, signed recipe, and fixed square image parameters',async()=>{
    const s=setup(), input=request(); const text=await s.call('interpret',input)
    expect(text.status).toBe(200); expect(text.data.interpretation.scenePrompt).toBe('A lemon in grass.\n')
    expect(s.calls).toHaveLength(2); expect(s.calls[0].body.temperature).toBe(.2)
    expect(text.data.interpretation.cloud.sceneCall.modelActual).toBe('actual-text-model')
    const image=await s.call('image',{...ids(input.recordId),attemptId:input.attemptId,generationId:input.generationId,remainingBudgetMs:input.remainingBudgetMs,interpretation:text.data.interpretation})
    expect(image.status).toBe(200); expect(image.data.width).toBe(1024); expect(image.data.call.modelActual).toBeUndefined()
    expect(s.calls[2].body).toMatchObject({model:'test-image-model',size:'1024x1024',quality:'medium',output_format:'png',n:1,prompt:text.data.interpretation.finalImagePrompt})
    expect(s.claims).toHaveLength(2)
  })
  it('empty valid input preserves a distinct response and makes zero provider/quota calls',async()=>{
    const s=setup(), input={...request(),scores:Object.fromEntries(Object.keys(fixedScores).map(k=>[k,0]))};const r=await s.call('interpret',input)
    expect(r.data).toMatchObject({status:'empty',code:'EMPTY_RECIPE'});expect(s.calls).toHaveLength(0);expect(s.claims).toHaveLength(0)
  })
  it('accepts remaining budget when server time differs from the device',async()=>{
    const s=setup(),input=request()
    const now=Date.now();const clock=vi.spyOn(Date,'now').mockReturnValue(now-3600000)
    try { expect((await s.call('interpret',input)).status).toBe(200) } finally { clock.mockRestore() }
  })
  it.each(['authorization','origin'])('rejects invalid %s before any provider call',async field=>{
    const s=setup();expect((await s.call('interpret',request(),{[field]:'invalid'})).status).toBe(field==='origin'?403:401);expect(s.calls).toHaveLength(0)
  })
  it.each([{confidenceScale:'guess'},{variantIndex:-1},{model:'arbitrary'},{remainingBudgetMs:120001},{remainingBudgetMs:0},{remainingBudgetMs:1.5},{scores:{lemon:90}}])('rejects bad input %j',async patch=>{
    const s=setup();expect((await s.call('interpret',{...request(),...patch})).status).toBeGreaterThanOrEqual(400);expect(s.calls).toHaveLength(0)
  })
  it('rejects duplicate raw JSON keys',async()=>{
    const s=setup(), body=JSON.stringify(request()).replace('"source":"mock"','"source":"mock","source":"device"');expect((await s.call('interpret',body)).status).toBe(400);expect(s.calls).toHaveLength(0)
  })
  it('does not re-charge a duplicate attempt with a new request ID',async()=>{
    const s=setup(),input=request();await s.call('interpret',input);expect((await s.call('interpret',{...input,requestId:crypto.randomUUID()})).status).toBe(409);expect(s.calls).toHaveLength(2)
  })
  it.each(['prompt','reading','config','text'])('rejects tampered %s before image call',async field=>{
    const s=setup(),input=request(),r=await s.call('interpret',input),text=r.data.interpretation
    if(field==='prompt')text.finalImagePrompt='arbitrary';if(field==='reading')text.cloud.identity.recordId='other';if(field==='config')text.cloud.imageConfig.quality='high';if(field==='text')text.title='篡改标题'
    expect((await s.call('image',{...ids(input.recordId),remainingBudgetMs:input.remainingBudgetMs,interpretation:text})).status).toBe(400);expect(s.calls).toHaveLength(2)
  })
  it('rejects changed server image configuration on recovery',async()=>{
    const config=configFromEnv(testEnv),text=interpretation(ids());config.image.config.quality='high'
    const r=await generationHandler('image',{env:{...testEnv,IMAGE_QUALITY:'high'}})(new Request('https://a/api/generate-image',{method:'POST',headers:{authorization:`Bearer ${testEnv.SCENT_ACCESS_KEY}`,'content-type':'application/json'},body:JSON.stringify({...ids(),remainingBudgetMs:59000,interpretation:text})}))
    expect(r.status).toBe(400)
  })
  it('fails closed without distributed admission configuration',async()=>{
    await expect(redisAdmission(testEnv,configFromEnv(testEnv)).claim('caller','image',ids(),1,new AbortController().signal)).rejects.toMatchObject({code:'PROTECTION_UNAVAILABLE'})
  })
  it('redacts upstream errors and never automatically retries',async()=>{
    const s=setup({failText:true}),r=await s.call('interpret',request());expect(r.status).toBe(502);expect(JSON.stringify(r.data)).not.toContain('sensitive');expect(s.calls).toHaveLength(1)
  })
  it.each([{data:[{url:'https://untrusted/image.png'}]},{data:[{b64_json:png(512,256).toString('base64')}]},{data:[{b64_json:'!!!!'}]}])('rejects unsupported or non-square image payload',async image=>{
    const s=setup({image}),input=request(),text=await s.call('interpret',input);const r=await s.call('image',{...ids(input.recordId),remainingBudgetMs:input.remainingBudgetMs,interpretation:text.data.interpretation});expect(r.status).toBe(502)
  })
  it('binds permits to the caller',()=>{
    const c=configFromEnv(testEnv),t=interpretation(ids());expect(interpretationPermit(t,callerId(c,`Bearer ${c.accessKey}`),c.signingKey)).toBe(t.cloud.permit);expect(interpretationPermit(t,'different',c.signingKey)).not.toBe(t.cloud.permit)
  })
})

describe('App API validation',()=>{
  const reading=createReading({captureSessionId:'client-fixture',source:'mock',rawScores:[.1,.1,.1,.84,.1,.39,.1,.73],rawScale:'0-1',resultValid:true,preview:false,quality:'unknown'})
  const attempt=():CloudAttempt=>({recordId:reading.id,attemptId:crypto.randomUUID(),generationId:crypto.randomUUID(),interpretRequestId:crypto.randomUUID(),imageRequestId:crypto.randomUUID(),variantIndex:0,startedAt:Date.now(),deadline:Date.now()+59000,phase:'interpreting'})
  it.each(['recordId','attemptId','generationId','requestId'])('rejects wrong %s',async field=>{
    const a=attempt(),identity={recordId:a.recordId,attemptId:a.attemptId,generationId:a.generationId,requestId:a.interpretRequestId},t=interpretation(identity)
    const client=new CloudGenerationAdapter('https://app.example',async()=>Response.json({...identity,[field]:'wrong',status:'ready',interpretation:t}));client.configureAccess('test')
    await expect(client.interpret(reading,new AbortController().signal,{attempt:a})).rejects.toMatchObject({code:'IDENTITY_MISMATCH'})
  })
  it('validates image byte hash and rejects corrupt transfer',async()=>{
    const a=attempt(),t=interpretation({recordId:a.recordId,attemptId:a.attemptId,generationId:a.generationId,requestId:a.interpretRequestId}),r=imageResponse({recordId:a.recordId,attemptId:a.attemptId,generationId:a.generationId,requestId:a.imageRequestId},t)
    const fetcher=vi.fn(async()=>Response.json(r)),client=new CloudGenerationAdapter('https://app.example',fetcher);client.configureAccess('test')
    expect((await client.image(reading,new AbortController().signal,{attempt:a,interpretation:t})).blob.size).toBe(r.byteSize)
    r.sha256='0'.repeat(64);await expect(client.image(reading,new AbortController().signal,{attempt:a,interpretation:t})).rejects.toMatchObject({code:'INVALID_IMAGE'});expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
