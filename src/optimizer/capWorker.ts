// runs the Damage Cap ladder off the main thread
import { runCapLadder, type CapPath, type CapRequest, type CapStepResult } from './damageCap'

export type CapMessage =
  | { type: 'step'; id: number; result: CapStepResult }
  | { type: 'paths'; id: number; paths: CapPath[]; defaultPath: number }
  | { type: 'done'; id: number }
  | { type: 'error'; id: number; message: string }

self.onmessage = (event: MessageEvent<{ id: number; request: CapRequest }>) => {
  const { id, request } = event.data
  try {
    runCapLadder(
      request,
      (result) => self.postMessage({ type: 'step', id, result } satisfies CapMessage),
      (paths, defaultPath) => self.postMessage({ type: 'paths', id, paths, defaultPath } satisfies CapMessage),
    )
    self.postMessage({ type: 'done', id } satisfies CapMessage)
  } catch (error) {
    self.postMessage({ type: 'error', id, message: String(error) } satisfies CapMessage)
  }
}
