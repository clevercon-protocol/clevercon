import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createJsonWriteQueue, writeJsonSafe } from './json-store.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clevercon-json-store-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('writeJsonSafe', () => {
  it('writes formatted JSON through an atomic temp-file rename', () => {
    const filePath = path.join(makeTempDir(), 'nested', 'state.json');

    writeJsonSafe(filePath, { ok: true, count: 2 });

    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({ ok: true, count: 2 });
    expect(fs.readdirSync(path.dirname(filePath)).filter((name) => name.endsWith('.tmp'))).toEqual(
      [],
    );
  });
});

describe('createJsonWriteQueue', () => {
  it('serializes writes and leaves the last queued value on disk', () => {
    const filePath = path.join(makeTempDir(), 'registry.json');
    const save = createJsonWriteQueue<Array<{ id: string }>>(filePath);

    save([{ id: 'agent-a' }]);
    save([{ id: 'agent-a' }, { id: 'agent-b' }]);

    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual([
      { id: 'agent-a' },
      { id: 'agent-b' },
    ]);
  });
});
