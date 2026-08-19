/**
 * Safe JSON file write with atomic rename to prevent corruption.
 *
 * Writes to a .tmp file first, then atomically renames it to the target path.
 * On POSIX systems, `rename` is atomic — if the process crashes mid-write,
 * the original file is preserved intact.
 *
 * @param filePath - Absolute or relative path to the target JSON file.
 * @param data - Serializable value to write.
 */
import fs from 'fs';
import path from 'path';

export function writeJsonSafe(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}
