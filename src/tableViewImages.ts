import * as vscode from 'vscode';
import { createManagedWebviewPanel } from './shared/vscode-components/common-webviews/managed-webview';
import { getManagedTableStyles, getManagedTableHtml, getManagedTableScript } from './shared/vscode-components/common-webviews/managed-table';
import type { ManagedTableColumn, ManagedTableAction, ManagedTableRow } from './shared/vscode-components/common-webviews/managed-table';
import { exec, execRows, shortId, saveImageAsync, removeImageAsync, pushImageAsync, pruneImagesAsync, imageHistory } from './dockerApi';

async function showActionsMenu(
  actions: ManagedTableAction[],
  isDisposed: () => boolean,
  postMsg: (msg: any) => Promise<void>
): Promise<void> {
  const items = actions.map(a => ({ label: a.label, actionId: a.id } as vscode.QuickPickItem & { actionId: string }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select action' });
  if (picked && !isDisposed()) {
    await postMsg({ type: 'actionSelected', actionId: picked.actionId });
  }
}

// ---------------------------------------------------------------------------
// Columns & Actions
// ---------------------------------------------------------------------------

const imageColumns: ManagedTableColumn[] = [
  { id: 'repository', label: 'Repository', clickable: true },
  { id: 'tag', label: 'Tag' },
  { id: 'imageId', label: 'Image ID', width: '120px' },
  { id: 'size', label: 'Size', width: '80px' },
  { id: 'created', label: 'Created', width: '160px' },
  { id: 'sel', label: '', selectAll: true, align: 'center', width: '40px' },
];

const imageActions: ManagedTableAction[] = [
  { id: 'pull', label: 'Pull Selected' },
  { id: 'push', label: 'Push Selected' },
  { id: 'save', label: 'Save Selected to tar' },
  { id: 'delete', label: 'Delete Selected' },
  { id: 'prune', label: 'Prune Dangling Images' },
];

// ---------------------------------------------------------------------------
// Data fetching (runs in extension host, synchronous)
// ---------------------------------------------------------------------------

function fetchImageRows(): ManagedTableRow[] {
  const rawRows = execRows('docker image list --format json');
  return rawRows.map((r: any, idx: number) => {
    // Size from docker image list is already a human-readable string like "78.1MB"
    let size = r.Size;
    if (size === '' || size == null || size === '<none>') size = '0B';

    // CreatedAt format: "2026-02-10 17:49:57 +0100 EZ" — new Date() may fail
    let created = r.CreatedAt || r.createdAt || '';
    if (created) {
      try {
        // Strip the timezone suffix (EZ) that JS can't parse
        const cleaned = created.replace(/ [A-Z]+$/, '').replace(/\+(\d{4})/, 'T$1:00');
        const d = new Date(cleaned);
        if (!isNaN(d.getTime())) created = d.toLocaleString();
      } catch { /* keep raw string */ }
    }

    return {
      id: r.ID || `img-${idx}`,
      cells: {
        repository: r.Repository || '<none>',
        tag: r.Tag || '<none>',
        imageId: shortId(r.ID),
        size,
        created,
      },
      meta: { raw: r },
    };
  });
}

let lastImagePanel: vscode.WebviewPanel | undefined;

function clearImagePanel() { lastImagePanel = undefined; }

/** Refresh the images table view if it's currently open. */
export function refreshImageTable(): void {
  if (lastImagePanel) {
    try { lastImagePanel.webview.postMessage({ type: 'loadImages' }); } catch { /* panel disposed */ }
  }
}

// ---------------------------------------------------------------------------
// Panel creation
// ---------------------------------------------------------------------------

export function openImageTable(extensionPath: string): void {
  if (lastImagePanel) {
    try { lastImagePanel.reveal(vscode.ViewColumn.Active); return; } catch { lastImagePanel = undefined; }
  }

  // Pre-load data synchronously — no roundtrip needed for initial render
  const initialRows = fetchImageRows();

  const { panel, isDisposed, postMessage } = createManagedWebviewPanel({
    viewType: 'dockerImageTable',
    title: 'Docker Images',
    column: vscode.ViewColumn.Active,
    onMessage: async (message: any) => {
      if (message.type === 'showActionsMenu') {
        await showActionsMenu(imageActions, isDisposed, postMessage);
        return;
      }
      if (message.type === 'loadImages' || message.type === 'reload') {
        const rows = fetchImageRows();
        if (!isDisposed()) {
          await postMessage({ type: 'imageData', rows, status: `${rows.length} images` });
        }
        return;
      }
      if (message.type === 'rowClicked') {
        const rowId = message.rowId || '';
        if (!rowId) { return; }
        const actionItems = [
          { id: 'createContainer', label: 'Create Container' },
          { id: 'viewDetails', label: 'View Details' },
          { id: 'createDockerfile', label: 'Create Dockerfile' },
          { id: 'pull', label: 'Pull' },
          { id: 'push', label: 'Push' },
          { id: 'save', label: 'Save to tar' },
          { id: 'delete', label: 'Delete' },
        ].map(a => ({ label: a.label, actionId: a.id } as vscode.QuickPickItem & { actionId: string }));
        const picked = await vscode.window.showQuickPick(actionItems, { placeHolder: `Actions for ${rowId.substring(0, 12)}` });
        if (picked && !isDisposed()) {
          await handleImageAction(picked.actionId, [rowId], isDisposed, postMessage);
        }
        return;
      }
      if (message.type === 'actionSelected') {
        const selectedIds = message.selectedIds || [];
        await handleImageAction(message.actionId, selectedIds, isDisposed, postMessage);
        return;
      }
    },
    onDispose: () => {},
  });

  lastImagePanel = panel;
  panel.onDidDispose(clearImagePanel);
  panel.webview.html = buildImageHtml(initialRows);
}

function buildImageHtml(initialRows: ManagedTableRow[]): string {
  const initialDataJson = JSON.stringify(initialRows);

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  html,body { height:100%; margin:0; padding:0; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); display:flex; flex-direction:column; overflow:hidden; }
  ${getManagedTableStyles()}
  .managed-table-container tbody tr:hover td,
  .managed-table-container tbody tr.clickable:hover td { background: var(--vscode-input-background) !important; }
</style></head>
<body>
${getManagedTableHtml({
  columns: imageColumns,
  title: 'Docker Images',
  titleId: 'imagesTitle',
  tableId: 'imagesTable',
  bodyId: 'imagesBody',
  showTextFilter: true,
  filterPlaceholder: 'Filter images...',
  filterId: 'imageFilter',
  actions: imageActions,
  reloadButtonId: 'imageReloadBtn',
  actionsButtonId: 'imageActionsBtn',
  actionsMenuId: 'imageActionsMenu',
  statusId: 'imageStatus',
})}
<script>
(function() {
  const vscode = acquireVsCodeApi();
  ${getManagedTableScript({ reloadHandler: '0', reloadButtonId: 'dummyReloadBtn', tableBodyId: 'imagesBody', actionsButtonId: 'imageActionsBtn', statusId: 'imageStatus', actionsMenuId: 'imageActionsMenu', columns: imageColumns })}
  const api = window.__managedTableApi;

  // Render initial data immediately (embedded in HTML)
  var initialData = ${initialDataJson};
  api.setRows(initialData);
  api.setStatus(initialData.length + ' images');
  api.setActionsEnabled(initialData.length > 0);

  // Reload: post to extension host
  document.getElementById('imageReloadBtn').addEventListener('click', function() {
    api.setRefreshing(true);
    vscode.postMessage({ type: 'loadImages' });
  });

  // Row click: show single-item actions
  api.onRowClick(function(rowId) {
    vscode.postMessage({ type: 'rowClicked', rowId: rowId });
  });

  window.addEventListener('message', function(event) {
    const msg = event.data;
    if (msg.type === 'imageData') {
      api.setRows(msg.rows || []);
      api.setStatus(msg.status || '');
      api.setRefreshing(false);
      api.setActionsEnabled(msg.rows && msg.rows.length > 0);
    }
    if (msg.type === 'actionSelected') {
      const ids = api.getSelectedRowIds();
      vscode.postMessage({ type: 'actionSelected', actionId: msg.actionId, selectedIds: ids });
    }
    // rowClicked is handled entirely in the extension host
  });
})();
</script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function handleImageAction(
  actionId: string,
  selectedIds: string[],
  isDisposed: () => boolean,
  postMsg: (msg: any) => Promise<void>
): Promise<void> {
  switch (actionId) {
    case 'viewDetails':
      for (const id of selectedIds) { vscode.commands.executeCommand('vscode-docker-runner.openImageDetailById', id); }
      return;
    case 'createContainer':
      for (const id of selectedIds) { exec(`docker run -it ${id}`); }
      return;
    case 'createDockerfile':
      for (const id of selectedIds) {
        const history = imageHistory(id);
        const content = history.map((entry: any) => {
          const cmd = (entry.CreatedBy || '').replace(/^\/bin\/sh -c /, '').replace(/^\/bin\/bash -c /, '');
          return `# ${entry.ID} (${entry.Size || '0B'})\n# ${cmd}`;
        }).join('\n');
        const doc = await vscode.workspace.openTextDocument({ language: 'dockerfile', content });
        await vscode.window.showTextDocument(doc);
      }
      return;
    case 'pull':
      vscode.commands.executeCommand('vscode-docker-runner.pullImage');
      return;
    case 'prune':
      await pruneImagesAsync();
      break;
    case 'save':
      for (const id of selectedIds) { await saveImageAsync(id, shortId(id) + '.tar'); }
      break;
    case 'delete': {
      if (selectedIds.length === 0) { return; }
      const confirmed = await vscode.window.showWarningMessage(`Delete ${selectedIds.length} image(s)?`, { modal: true }, 'Delete');
      if (confirmed !== 'Delete') { return; }
      for (const id of selectedIds) { await removeImageAsync(id); }
      break;
    }
    case 'push':
      for (const id of selectedIds) { await pushImageAsync(id); }
      break;
  }

  // Refresh after action
  if (!isDisposed()) {
    const rows = fetchImageRows();
    await postMsg({ type: 'imageData', rows, status: `${rows.length} images` });
  }
}
