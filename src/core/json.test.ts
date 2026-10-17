import { describe, expect, it } from 'vitest';
import { byteSize, foldRanges, JsonError, MAX_INPUT_BYTES, processJson, unescapeOneLayer } from './json';

describe('lossless JSON processing', () => {
  it('formats nested objects and compresses only structural whitespace', () => {
    const source = ' { "name": "张 三", "items": [1, {"ok": true}] } ';
    const result = processJson(source);
    expect(JSON.parse(result.formatted)).toEqual(JSON.parse(source));
    expect(result.compressed).toBe('{"name":"张 三","items":[1,{"ok":true}]}');
    expect(result.formatted).toContain('\n  "name": "张 三",');
    expect(result.kind).toBe('Object');
  });

  it('preserves huge integers, decimal spelling, exponents, duplicate keys and key order', () => {
    const source = '{"2": 9007199254740993123456789, "1": 1.2300, "a": 1e+999, "a": -0}';
    const result = processJson(source);
    expect(result.compressed).toBe('{"2":9007199254740993123456789,"1":1.2300,"a":1e+999,"a":-0}');
    expect(result.formatted).toContain('9007199254740993123456789');
    expect(result.formatted).toContain('1.2300');
    expect(result.formatted).toContain('1e+999');
    expect(result.formatted.match(/"a"/g)).toHaveLength(2);
  });

  it('preserves escaped quotes, control characters and paths inside string tokens', () => {
    const source = String.raw`{ "path": "C:\\Users\\name", "text": "a \"quote\"\n\t  b", "unicode": "\u4e2d" }`;
    const compressed = processJson(source).compressed;
    expect(compressed).toContain(String.raw`"path":"C:\\Users\\name"`);
    expect(compressed).toContain(String.raw`"text":"a \"quote\"\n\t  b"`);
    expect(compressed).toContain(String.raw`"unicode":"\u4e2d"`);
    expect(JSON.parse(compressed)).toEqual(JSON.parse(source));
  });

  it.each(['null', 'true', 'false', '123', '"hello"', '[]', '{}'])('supports a top-level scalar or empty container: %s', (source) => {
    expect(processJson(source).compressed).toBe(source);
  });

  it.each(['{"a":1,}', '[1,]', '{a:1}', '{"a":}', '{"a":1} {}', '// comment\n{}', '{"a":01}', '{"a":"\n"}', '', '{"a":NaN}'])('rejects invalid strict JSON: %s', (source) => {
    expect(() => processJson(source)).toThrow(JsonError);
  });

  it('reports the first error using CRLF-aware line and column positions', () => {
    try { processJson('{\r\n  "a": 1,\r\n  "b": }'); throw new Error('expected failure'); }
    catch (error) {
      expect(error).toBeInstanceOf(JsonError);
      expect((error as JsonError).problem.line).toBe(3);
      expect((error as JsonError).problem.column).toBe(8);
    }
  });

  it('computes folds without treating braces inside strings as objects', () => {
    const result = processJson('{"a":[{"text":"{ [ ] }"}], "empty":{}}');
    expect(result.folds).toHaveLength(3);
    for (const range of result.folds) {
      expect(['{', '[']).toContain(result.formatted[range.from - 1]);
      expect(['}', ']']).toContain(result.formatted[range.to]);
    }
  });

  it('applies four-space indentation and counts UTF-8 bytes', () => {
    expect(processJson('{"中":1}', 4).formatted).toContain('\n    "中": 1');
    expect(byteSize('中文')).toBe(6);
  });

  it('reports the direct length of property values and nested arrays', () => {
    const source = '{"items":[1,{"a":[true,false]},[2,3],null,"x"],"other":[{"value":1}]}';
    const result = processJson(source);
    const arrays = result.folds.filter((range) => range.arrayLength !== undefined);
    expect(arrays.map((range) => range.arrayLength)).toEqual([5, 2, 2, 1]);
    expect(result.folds.filter((range) => result.formatted[range.from - 1] === '{').every((range) => range.arrayLength === undefined)).toBe(true);
    expect(result.compressed).toBe(source);
  });

  it('does not count commas, brackets or escaped quotes inside strings as array elements', () => {
    const result = processJson(String.raw`["a,b,c", "[1,2]", "\"quoted, text\"", [], {}]`);
    expect(result.folds.find((range) => range.from === 1)?.arrayLength).toBe(5);
  });

  it('counts zero-length and single-element arrays', () => {
    expect(foldRanges('[\n]')[0].arrayLength).toBe(0);
    expect(processJson('[null]').folds[0].arrayLength).toBe(1);
    expect(processJson('{"empty":[]}').formatted).toContain('"empty": []');
  });

  it('preserves numeric tokens while counting mixed array types', () => {
    const result = processJson('[900719925474099312345,1.2300,1e+999,false,null,{"id":1},[1,2]]');
    expect(result.folds[0].arrayLength).toBe(7);
    expect(result.compressed).toContain('900719925474099312345,1.2300,1e+999');
  });

  it('handles a large JSON document while retaining the last record', () => {
    const source = '[' + Array.from({ length: 12000 }, (_, i) => `{"id":${i},"value":"hello world"}`).join(',') + ']';
    const result = processJson(source);
    expect(result.compressed).toBe(source);
    expect(result.formatted).toContain('"id": 11999');
    expect(result.folds).toHaveLength(12001);
  });

  it('rejects oversized input before parsing', () => {
    expect(() => processJson('"' + 'a'.repeat(MAX_INPUT_BYTES) + '"')).toThrow('超过 10 MB');
  });
});

describe('decode exactly one escape layer', () => {
  const original = String.raw`{"name":"张三","path":"C:\\Users\\test","quote":"say \"hello\""}`;
  it('decodes a quoted JSON string losslessly', () => {
    expect(unescapeOneLayer(JSON.stringify(original))).toBe(original);
  });
  it('decodes a log fragment without outer quotes', () => {
    const fragment = JSON.stringify(original).slice(1, -1);
    expect(unescapeOneLayer(fragment)).toBe(original);
  });
  it('supports physical newlines in unquoted log fragments', () => {
    expect(unescapeOneLayer(String.raw`{\"a\": 1,` + '\n' + String.raw`\"b\": 2}`)).toBe('{"a": 1,\n"b": 2}');
  });
  it('does not recursively decode JSON embedded inside a field', () => {
    const input = '{"data":"{\\"nested\\":1}"}';
    expect(unescapeOneLayer(JSON.stringify(input))).toBe(input);
  });
  it('decodes only one level of multiply encoded input', () => {
    expect(unescapeOneLayer(JSON.stringify(JSON.stringify(original)))).toBe(JSON.stringify(original));
  });
  it('does not delete valid backslashes from already-valid JSON', () => {
    expect(() => unescapeOneLayer(original)).toThrow('无需去除转义');
  });
  it.each(['"hello"', String.raw`{\"a\":\q}`, '{"a":', ''])('rejects decoding that would produce invalid JSON: %s', (source) => {
    expect(() => unescapeOneLayer(source)).toThrow(JsonError);
  });
});
