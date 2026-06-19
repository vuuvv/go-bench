import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isSafeRelativePathInput,
  isSafeSingleNameInput,
  sortFileExplorerEntries,
  splitRelativePathInput
} from '../src/fileExplorerModel';

describe('Go Bench file explorer model', () => {
  it('sorts directories before files using stable natural name ordering', () => {
    assert.deepEqual(
      sortFileExplorerEntries([
        { name: 'z.go', isDirectory: false },
        { name: 'cmd10', isDirectory: true },
        { name: 'cmd2', isDirectory: true },
        { name: 'a.go', isDirectory: false }
      ]),
      [
        { name: 'cmd2', isDirectory: true },
        { name: 'cmd10', isDirectory: true },
        { name: 'a.go', isDirectory: false },
        { name: 'z.go', isDirectory: false }
      ]
    );
  });

  it('splits user relative path input into Uri.joinPath segments', () => {
    assert.deepEqual(splitRelativePathInput(' cmd / api / main.go '), ['cmd', 'api', 'main.go']);
    assert.deepEqual(splitRelativePathInput('internal'), ['internal']);
  });

  it('rejects unsafe file creation and rename inputs', () => {
    assert.equal(isSafeRelativePathInput('main.go'), true);
    assert.equal(isSafeRelativePathInput('cmd/api/main.go'), true);
    assert.equal(isSafeRelativePathInput(''), false);
    assert.equal(isSafeRelativePathInput('/tmp/main.go'), false);
    assert.equal(isSafeRelativePathInput('../main.go'), false);
    assert.equal(isSafeRelativePathInput('cmd/../main.go'), false);
    assert.equal(isSafeRelativePathInput('C:/tmp/main.go'), false);
    assert.equal(isSafeRelativePathInput('cmd\\main.go'), false);
  });

  it('accepts only same-directory names for rename input', () => {
    assert.equal(isSafeSingleNameInput('main.go'), true);
    assert.equal(isSafeSingleNameInput('cmd/main.go'), false);
    assert.equal(isSafeSingleNameInput('../main.go'), false);
  });
});
