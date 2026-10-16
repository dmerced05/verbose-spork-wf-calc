// runs Compare tab requests off the main thread so the page doesn't freeze while it searches
import { runPath, type CompareRequest, type CompareResult } from './compare'

export type CompareMessage =
  | { type: 'progress'; id: number; done: number; total: number; result: CompareResult }
  | { type: 'done'; id: number }
  | { type: 'error'; id: number; message: string }

self.onmessage = (event: MessageEvent<{ id: number; request: CompareRequest }>) => {
  const { id, request } = event.data
  const jobs = request.boards.flatMap((board) => request.paths.map((_, pathIndex) => ({ board, pathIndex })))
  try {
    jobs.forEach(({ board, pathIndex }, index) => {
      const result = runPath(request, pathIndex, board)
      self.postMessage({ type: 'progress', id, done: index + 1, total: jobs.length, result } satisfies CompareMessage)
    })
    self.postMessage({ type: 'done', id } satisfies CompareMessage)
  } catch (error) {
    self.postMessage({ type: 'error', id, message: String(error) } satisfies CompareMessage)
  }
}
