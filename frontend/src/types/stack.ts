export type StackStatus = 'running' | 'partial' | 'stopped'

export type Stack = {
  id: string
  name: string
  project: string
  environment: string
  services: string[]
  totalServices: number
  runningServices: number
  network?: string
  status: StackStatus
}
