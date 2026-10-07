import { readFile, writeFile } from 'node:fs/promises'
import { parse } from 'yaml'

const source = await readFile(new URL('../config/design-tokens.yaml', import.meta.url), 'utf8')
const tokens = parse(source)
const declarations = []
for (const [group, prefix] of [['colors', 'color'], ['rounded', 'radius'], ['spacing', 'space']]) {
  for (const [name, value] of Object.entries(tokens[group])) {
    declarations.push(`  --${prefix}-${name}: ${value};`)
  }
}
for (const [name, value] of Object.entries(tokens.typography)) {
  declarations.push(`  --type-${name}: ${Number.parseFloat(value.fontSize) / 16}rem;`)
}
const css = `/* Generated from config/design-tokens.yaml. Run npm run tokens after changing the source. */\n:root {\n${declarations.join('\n')}\n}\n`
const target = new URL('../src/styles/tokens.css', import.meta.url)
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== css) throw new Error('Design tokens drifted. Run npm run tokens.')
  console.log('Design tokens match config/design-tokens.yaml')
} else await writeFile(target, css)
