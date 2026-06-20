import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatDebugConsoleOutput,
  formatDebugConsoleSessionTitle,
  isDapOutputEventMessage,
  normalizeOutputViewNewlines
} from '../src/debugConsoleModel';

describe('Go Bench debug console model', () => {
  it('recognizes DAP output events', () => {
    assert.equal(isDapOutputEventMessage({ type: 'event', event: 'output', body: { output: 'hello' } }), true);
    assert.equal(isDapOutputEventMessage({ type: 'event', event: 'stopped', body: {} }), false);
    assert.equal(isDapOutputEventMessage(undefined), false);
  });

  it('normalizes newlines for panel output', () => {
    assert.equal(normalizeOutputViewNewlines('a\nb\r\nc'), 'a\nb\nc');
  });

  it('formats stdout, stderr, telemetry, and source locations', () => {
    assert.equal(
      formatDebugConsoleOutput({ type: 'event', event: 'output', body: { category: 'stdout', output: 'ok\n' } }),
      'ok\n'
    );
    assert.equal(
      formatDebugConsoleOutput({ type: 'event', event: 'output', body: { category: 'stderr', output: 'boom\n' } }),
      '[stderr] boom\n'
    );
    assert.equal(
      formatDebugConsoleOutput({ type: 'event', event: 'output', body: { category: 'telemetry', output: 'hidden\n' } }),
      ''
    );
    assert.equal(
      formatDebugConsoleOutput({
        type: 'event',
        event: 'output',
        body: { category: 'console', output: 'hit\n', source: { path: '/tmp/main.go' }, line: 12, column: 3 }
      }),
      'hit (/tmp/main.go:12:3)\n'
    );
  });

  it('uses stable session titles for runnable debug sessions', () => {
    assert.equal(formatDebugConsoleSessionTitle('api'), 'Go Bench Debug: api');
  });
});
