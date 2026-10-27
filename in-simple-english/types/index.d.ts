export type RecapStatus = 'idle' | 'working' | 'summarizing' | 'done' | 'no-actions' | 'error'

export type Recap = {
  turnId: string
  status: RecapStatus
  actionCount: number
  isStopped: boolean
  text: string
}

declare module 'claude-code' {
  interface PluginState {
    'in-simple-english': { recap: Shaped<Recap> }
  }
}
