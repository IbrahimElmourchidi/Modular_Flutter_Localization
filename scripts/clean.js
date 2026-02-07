#!/usr/bin/env node

/**
 * Cross-platform clean script
 * Removes build artifacts safely on both Windows and Unix systems
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

/**
 * Recursively delete a directory
 */
function deleteDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return;
  }

  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    console.log(`✓ Deleted directory: ${path.relative(rootDir, dirPath)}`);
  } catch (error) {
    console.error(`✗ Failed to delete ${dirPath}:`, error.message);
  }
}

/**
 * Delete files matching a pattern
 */
function deleteFiles(pattern) {
  const files = fs.readdirSync(rootDir);
  let deletedCount = 0;

  files.forEach(file => {
    if (file.match(pattern)) {
      const filePath = path.join(rootDir, file);
      try {
        fs.unlinkSync(filePath);
        console.log(`✓ Deleted file: ${file}`);
        deletedCount++;
      } catch (error) {
        console.error(`✗ Failed to delete ${file}:`, error.message);
      }
    }
  });

  if (deletedCount === 0) {
    console.log(`  No files matching ${pattern.source} found`);
  }
}

console.log('\n🧹 Cleaning build artifacts...\n');

// Delete directories
deleteDirectory(path.join(rootDir, 'out'));

// Delete .vsix files
deleteFiles(/\.vsix$/);

console.log('\n✓ Clean completed\n');