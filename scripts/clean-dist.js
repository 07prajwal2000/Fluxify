import fs from 'fs';
import path from 'path';

// The starting directory (current folder)
const rootDir = process.cwd();

function deleteDistFolders(currentDir) {
  // Read directory contents
  let items;
  try {
    items = fs.readdirSync(currentDir);
  } catch (e) {
    // Handle permission errors or locked folders gracefully
    console.error(`Could not read ${currentDir}: ${e.message}`);
    return;
  }

  items.forEach(item => {
    const fullPath = path.join(currentDir, item);
    let stat;

    try {
      stat = fs.statSync(fullPath);
    } catch (e) {
      return; // Skip if we can't read stats
    }

    if (stat.isDirectory()) {
      // 1. SKIP node_modules
      if (item === 'node_modules') {
        return;
      }

      // 2. DELETE dist folders
      if (item === 'dist' || item === ".next") {
        console.log(`Deleting: ${fullPath}`);
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } catch (err) {
          console.error(`Failed to delete ${fullPath}: ${err.message}`);
        }
      }
      // 3. RECURSE into other subfolders
      else {
        deleteDistFolders(fullPath);
      }
    }
  });
}

console.log('--- Scanning for dist folders ---');
deleteDistFolders(rootDir);
console.log('--- Cleanup Complete ---');