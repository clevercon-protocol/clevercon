import fs from 'fs';
import path from 'path';

function temporaryPathFor(filePath: string): string {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  const nonce = Math.random().toString(16).slice(2);
  return path.join(directory, `.${basename}.${process.pid}.${Date.now()}.${nonce}.tmp`);
}

export function writeJsonSafe(filePath: string, data: unknown): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });

  const tmpPath = temporaryPathFor(filePath);
  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // Preserve the original write/rename error.
    }
    throw error;
  }
}

export function createJsonWriteQueue<T>(filePath: string): (data: T) => void {
  const queue: T[] = [];
  let draining = false;

  return (data: T): void => {
    queue.push(data);

    if (draining) return;

    draining = true;
    try {
      while (queue.length > 0) {
        const next = queue.shift();
        writeJsonSafe(filePath, next);
      }
    } finally {
      draining = false;
    }
  };
}
