export interface HelloEvent {
  event: string
  args: unknown[]
}

export interface JiraTodo {
  key: string
  summary: string
  typeName: string
  typeColor: string
  typeIconUrl: string
  statusName: string
}

export interface JiraAnalysis {
  key: string
  summary: string
  analysis: string
}
