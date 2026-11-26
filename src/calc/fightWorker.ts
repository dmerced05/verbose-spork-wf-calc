// runs the damage simulator's fights off the main thread, like the Compare tab's worker
import { simulateFight, type FightSetup, type FightSummary } from './fight'

export type FightMessage =
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'done'; id: number; summary: FightSummary; ms: number }
  | { type: 'error'; id: number; message: string }

self.onmessage = (event: MessageEvent<{ id: number; setup: FightSetup }>) => {
  const { id, setup } = event.data
  const started = performance.now()
  try {
    const summary = simulateFight(setup, (done) => self.postMessage({ type: 'progress', id, done, total: setup.runs } satisfies FightMessage))
    self.postMessage({ type: 'done', id, summary, ms: performance.now() - started } satisfies FightMessage)
  } catch (error) {
    self.postMessage({ type: 'error', id, message: String(error) } satisfies FightMessage)
  }
}
