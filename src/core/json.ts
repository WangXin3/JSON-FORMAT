import { createScanner, format, printParseErrorCode, SyntaxKind, visit, type ParseErrorCode } from 'jsonc-parser';

export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const AUTO_PREVIEW_LIMIT = 512 * 1024;
export type FoldRange = { from: number; to: number; arrayLength?: number };
export type JsonResult = {
  formatted: string;
  compressed: string;
  folds: FoldRange[];
  bytes: number;
  lines: number;
  kind: string;
};
export type JsonProblem = { message: string; offset: number; line: number; column: number };

export class JsonError extends Error {
  problem: JsonProblem;
  constructor(message: string, text: string, offset = 0) {
    super(message);
    this.name = 'JsonError';
    const before = text.slice(0, offset).split(/\r\n|\r|\n/);
    this.problem = { message, offset, line: before.length, column: before.at(-1)!.length + 1 };
  }
}

const messages: Record<string, string> = {
  InvalidSymbol: '存在无效字符', InvalidNumberFormat: '数字格式不正确',
  PropertyNameExpected: '需要用双引号包裹属性名', ValueExpected: '此处缺少 JSON 值',
  ColonExpected: '属性名后缺少冒号 :', CommaExpected: '元素之间缺少逗号 ,',
  CloseBraceExpected: '缺少右花括号 }', CloseBracketExpected: '缺少右方括号 ]',
  EndOfFileExpected: 'JSON 结束后存在多余内容', InvalidCommentToken: '标准 JSON 不支持注释',
  UnexpectedEndOfComment: '注释没有结束', UnexpectedEndOfString: '字符串缺少结束引号',
  UnexpectedEndOfNumber: '数字不完整', InvalidUnicode: 'Unicode 转义不正确',
  InvalidEscapeCharacter: '字符串包含无效转义', InvalidCharacter: '字符串中存在未转义的控制字符',
};

export function byteSize(text: string): number { return new TextEncoder().encode(text).length; }

export function validate(text: string): void {
  if (!text.trim()) throw new JsonError('请输入 JSON 内容', text);
  if (byteSize(text) > MAX_INPUT_BYTES) throw new JsonError('内容超过 10 MB，请缩小后再处理', text);
  let first: { code: ParseErrorCode; offset: number } | undefined;
  // Validation only: never materialize numbers as JavaScript values.
  visit(text, { onError: (code, offset) => { first ??= { code, offset }; } }, {
    disallowComments: true, allowTrailingComma: false, allowEmptyContent: false,
  });
  if (first) {
    const code = printParseErrorCode(first.code);
    throw new JsonError(messages[code] ?? `JSON 语法错误：${code}`, text, first.offset);
  }
}

export function compress(text: string): string {
  const scanner = createScanner(text, false);
  const parts: string[] = [];
  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    if (token !== SyntaxKind.Trivia && token !== SyntaxKind.LineBreakTrivia) {
      parts.push(text.slice(scanner.getTokenOffset(), scanner.getTokenOffset() + scanner.getTokenLength()));
    }
  }
  return parts.join('');
}

export function foldRanges(text: string): FoldRange[] {
  const scanner = createScanner(text, true);
  const stack: { from: number; line: number; arrayLength?: number }[] = [];
  const ranges: FoldRange[] = [];
  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    const parent = stack.at(-1);
    // Count only direct array values. Containers count once, regardless of their children.
    if (parent?.arrayLength !== undefined && (
      token === SyntaxKind.OpenBraceToken || token === SyntaxKind.OpenBracketToken ||
      token === SyntaxKind.StringLiteral || token === SyntaxKind.NumericLiteral ||
      token === SyntaxKind.TrueKeyword || token === SyntaxKind.FalseKeyword || token === SyntaxKind.NullKeyword
    )) parent.arrayLength++;
    if (token === SyntaxKind.OpenBraceToken || token === SyntaxKind.OpenBracketToken) {
      stack.push({
        from: scanner.getTokenOffset() + 1,
        line: scanner.getTokenStartLine(),
        ...(token === SyntaxKind.OpenBracketToken ? { arrayLength: 0 } : {}),
      });
    } else if (token === SyntaxKind.CloseBraceToken || token === SyntaxKind.CloseBracketToken) {
      const frame = stack.pop()!;
      const to = scanner.getTokenOffset();
      if (to > frame.from && scanner.getTokenStartLine() > frame.line) {
        ranges.push({ from: frame.from, to, ...(frame.arrayLength !== undefined ? { arrayLength: frame.arrayLength } : {}) });
      }
    }
  }
  return ranges.sort((a, b) => a.from - b.from);
}

export function processJson(text: string, indent = 2): JsonResult {
  validate(text);
  const clean = text.trim();
  const edits = format(clean, undefined, {
    insertSpaces: true, tabSize: indent, eol: '\n', keepLines: false,
  }).sort((a, b) => a.offset - b.offset);
  // Applying edits one by one repeatedly copies the whole document (quadratic).
  const parts: string[] = [];
  let offset = 0;
  for (const edit of edits) {
    parts.push(clean.slice(offset, edit.offset), edit.content);
    offset = edit.offset + edit.length;
  }
  parts.push(clean.slice(offset));
  const formatted = parts.join('');
  const first = clean[0];
  const kind = first === '{' ? 'Object' : first === '[' ? 'Array' : first === '"' ? 'String'
    : first === 'n' ? 'Null' : first === 't' || first === 'f' ? 'Boolean' : 'Number';
  return { formatted, compressed: compress(clean), folds: foldRanges(formatted), bytes: byteSize(text), lines: formatted.split('\n').length, kind };
}

export function unescapeOneLayer(text: string): string {
  const clean = text.trim();
  if (!clean) throw new JsonError('请输入需要去除转义的 JSON', text);
  if (byteSize(text) > MAX_INPUT_BYTES) throw new JsonError('内容超过 10 MB，请缩小后再处理', text);
  let decoded: unknown;
  try {
    if (clean.startsWith('"')) {
      decoded = JSON.parse(clean);
    } else {
      try {
        validate(clean);
        throw new JsonError('当前已经是有效 JSON，无需去除转义', text);
      } catch (error) {
        if (error instanceof JsonError && error.message.includes('无需')) throw error;
      }
      // A log fragment may omit the surrounding quotes and contain physical line breaks.
      decoded = JSON.parse('"' + clean.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"');
    }
  } catch (error) {
    if (error instanceof JsonError) throw error;
    throw new JsonError('无法去除转义，请检查双引号和反斜杠是否配对', text);
  }
  if (typeof decoded !== 'string') throw new JsonError('输入不是经过转义的 JSON 字符串', text);
  try { validate(decoded); }
  catch { throw new JsonError('去除一层转义后不是有效 JSON，原始内容已保留', text); }
  return decoded;
}
