/**
 * Path handling utilities
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Normalize and validate output path
 * - Resolves relative paths
 * - Creates parent directories if needed
 * - Returns absolute path
 */
export function normalizeAndValidatePath(outputPath: string, baseDir?: string): string {
  // Resolve relative paths
  let resolvedPath: string;
  if (path.isAbsolute(outputPath)) {
    resolvedPath = outputPath;
  } else {
    resolvedPath = path.resolve(baseDir || process.cwd(), outputPath);
  }

  // Ensure parent directory exists
  const parentDir = path.dirname(resolvedPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  return resolvedPath;
}

/**
 * Generate a unique file path to avoid overwriting
 * If file.mp4 exists, returns file_1.mp4, file_2.mp4, etc.
 */
export function generateUniqueFilePath(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    return filePath;
  }

  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);

  let counter = 1;
  let uniquePath = filePath;

  while (fs.existsSync(uniquePath)) {
    uniquePath = path.join(dir, `${base}_${counter}${ext}`);
    counter++;
  }

  return uniquePath;
}

/**
 * Get a display-friendly relative path
 */
export function getDisplayPath(absolutePath: string, baseDir?: string): string {
  const base = baseDir || process.cwd();
  const relativePath = path.relative(base, absolutePath);

  // If the relative path goes up too many levels, use absolute
  if (relativePath.startsWith('..\\..\\..') || relativePath.startsWith('../../..')) {
    return absolutePath;
  }

  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

/**
 * Generate a default output path with timestamp
 */
export function generateDefaultOutputPath(outputDir: string, prefix: string = 'video'): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${prefix}_${timestamp}.mp4`;
  return path.join(outputDir, filename);
}

/**
 * Ensure file has .mp4 extension
 */
export function ensureVideoExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp4') {
    return filePath;
  }
  if (ext === '') {
    return `${filePath}.mp4`;
  }
  // Replace other extensions with .mp4
  return `${filePath.slice(0, -ext.length)}.mp4`;
}

/**
 * Check if path is within a base directory
 */
export function isPathWithinBase(targetPath: string, baseDir: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedBase = path.resolve(baseDir);
  // path.relative avoids false positives from prefix matching
  // (e.g. /output-evil vs /output)
  const relative = path.relative(resolvedBase, resolvedTarget);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Ensure directory exists
 */
export function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
