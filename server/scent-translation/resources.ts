import { readFileSync } from 'node:fs'
import { canonicalJson, parseJsonWithNumbers, sha256 } from './primitives.ts'
import { TranslationError } from './types.ts'

const assetUrl = (file: string) => new URL(`./assets/${file}`, import.meta.url)
export const PROMPT_NAMES = ['scene_simplifier_instruction', 'project_scene_constraints', 'style_photographic', 'style_ascii', 'scene_constraints'] as const
const provenance = JSON.parse(readFileSync(new URL('./provenance.json', import.meta.url), 'utf8')) as {
  assets: { file: string; sha256: string }[]; promptRuntimeDigests: Record<string, string>
}
const buffers = Object.fromEntries(provenance.assets.map(({ file, sha256: expected }) => {
  const bytes = readFileSync(assetUrl(file))
  if (sha256(bytes) !== expected) throw new TranslationError('INVALID_CONFIG', `Frozen asset differs: ${file}`)
  return [file, bytes]
}))
const read = <T>(name: string) => parseJsonWithNumbers(buffers[name].toString('utf8')).value as T
export const rules = read<typeof import('./assets/rules.json')>('rules.json')
export const catalog = read<typeof import('./assets/scent_motifs.json')>('scent_motifs.json')
export const templates = read<typeof import('./assets/composition_templates.json')>('composition_templates.json')
export const compatibility = read<typeof import('./assets/compatibility.json')>('compatibility.json')
export const atmosphere = read<typeof import('./assets/scent_atmosphere.json')>('scent_atmosphere.json')
export const manifest = read<typeof import('./assets/prompt_manifest.json')>('prompt_manifest.json')
export const prompts = Object.fromEntries(PROMPT_NAMES.map(name => {
  // Python text-mode universal newlines, followed only by rstrip('\n').
  const text = buffers[`${name}.txt`].toString('utf8').replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  if (sha256(buffers[`${name}.txt`]) !== manifest[name].sha256 || sha256(text) !== provenance.promptRuntimeDigests[name]) {
    throw new TranslationError('INVALID_CONFIG', `Prompt digest differs: ${name}`)
  }
  return [name, text]
})) as Record<typeof PROMPT_NAMES[number], string>

const excluded = new Set(['prompt_mode', 'scene_input_version', 'llm_instruction_version', 'llm_timeout_ms',
  'llm_auto_retry_count', 'style_version', 'ascii_enabled', 'aspect_ratio', 'scent_labels'])
const canonicalParts = Object.fromEntries([
  ['rules', 'rules.json'], ['motifs', 'scent_motifs.json'], ['templates', 'composition_templates.json'], ['compatibility', 'compatibility.json'],
].map(([key, file]) => {
  const parsed = parseJsonWithNumbers(buffers[file].toString('utf8'))
  if (key === 'rules') for (const excludedKey of excluded) delete (parsed.value as Record<string, unknown>)[excludedKey]
  return [key, canonicalJson(parsed.value, parsed.floatPaths)]
}))
export const planningCanonical = `{${Object.keys(canonicalParts).sort().map(k => `${JSON.stringify(k)}:${canonicalParts[k]}`).join(',')}}`
export const planningDigest = sha256(planningCanonical)

export const resourceSnapshot = {
  engine_version: rules.engine_version, config_version: rules.config_version,
  catalog_version: catalog.catalog_version, composition_version: templates.version, compatibility_version: compatibility.version,
  atmosphere_version: atmosphere.version, scene_input_version: rules.scene_input_version,
  llm_instruction_version: rules.llm_instruction_version, style_version: rules.style_version,
  planning_config_digest: planningDigest,
  asset_bytes_sha256: Object.fromEntries(provenance.assets.map(a => [a.file, a.sha256])),
  prompt_runtime_sha256: Object.fromEntries(PROMPT_NAMES.map(name => [name, sha256(prompts[name])])),
  prompt_digest_convention: 'UTF-8; universal newlines; strip trailing LF only',
}

function deepFreeze(value: object) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child)
  Object.freeze(value)
}
for (const resource of [rules, catalog, templates, compatibility, atmosphere, manifest, prompts, resourceSnapshot]) deepFreeze(resource)
