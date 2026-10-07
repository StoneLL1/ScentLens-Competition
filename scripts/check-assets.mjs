import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const manifest = JSON.parse(await readFile('public/assets/manifest.json', 'utf8'))
for (const asset of manifest.assets) {
  const bytes = await readFile(`public${asset.path}`)
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
    throw new Error(`Asset integrity mismatch: ${asset.id}`)
  }
}
const presets = manifest.assets.filter((asset) => asset.role === 'local-preset')
if (presets.length !== 9) throw new Error('Expected eight dimension presets and one neutral preset')
console.log(`${manifest.assets.length} local assets verified; nine presets available offline`)
const core = JSON.parse(await readFile('src/vendor/scent-profile.provenance.json', 'utf8'))
for (const file of core.files) {
  const bytes = await readFile(`src/vendor/scent-profile/${file.path}`)
  if (createHash('sha256').update(bytes).digest('hex') !== (file.adaptation?.sha256 ?? file.sha256)) throw new Error(`Scent profile recorded source/adapter changed: ${file.path}`)
}
console.log(`${core.files.length} scent-profile files match recorded hashes (${core.files.filter(file => file.adaptation).length} documented App adaptation)`)
const translation = JSON.parse(await readFile('server/scent-translation/provenance.json', 'utf8'))
for (const asset of translation.assets) {
  const bytes = await readFile(`server/scent-translation/assets/${asset.file}`)
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`Translation asset changed: ${asset.file}`)
}
console.log(`${translation.assets.length} scent-translation config/prompt assets match the recorded reference hashes`)
