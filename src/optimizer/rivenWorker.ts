// runs the Rivens page's god-roll search off the main thread, it's ~100 optimizer runs
import { searchRivens, type RivenProgress, type RivenSearchRequest, type RivenSearchResult } from './rivenSearch'

export type RivenMessage =
  | { type: 'progress'; id: number; progress: RivenProgress }
  | { type: 'done'; id: number; result: RivenSearchResult }
  | { type: 'error'; id: number; message: string }

self.onmessage = (event: MessageEvent<{ id: number; request: RivenSearchRequest }>) => {
  const { id, request } = event.data
  try {
    const result = searchRivens(request, (progress) => self.postMessage({ type: 'progress', id, progress } satisfies RivenMessage))
    self.postMessage({ type: 'done', id, result } satisfies RivenMessage)
  } catch (error) {
    self.postMessage({ type: 'error', id, message: String(error) } satisfies RivenMessage)
  }
}
