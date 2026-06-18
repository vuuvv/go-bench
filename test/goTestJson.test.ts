/**
 * `go test -json` 解析测试。
 *
 * 这些断言保护 Test Explorer 运行结果映射：Testing API 适配层依赖这里把 Go 事件流转换为稳定的
 * test name 和 output 记录，再更新每个子测试节点的状态与 Test Results 输出。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildGoTestJsonTestName,
  GoTestJsonStreamParser,
  parseGoTestJsonOutput,
  type GoTestJsonStreamRecord
} from '../src/goTestJson';

describe('go test json event parsing', () => {
  it('builds Go JSON test names with testing package rewrites', () => {
    assert.equal(
      buildGoTestJsonTestName({
        testName: 'TestNormalize',
        subtestPath: ['empty input', 'url path /api/v1']
      }),
      'TestNormalize/empty_input/url_path_/api/v1'
    );
  });

  it('parses complete JSON lines and preserves non-JSON output as raw records', () => {
    const records = parseGoTestJsonOutput(
      [
        '{"Action":"run","Package":"example.test","Test":"TestNormalize"}',
        'plain toolchain output',
        '{"Action":"output","Package":"example.test","Test":"TestNormalize/empty","Output":"--- PASS\\n"}'
      ].join('\n')
    );

    assert.deepEqual(records, [
      {
        kind: 'event',
        event: {
          Action: 'run',
          Package: 'example.test',
          Test: 'TestNormalize'
        }
      },
      {
        kind: 'raw',
        line: 'plain toolchain output'
      },
      {
        kind: 'event',
        event: {
          Action: 'output',
          Package: 'example.test',
          Test: 'TestNormalize/empty',
          Output: '--- PASS\n'
        }
      }
    ]);
  });

  it('keeps partial chunk boundaries until a full JSON line arrives', () => {
    const parser = new GoTestJsonStreamParser();
    const first = parser.push('{"Action":"run","Test":"Test');
    const second = parser.push('Normalize"}\n{"Action":"pass","Elapsed":0.01');
    const third = parser.push(',"Test":"TestNormalize"}\n');
    const records: GoTestJsonStreamRecord[] = [...first, ...second, ...third, ...parser.flush()];

    assert.deepEqual(records, [
      {
        kind: 'event',
        event: {
          Action: 'run',
          Test: 'TestNormalize'
        }
      },
      {
        kind: 'event',
        event: {
          Action: 'pass',
          Elapsed: 0.01,
          Test: 'TestNormalize'
        }
      }
    ]);
  });
});
