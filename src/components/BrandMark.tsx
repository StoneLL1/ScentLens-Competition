export function BrandMark({ className = '' }: { className?: string }) {
  return <span className={`brand-mark ${className}`} aria-hidden="true">
    {[52, 72, 88, 72, 52].map((height, index) => <i key={index} style={{ height: `${height / 116 * 100}%` }} />)}
  </span>
}
