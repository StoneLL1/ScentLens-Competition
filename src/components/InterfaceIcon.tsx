import type { SVGProps } from 'react'

// One stroke family for the small actions surrounding the original Figma assets.
const paths = {
  next: 'm8 5 5 5-5 5',
  outward: 'M5 15 15 5M5 5h10v10',
  save: 'M10 3v9m-3-3 3 3 3-3M4 13v4h12v-4',
  share: 'M10 12V2m-3 3 3-3 3 3M6 8H4v10h12V8h-2',
  versions: 'm3 7 7-4 7 4-7 4-7-4Zm0 4 7 4 7-4M3 15l7 4 7-4',
  bookmark: 'M5 3h10v14l-5-3-5 3V3Z',
  check: 'm4 10 4 4 8-8',
} as const

export function InterfaceIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>
}
