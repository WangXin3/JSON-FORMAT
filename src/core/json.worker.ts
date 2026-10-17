import { JsonError, processJson, unescapeOneLayer } from './json';

self.onmessage = (event: MessageEvent<{ id: number; text: string; unescape?: boolean; indent: number }>) => {
  const { id, text, indent } = event.data;
  try {
    const source = event.data.unescape ? unescapeOneLayer(text) : text;
    self.postMessage({ id, source, result: processJson(source, indent) });
  } catch (error) {
    self.postMessage({ id, problem: error instanceof JsonError ? error.problem : {
      message: '内容嵌套过深或无法处理，请检查 JSON', line: 1, column: 1, offset: 0,
    } });
  }
};
