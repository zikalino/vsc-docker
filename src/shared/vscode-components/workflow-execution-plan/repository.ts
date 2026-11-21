import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export function getRootFolder(): string {
  const config = vscode.workspace.getConfiguration('opera-workbench');
  const root = config.get<string>('rootFolder') || defaultRootFolder();
  // Best-effort: make sure the root folder exists (fresh installs may not have it).
  try {
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
    }
  } catch {
    // Ignore — callers that need the folder will surface their own error.
  }
  return root;
}

/**
 * Platform-appropriate default for `opera-workbench.rootFolder`:
 * Windows → `c:/devx`, macOS/Linux → `<home>/devx`.
 */
export function defaultRootFolder(): string {
  return process.platform === 'win32' ? 'c:/devx' : path.join(os.homedir(), 'devx');
}
