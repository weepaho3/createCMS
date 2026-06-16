import { access } from 'node:fs/promises';

/** Returns true if a file/path exists and is accessible. */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
