import type { JsonProblem, JsonResult } from './json';

export type ProcessResponse = { id: number; source?: string; result?: JsonResult; problem?: JsonProblem };

export class JsonProcessor {
  private worker: Worker;
  private counter = 0;
  private pending = new Map<number, { resolve: (r: ProcessResponse) => void; reject: (e: Error) => void }>();
  constructor() {
    this.worker = new Worker(new URL('./json.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<ProcessResponse>) => {
      this.pending.get(e.data.id)?.resolve(e.data);
      this.pending.delete(e.data.id);
    };
    this.worker.onerror = () => {
      this.pending.forEach(({ reject }) => reject(new Error('处理进程发生错误，请重新打开应用')));
      this.pending.clear();
    };
  }
  run(text: string, indent: number, unescape = false): Promise<ProcessResponse> {
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, text, indent, unescape });
    });
  }
  destroy() {
    this.worker.terminate();
    this.pending.forEach(({ reject }) => reject(new Error('处理已取消')));
    this.pending.clear();
  }
}
