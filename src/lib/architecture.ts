export type ArchitectureNode = {
  id: string
  label: string
  detail?: string
  /** Column index into `ArchitectureDiagram.lanes`. */
  lane: number
  kind?: "client" | "platform" | "service" | "external" | "data"
}

export type ArchitectureDiagram = {
  lanes: string[]
  nodes: ArchitectureNode[]
  edges: { from: string; to: string; label?: string }[]
}
