import { cn } from "@/lib/utils"

/**
 * Generative, theme-aware cover art for a project. Derived from the slug so
 * each project gets a stable, distinct "topology" without bespoke artwork.
 */
function seeded(slug: string) {
  let h = 2166136261
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    return ((h >>> 0) % 10_000) / 10_000
  }
}

export function ProjectCover({
  slug,
  hue,
  className,
  density = 7,
}: {
  slug: string
  hue: number
  className?: string
  density?: number
}) {
  const rand = seeded(slug)
  const cols = 6
  const nodes = Array.from({ length: density }, (_, i) => ({
    x: 30 + ((i % cols) * 340) / (cols - 1) + (rand() - 0.5) * 30,
    y: 28 + rand() * 104,
    r: 2.5 + rand() * 2.5,
    hot: rand() > 0.7,
  }))
  const links = nodes.slice(1).map((node, i) => {
    const target = nodes[Math.floor(rand() * (i + 1))]
    return { a: target, b: node }
  })

  const accent = `oklch(var(--cover-l) var(--cover-c) ${hue})`

  return (
    <div
      className={cn("relative overflow-hidden bg-sunken", className)}
      style={{ color: accent }}
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-dots opacity-70" />
      <div
        className="absolute inset-0 opacity-60"
        style={{
          background: `radial-gradient(120% 90% at 85% 0%, oklch(var(--cover-l) var(--cover-c) ${hue} / 0.16), transparent 60%)`,
        }}
      />
      <svg viewBox="0 0 400 160" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full">
        {links.map(({ a, b }, i) => (
          <path
            key={i}
            d={`M${a.x} ${a.y} C ${(a.x + b.x) / 2} ${a.y}, ${(a.x + b.x) / 2} ${b.y}, ${b.x} ${b.y}`}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.35}
            strokeWidth={1}
            strokeDasharray={i % 3 === 0 ? "3 4" : undefined}
          />
        ))}
        {nodes.map((node, i) => (
          <g key={i}>
            {node.hot && <circle cx={node.x} cy={node.y} r={node.r * 3} fill="currentColor" fillOpacity={0.12} />}
            <circle
              cx={node.x}
              cy={node.y}
              r={node.r}
              className="fill-card"
              stroke="currentColor"
              strokeWidth={1.5}
            />
          </g>
        ))}
      </svg>
    </div>
  )
}
