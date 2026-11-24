import * as vscode from 'vscode';
import type { ExtensionContext } from 'vscode';
import * as cp from 'child_process';

import { runCreateContainerWorkflow, runCommitContainerWorkflow, runLoadImageWorkflow, runImportImageWorkflow } from './dockerWorkflows';
import { resolveJsonPath } from './jsonPath';
import { DockerTreeProvider, DockerTreeItem } from './treeProvider';
import { DockerDetailPanel } from './detailWebview';
import { DockerExplorerView } from './dockerExplorerView';
import { openImageTable, refreshImageTable } from './tableViewImages';
import { openContainerTable } from './tableViewContainers';
import { openHubSearch } from './hubSearchTable';
import { attachContainerTerminal, terminalChangedShellIntegration, terminalDidClose } from './terminal';

export function activate (context: ExtensionContext) {

  // -----------------------------------------------------------------------
  // Sidebar view
  // -----------------------------------------------------------------------

  const treeProvider = new DockerTreeProvider(context.extensionPath);
  const dockerView = new DockerExplorerView(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DockerExplorerView.viewType, dockerView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // -----------------------------------------------------------------------
  // Terminal shell integration — routes command execution to "Docker Runner"
  // terminal for user visibility.
  // -----------------------------------------------------------------------

  context.subscriptions.push(
    vscode.window.onDidChangeTerminalShellIntegration(async e => {
      terminalChangedShellIntegration(e.shellIntegration);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal(async e => {
      terminalDidClose(e);
    })
  );

  // -- selection → detail webview -----------------------------------------

  const detailPanel = DockerDetailPanel.getInstance(context.extensionPath);

  // -----------------------------------------------------------------------
  // Refresh
  // -----------------------------------------------------------------------

  registerCommand(context, 'vscode-docker-runner.refresh', () => {
    dockerView.refresh();
  });

  // -----------------------------------------------------------------------
  // Inline [...] context menu
  // -----------------------------------------------------------------------

  registerCommand(context, 'vscode-docker-runner.showContextMenu', (item?: DockerTreeItem) => {
    if (!item) { return; }
    const type = item.data.type || '';

    const actions: { label: string; command: string; args?: any[] }[] = [];

    if (type === 'docker-image') {
      actions.push({ label: '$(eye) View Details', command: 'vscode-docker-runner.viewItem' });
      actions.push({ label: '$(play) Create Container', command: 'vscode-docker-runner.createContainer' });
      actions.push({ label: '$(note) Create Dockerfile', command: 'vscode-docker-runner.createDockerfile' });
      actions.push({ label: '$(cloud-download) Pull Newer Version', command: 'vscode-docker-runner.pullImage' });
      actions.push({ label: '$(cloud-upload) Push to Registry', command: 'vscode-docker-runner.pushImage' });
      actions.push({ label: '$(save) Save to tar File', command: 'vscode-docker-runner.saveImage' });
      actions.push({ label: '$(trash) Delete', command: 'vscode-docker-runner.deleteItem' });
    } else if (type === 'docker-container') {
      actions.push({ label: '$(eye) View Details', command: 'vscode-docker-runner.viewItem' });
      actions.push({ label: '$(debug-start) Start', command: 'vscode-docker-runner.startContainer' });
      actions.push({ label: '$(debug-stop) Stop', command: 'vscode-docker-runner.stopContainer' });
      actions.push({ label: '$(debug-restart) Restart', command: 'vscode-docker-runner.restartContainer' });
      actions.push({ label: '$(debug-pause) Pause', command: 'vscode-docker-runner.pauseContainer' });
      actions.push({ label: '$(debug-continue) Unpause', command: 'vscode-docker-runner.unpauseContainer' });
      actions.push({ label: '$(terminal) Attach Terminal', command: 'vscode-docker-runner.attachTerminal' });
      actions.push({ label: '$(file-directory) Browse Filesystem', command: 'vscode-docker-runner.browseContainerFilesystem' });
      actions.push({ label: '$(note) Create Dockerfile from Changes', command: 'vscode-docker-runner.createDockerfileFromContainer' });
      actions.push({ label: '$(export) Export to tar', command: 'vscode-docker-runner.exportContainer' });
      actions.push({ label: '$(trash) Delete', command: 'vscode-docker-runner.deleteItem' });
    } else if (type === 'docker-image-list') {
      actions.push({ label: '$(search) Search Images', command: 'vscode-docker-runner.searchImages' });
      actions.push({ label: '$(archive) Load Image (from save tar)', command: 'vscode-docker-runner.loadImage' });
      actions.push({ label: '$(archive) Import Image (from filesystem tar)', command: 'vscode-docker-runner.importImage' });
      actions.push({ label: '$(trash) Prune Dangling Images', command: 'vscode-docker-runner.pruneImages' });
    } else if (type === 'docker-container-list') {
      actions.push({ label: '$(trash) Prune Stopped Containers', command: 'vscode-docker-runner.pruneContainers' });
    }

    if (actions.length > 0) {
      vscode.window.showQuickPick(actions, { placeHolder: `${item.data.name} — Actions` }).then(picked => {
        if (picked) {
          vscode.commands.executeCommand(picked.command, item);
        }
      });
    }
  });

  registerCommand(context, 'vscode-docker-runner.viewItem', (item?: DockerTreeItem) => {
    if (item) { showItemDetail(treeProvider, detailPanel, item); }
  });

  // -----------------------------------------------------------------------
  // Shell operation helpers
  // -----------------------------------------------------------------------

  function shell(cmd: string): boolean {
    try {
      if (process.platform === 'win32') {
        cp.execSync(cmd, { shell: 'powershell' });
      } else {
        cp.execSync(cmd, { shell: '/bin/bash' });
      }
      return true;
    } catch (e: any) {
      vscode.window.showErrorMessage(`Failed: ${e.message}`);
      return false;
    }
  }

  function runShellOp(cmdTemplate: string, item: DockerTreeItem, refresh = true) {
    const cmd = replaceParams(cmdTemplate, item.data);
    if (shell(cmd) && refresh) {
      treeProvider.refresh();
    }
  }

  // -----------------------------------------------------------------------
  // Image commands
  // -----------------------------------------------------------------------

  registerCommand(context, 'vscode-docker-runner.createContainer', (item?: DockerTreeItem) => {
    if (!item) { return; }
    runCreateContainerWorkflow(item.data.id);
  });

  registerCommand(context, 'vscode-docker-runner.deleteItem', (item?: DockerTreeItem) => {
    if (!item) { return; }
    const type = item.data.type;
    const name = item.data.name || item.data.id;
    vscode.window.showWarningMessage(
      `Delete ${type === 'docker-image' ? 'image' : 'container'} "${name}"?`,
      { modal: true },
      'Delete'
    ).then(async (choice) => {
      if (choice !== 'Delete') { return; }
      if (type === 'docker-image') {
        runShellOp('docker image remove ${id}', item, true);
      } else if (type === 'docker-container') {
        runShellOp('docker container remove -f ${id}', item, true);
      }
    });
  });

  registerCommand(context, 'vscode-docker-runner.pullImage', (item?: DockerTreeItem) => {
    if (!item) { return; }
    const tag = item.data.repo_tag || item.data.name;
    if (tag) {
      vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Pulling ${tag}...` }, () => {
        shell(`docker image pull ${tag}`);
        treeProvider.refresh();
        refreshImageTable();
        return Promise.resolve();
      });
    }
  });

  registerCommand(context, 'vscode-docker-runner.pushImage', (item?: DockerTreeItem) => {
    if (!item) { return; }
    const tag = item.data.repo_tag || item.data.name;
    if (tag) {
      vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Pushing ${tag}...` }, () => {
        shell(`docker image push ${tag}`);
        return Promise.resolve();
      });
    }
  });

  registerCommand(context, 'vscode-docker-runner.saveImage', (item?: DockerTreeItem) => {
    if (!item) { return; }
    runShellOp('docker image save ${id} --output ${id}.tar', item);
  });

  registerCommand(context, 'vscode-docker-runner.createDockerfile', (item?: DockerTreeItem) => {
    if (!item) { return; }
    generateDockerfile(item.data.id || item.data.name, item.data.raw);
  });

  // -----------------------------------------------------------------------
  // Container commands
  // -----------------------------------------------------------------------

  registerCommand(context, 'vscode-docker-runner.startContainer', (item?: DockerTreeItem) => {
    if (!item) { return; }
    runShellOp('docker container start ${id}', item, true);
  });

  registerCommand(context, 'vscode-docker-runner.stopContainer', (item?: DockerTreeItem) => {
    if (!item) { return; }
    runShellOp('docker container stop ${id}', item, true);
  });

  registerCommand(context, 'vscode-docker-runner.restartContainer', (item?: DockerTreeItem) => {
    if (!item) { return; }
    runShellOp('docker container restart ${id}', item, true);
  });

  registerCommand(context, 'vscode-docker-runner.pauseContainer', (item?: DockerTreeItem) => {
    if (!item) { return; }
    runShellOp('docker container pause ${id}', item, true);
  });

  registerCommand(context, 'vscode-docker-runner.unpauseContainer', (item?: DockerTreeItem) => {
    if (!item) { return; }
    runShellOp('docker container unpause ${id}', item, true);
  });

  registerCommand(context, 'vscode-docker-runner.attachTerminal', (item?: DockerTreeItem) => {
    if (!item) { return; }
    shell(`docker attach ${item.data.id}`);
  });

  registerCommand(context, 'vscode-docker-runner.execContainer', (item?: DockerTreeItem) => {
    if (!item) { return; }
    vscode.window.showInputBox({ prompt: 'Command to execute in container', value: 'bash' }).then(cmd => {
      if (cmd) { shell(`docker exec -it ${item!.data.id} ${cmd}`); }
    });
  });

  registerCommand(context, 'vscode-docker-runner.commitContainer', (item?: DockerTreeItem) => {
    if (!item) { return; }
    runCommitContainerWorkflow(item.data.id);
  });

  registerCommand(context, 'vscode-docker-runner.exportContainer', (item?: DockerTreeItem) => {
    if (!item) { return; }
    runShellOp('docker container export ${id} --output ${id}.tar', item);
  });

  // -----------------------------------------------------------------------
  // Dockerfile from container changes
  // -----------------------------------------------------------------------

  registerCommand(context, 'vscode-docker-runner.createDockerfileFromContainer', (item?: DockerTreeItem) => {
    if (!item) { return; }
    createDockerfileFromContainer(item.data.id);
  });

  registerCommand(context, 'vscode-docker-runner.createDockerfileFromContainerId', (containerId?: string) => {
    if (!containerId) { return; }
    createDockerfileFromContainer(containerId);
  });

  // -----------------------------------------------------------------------
  // Container filesystem explorer — delegate to SmarterCommander extension
  // -----------------------------------------------------------------------

  async function ensureSmarterCommander(): Promise<boolean> {
    const ext = vscode.extensions.getExtension('Zim.vscode-smartercommander');
    if (ext) {
      if (!ext.isActive) await ext.activate();
      return true;
    }
    const choice = await vscode.window.showErrorMessage(
      'SmarterCommander extension is required for file browsing. Install it from the marketplace?',
      'Install',
      'Cancel'
    );
    if (choice === 'Install') {
      try {
        await vscode.commands.executeCommand('workbench.extensions.installExtension', 'Zim.vscode-smartercommander');
        vscode.window.showInformationMessage('SmarterCommander installed. Reload VS Code window to activate (Developer: Reload Window).');
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to install SmarterCommander: ${e.message}. Try installing manually from the VS Code marketplace.`);
      }
    }
    return false;
  }

  registerCommand(context, 'vscode-docker-runner.browseContainerFilesystem', async (item?: DockerTreeItem) => {
    if (!item) { return; }
    if (!await ensureSmarterCommander()) return;
    vscode.commands.executeCommand('smarterCommander.open', `docker://${item.data.id}/`);
  });

  registerCommand(context, 'vscode-docker-runner.browseContainerFilesystemById', async (containerId?: string) => {
    if (!containerId) { return; }
    if (!await ensureSmarterCommander()) return;
    vscode.commands.executeCommand('smarterCommander.open', `docker://${containerId}/`);
  });

  registerCommand(context, 'vscode-docker-runner.openPanels', async () => {
    if (!await ensureSmarterCommander()) return;
    vscode.commands.executeCommand('smarterCommander.open');
  });

  registerCommand(context, 'vscode-docker-runner.createDockerfileFromImageId', (imageId?: string) => {
    if (!imageId) { return; }
    generateDockerfile(imageId);
  });

  // -----------------------------------------------------------------------
  // View details by ID (for table views)
  // -----------------------------------------------------------------------

  registerCommand(context, 'vscode-docker-runner.openContainerDetailById', async (containerId?: string) => {
    if (!containerId) { return; }
    const fakeItem = new DockerTreeItem(
      { name: containerId.substring(0, 12), id: containerId, type: 'docker-container' } as any,
      vscode.TreeItemCollapsibleState.None,
      context.extensionPath
    );
    await showItemDetail(treeProvider, detailPanel, fakeItem);
  });

  registerCommand(context, 'vscode-docker-runner.openImageDetailById', async (imageId?: string) => {
    if (!imageId) { return; }
    const fakeItem = new DockerTreeItem(
      { name: imageId.substring(0, 12), id: imageId, type: 'docker-image' } as any,
      vscode.TreeItemCollapsibleState.None,
      context.extensionPath
    );
    await showItemDetail(treeProvider, detailPanel, fakeItem);
  });

  // -----------------------------------------------------------------------
  // Terminal commands
  // -----------------------------------------------------------------------

  registerCommand(context, 'vscode-docker-runner.attachContainerTerminal', (containerId?: string) => {
    if (!containerId) { return; }
    attachContainerTerminal(containerId);
  });

  // -----------------------------------------------------------------------
  // Bulk commands (folder-level)
  // -----------------------------------------------------------------------

  registerCommand(context, 'vscode-docker-runner.pruneImages', () => {
    shell('docker image prune -f');
    treeProvider.refresh();
  });

  registerCommand(context, 'vscode-docker-runner.pruneContainers', () => {
    shell('docker container prune -f');
    treeProvider.refresh();
  });

  registerCommand(context, 'vscode-docker-runner.searchImages', (...args: any[]) => {
    const query = typeof args[0] === 'string' ? args[0] : undefined;
    openHubSearch(context.extensionPath, query);
  });

  registerCommand(context, 'vscode-docker-runner.loadImage', () => {
    runLoadImageWorkflow();
  });

  registerCommand(context, 'vscode-docker-runner.importImage', () => {
    runImportImageWorkflow();
  });

  // -----------------------------------------------------------------------
  // Terminal configuration
  // -----------------------------------------------------------------------

  registerCommand(context, 'vscode-docker-runner.configureTerminal', async () => {
    const current = vscode.workspace.getConfiguration('docker-runner').get<string>('executionMode') || 'some';
    const modes: { label: string; description: string; id: string }[] = [
      { label: '$(mute) None', description: 'Run all commands in background (no terminal)', id: 'none' },
      { label: '$(terminal) Some', description: 'User-facing operations in terminal (default)', id: 'some' },
      { label: '$(debug-all) All', description: 'Run every operation in the terminal', id: 'all' },
    ];
    const picked = await vscode.window.showQuickPick(modes, { placeHolder: `Current: ${current}` });
    if (picked) {
      await vscode.workspace.getConfiguration('docker-runner').update('executionMode', picked.id, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Docker Runner terminal mode set to: ${picked.id}`);
    }
  });

  // -----------------------------------------------------------------------
  // Standalone table views
  // -----------------------------------------------------------------------

  registerCommand(context, 'vscode-docker-runner.openImageTable', () => {
    openImageTable(context.extensionPath);
  });

  registerCommand(context, 'vscode-docker-runner.openContainerTable', () => {
    openContainerTable(context.extensionPath);
  });
}

// =====================================================================
// Helper: register command with subscription
// =====================================================================

function registerCommand(context: ExtensionContext, id: string, handler: (...args: any[]) => any) {
  context.subscriptions.push(vscode.commands.registerCommand(id, handler));
}

// =====================================================================
// Show item detail in webview panel
// =====================================================================

async function showItemDetail(treeProvider: DockerTreeProvider, detailPanel: DockerDetailPanel, item: DockerTreeItem) {
  // Run detail query if defined for this item type
  const detailQuery = treeProvider.findDetailQuery(item.data);
  let rawData = item.data.raw;
  if (detailQuery && detailQuery.cmd) {
    let cmd = detailQuery.cmd;
    const regex = /\${([a-zA-Z0-9_-]*)}/g;
    cmd = cmd.replace(regex, (_m: string, key: string) => {
      return key in item.data ? String(item.data[key]) : 'unknown';
    });
    try {
      const result = treeProvider.executeDetailQuery(cmd);
      if (result && result.length > 0) {
        rawData = result[0];
      }
    } catch { /* fall back to existing raw data */ }
  }

  // Extract fields
  const fields: Record<string, string> = {};
  const extractors = treeProvider.findExtractors(item.data);
  for (const ext of extractors) {
    if (!ext.fields) { continue; }
    for (const fieldName of Object.keys(ext.fields)) {
      const fieldDef = ext.fields[fieldName];
      let value: any = 'x';
      try {
          const result = resolveJsonPath(rawData, fieldDef.path);
        if (Array.isArray(result) && result.length > 0) { value = result[0]; }
      } catch { /* ignore */ }
      if (fieldDef.map) {
        if (value in fieldDef.map) {
          value = fieldDef.map[value];
        } else {
          for (const k of Object.keys(fieldDef.map)) {
            try {
              if (String(value).match(new RegExp(k, 'g'))) { value = fieldDef.map[k]; }
            } catch { /* ignore */ }
          }
        }
      }
      fields[fieldName] = String(value);
    }
  }

  // Fix state field: docker inspect returns State as nested object {Status:"running"}
  // while docker ps returns it as a flat string "running". The extractor path $.State
  // works for the flat string; for the nested object we need to read State.Status.
  if (fields.state === '[object Object]') {
    try {
      const rawState = rawData?.State?.Status || rawData?.[0]?.State?.Status;
      if (rawState) {
        const stateMap: Record<string, string> = { running: 'started', exited: 'stopped', created: 'stopped' };
        fields.state = stateMap[rawState] || rawState;
      }
    } catch { /* ignore */ }
  }

  // Get operations
  const ops = treeProvider.getOperationCommands(item.data);

  // Extra container data: logs, diff, command history
  let containerLogs = '';
  let containerDiff = '';
  let bashHistory = '';
  const isContainer = item.data.type === 'docker-container';
  if (isContainer) {
    const id = item.data.id;
    // Recent logs (last 50 lines)
    try {
      containerLogs = cp.execSync(
        process.platform === 'win32'
          ? `docker logs --tail 50 ${id} 2>&1`
          : `docker logs --tail 50 ${id} 2>&1`,
        { shell: process.platform === 'win32' ? 'powershell' : '/bin/bash' }
      ).toString().trim();
    } catch { containerLogs = '(no logs available — container may not have started)'; }
    // Filesystem changes
    try {
      containerDiff = cp.execSync(
        process.platform === 'win32'
          ? `docker diff ${id} 2>&1`
          : `docker diff ${id} 2>&1`,
        { shell: process.platform === 'win32' ? 'powershell' : '/bin/bash' }
      ).toString().trim();
    } catch { containerDiff = '(diff not available)'; }
    // Bash / ash history inside the container
    try {
      bashHistory = cp.execSync(
        process.platform === 'win32'
          ? `docker exec ${id} bash -c "cat ~/.bash_history 2>/dev/null; cat ~/.ash_history 2>/dev/null; cat ~/.zsh_history 2>/dev/null; echo '[end]'" 2>&1`
          : `docker exec ${id} bash -c "cat ~/.bash_history 2>/dev/null; cat ~/.ash_history 2>/dev/null; cat ~/.zsh_history 2>/dev/null; echo '[end]'" 2>&1`,
        { shell: process.platform === 'win32' ? 'powershell' : '/bin/bash' }
      ).toString().trim();
      // Remove the [end] sentinel
      bashHistory = bashHistory.replace(/\n\[end\]$/, '');
      if (!bashHistory || bashHistory.trim().length === 0) {
        bashHistory = '(no command history found — shell might not store history)';
      }
    } catch { bashHistory = '(cannot read history — container may not be running)'; }
  }

  // Show detail panel
  detailPanel.show(item.data, rawData, fields, ops, containerLogs, containerDiff, bashHistory);
}

// =====================================================================
// Dockerfile generation from container changes
// =====================================================================

async function createDockerfileFromContainer(containerId: string) {
  const timestamp = Date.now();
  const tempImageName = `docker-runner-temp-${timestamp}`;

  // 1. Commit the container to a temporary image
  try {
    vscode.window.showInformationMessage(`Committing container ${containerId.substring(0, 12)}...`);
    const cmd = process.platform === 'win32'
      ? `docker commit ${containerId} ${tempImageName}`
      : `docker commit ${containerId} ${tempImageName}`;
    cp.execSync(cmd, { shell: process.platform === 'win32' ? 'powershell' : '/bin/bash' });
  } catch (e: any) {
    vscode.window.showErrorMessage(`Failed to commit container: ${e.message}`);
    return;
  }

  // 2. Generate Dockerfile from the temporary image
  await generateDockerfile(tempImageName);

  // 3. Clean up the temporary image
  try {
    const rmCmd = process.platform === 'win32'
      ? `docker image rm ${tempImageName} 2>&1`
      : `docker image rm ${tempImageName} 2>&1`;
    cp.execSync(rmCmd, { shell: process.platform === 'win32' ? 'powershell' : '/bin/bash' });
  } catch {
    // non-fatal: cleanup may fail if image is still being used
  }
}

// =====================================================================
// Dockerfile generation from image history
// =====================================================================

async function generateDockerfile(imageId: string, rawData?: any) {
  let history = '';
  try {
    const cmd = process.platform === 'win32'
      ? `docker history --no-trunc --format json ${imageId}`
      : `docker history --no-trunc --format json ${imageId}`;
    const r = process.platform === 'win32'
      ? cp.execSync(cmd, { shell: 'powershell' }).toString()
      : cp.execSync(cmd, { shell: '/bin/bash' }).toString();
    const lines = r.split(/\r?\n/).filter(l => l.trim().length > 0);
    history = lines.map(l => JSON.parse(l)).map((entry: any) => {
      const cmd = (entry.CreatedBy || '').replace(/^\/bin\/sh -c /, '').replace(/^\/bin\/bash -c /, '');
      const size = entry.Size || '0B';
      return `# ${entry.ID} (${size})\n# ${cmd}\n`;
    }).join('\n');
  } catch {
    history = '# Could not retrieve image history\n';
  }

  // Also get inspect data for CMD, ENV, etc.
  let inspectInfo = '';
  try {
    const cmd = `docker image inspect ${imageId}`;
    const r = process.platform === 'win32'
      ? cp.execSync(cmd, { shell: 'powershell' }).toString()
      : cp.execSync(cmd, { shell: '/bin/bash' }).toString();
    const inspect = JSON.parse(r)[0];
    const config = inspect.ContainerConfig || inspect.Config || {};
    const parts: string[] = [];
    if (config.Cmd) parts.push(`CMD ${JSON.stringify(config.Cmd)}`);
    if (config.Entrypoint) parts.push(`ENTRYPOINT ${JSON.stringify(config.Entrypoint)}`);
    if (config.Env) parts.push(`ENV ${config.Env.join(' \\\n    ')}`);
    if (config.ExposedPorts) parts.push(`EXPOSE ${Object.keys(config.ExposedPorts).join(' ')}`);
    if (config.Volumes) parts.push(`VOLUME ${JSON.stringify(Object.keys(config.Volumes))}`);
    if (config.WorkingDir) parts.push(`WORKDIR ${config.WorkingDir}`);
    if (config.User) parts.push(`USER ${config.User}`);
    inspectInfo = parts.join('\n');
  } catch {
    inspectInfo = '# Could not retrieve inspect data';
  }

  const dockerfile = `# Dockerfile generated from image: ${imageId}
# Generated by Docker Runner
# NOTE: This is an approximation. Manual adjustments may be needed.

${inspectInfo}

# --- Build History (for reference) ---
#
${history}
# ---
`;

  const doc = await vscode.workspace.openTextDocument({
    language: 'dockerfile',
    content: dockerfile
  });
  await vscode.window.showTextDocument(doc);
}

// =====================================================================
// Template variable replacement
// =====================================================================

function replaceParams(template: string, data: any): string {
  const regex = /\${([a-zA-Z0-9_-]*)}/;
  let result = template;
  let match: RegExpExecArray | null;
  do {
    match = regex.exec(result);
    if (match) {
      const key = match[1];
      result = result.replace('${' + key + '}', key in data ? String(data[key]) : 'unknown');
    }
  } while (match);
  return result;
}

export function deactivate () {}
