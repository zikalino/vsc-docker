// ─── Types ──────────────────────────────────────────────────────

export interface FsRow {
  id: string;
  name: string;
  isDir: boolean;
  sizeLabel: string;
  modified: string;
  mode: string;
  selected?: boolean;
}

export interface PanelState {
  uri: string;
  entries: FsRow[];
  focusedIndex: number;
  selection: Set<number>;  // row indices
}

export interface DualPaneFsOptions {
  /** DOM id prefix for this instance (allows multiple). */
  id?: string;
  /** Initial URIs for the two panels. */
  leftUri?: string;
  rightUri?: string;
}

// ─── Generate HTML ─────────────────────────────────────────────

export function getDualPaneFsStyles(): string {
  return `
    html { height: 100vh; }
    body { height: 1px; min-height: 100vh; margin:0; padding:0; user-select:none; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      display: flex; flex-direction: column; overflow: hidden;
    }
    .dpfs-root {
      flex: 1; min-height: 0;
      display: flex; flex-direction: column;
    }
    .dpfs-panels {
      flex: 1; min-height: 0;
      display: flex; gap: 2px;
    }
    .dpfs-panel {
      flex: 1; min-width: 0; min-height: 0; overflow: hidden;
      display: flex; flex-direction: column;
      border: 1px solid transparent;
    }
    .dpfs-panel.active {
      border-color: var(--vscode-focusBorder);
    }
    .dpfs-panel-divider {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      flex-shrink: 0; width: 28px; padding-top: 4px;
      background: var(--vscode-sideBar-background);
      border-left: 1px solid var(--vscode-panel-border);
      border-right: 1px solid var(--vscode-panel-border);
    }
    .dpfs-panel-divider .dpfs-divider-sep { flex: 1; }
    .dpfs-panel-divider button {
      background: none; border: none; color: var(--vscode-foreground);
      cursor: pointer; padding: 4px 2px; font-size: 14px; border-radius: 4px; line-height: 1;
    }
    .dpfs-panel-divider button:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .dpfs-panel-header {
      display: flex; align-items: center; gap: 4px;
      padding: 2px 6px;
      background: var(--vscode-sideBarSectionHeader-background);
      flex-shrink: 0;
    }
    .dpfs-panel-header label {
      font-size: 11px; font-weight: 600;
      color: var(--vscode-sideBarSectionHeader-foreground);
      flex-shrink: 0;
    }
    .dpfs-panel-url {
      flex: 1; min-width: 0;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 2px 5px; border-radius: 2px; font-size: 11px;
    }
    .dpfs-table-body-wrap { flex: 1; min-height: 0; overflow: auto; }
    .dpfs-table { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; }
    .dpfs-table thead th {
      border-bottom: 1px solid var(--vscode-panel-border);
      padding: 3px 6px; text-align: left; font-weight: 600;
      white-space: nowrap;
    }
    .dpfs-table-header { flex-shrink: 0; }
    .dpfs-table-header thead th {
      background: var(--vscode-sideBarSectionHeader-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      padding: 3px 6px; text-align: left; font-weight: 600;
      white-space: nowrap;
    }
    .dpfs-table thead th.align-right { text-align: right; }
    .dpfs-table thead th.align-center { text-align: center; }
    .dpfs-table tbody td {
      padding: 2px 6px; white-space: nowrap;
      border-bottom: 1px solid var(--vscode-panel-border);
      cursor: default;
    }
    .dpfs-table tbody td:first-child {
      overflow: hidden; text-overflow: ellipsis;
    }
    .dpfs-table tbody td.align-right,
    .dpfs-table tbody td:nth-child(2) {
      text-align: right;
    }
    .dpfs-table tbody td .dpfs-icon-wrap {
      display: inline-block; width: 20px; text-align: center;
      font-size: 14px; vertical-align: middle; margin-right: 2px;
    }
    /* Selected row — use inactive color (not focused panel) — on tr level */
    .dpfs-table tbody tr.selected {
      background: var(--vscode-list-inactiveSelectionBackground) !important;
    }
    /* Selected row in the active panel */
    .dpfs-panel.active .dpfs-table tbody tr.selected {
      background: var(--vscode-list-activeSelectionBackground) !important;
      color: var(--vscode-list-activeSelectionForeground) !important;
    }
    .dpfs-panel.active .dpfs-table tbody tr.selected td {
      color: inherit;
    }
    /* Focus indicator — outline on tr draws around the whole row */
    .dpfs-table tbody tr.focused {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }
    .dpfs-panel-status { flex-shrink: 0; padding: 2px 6px; font-size: 11px; color: var(--vscode-descriptionForeground); }
    .dpfs-statusbar {
      display: flex; align-items: center; gap: 8px;
      padding: 3px 8px;
      background: var(--vscode-panel-background);
      border-top: 1px solid var(--vscode-panel-border);
      font-size: 11px;
      flex-shrink: 0;
    }
    .dpfs-statusbar .dpfs-action-btn {
      background: var(--vscode-button-secondaryBackground);
      border: 1px solid var(--vscode-panel-border);
      color: var(--vscode-foreground);
      cursor: pointer; border-radius: 3px; padding: 2px 8px; font-size: 11px;
    }
    .dpfs-statusbar .dpfs-action-btn:hover { background: var(--vscode-list-hoverBackground); }
    .dpfs-statusbar .dpfs-action-btn:disabled { opacity: 0.4; cursor: default; }
    .dpfs-statusbar .dpfs-sep { color: var(--vscode-panel-border); }
    .dpfs-statusbar .dpfs-info { color: var(--vscode-descriptionForeground); margin-left: auto; }
    /* Browse root icons (SVG data URIs) */
    .dpfs-icon-docker { display: inline-block; width: 16px; height: 16px; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='14' fill='%231794D4'/%3E%3Cpath d='M18 7H16V9H18V7Z' fill='%23fff'/%3E%3Cpath d='M10 10H12V12H10V10Z' fill='%23fff'/%3E%3Cpath d='M6.002 16.941C6.172 19.843 7.9 24 14 24c6.8 0 9.833-5 10.5-7.5.833 0 2.7-.5 3.5-2.5-.5-.5-2.5-.5-3.5 0 0-.8-.5-2.5-1.5-3-.667.667-1.7 2.4-.5 4-1 1-2.333 1-4 1H6.943a.5.5 0 0 0-.5.5l.059.441zM9 13H7v2h2v-2zm3 0h-2v2h2v-2zm5 0h-2v2h2v-2zm3 0h-2v2h2v-2zm-6-3h-2v2h2v-2zm1 0h2v2h-2v-2z' fill='%23fff'/%3E%3C/svg%3E") no-repeat center/contain; vertical-align: middle; margin-right: 2px; }
    .dpfs-icon-github { display: inline-block; width: 16px; height: 16px; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='20' fill='%23181717'/%3E%3Cpath d='M6.813 34.235c2.435 4.079 6.28 7.218 10.864 8.743 1.001.183 1.365-.434 1.365-.965 0-.22-.003-.607-.008-1.127-.006-.601-.013-1.378-.019-2.274-5.563 1.208-6.737-2.68-6.737-2.68-.91-2.31-2.221-2.925-2.221-2.925-1.816-1.241.138-1.217.138-1.217 2.007.143 3.063 2.062 3.063 2.062 1.784 3.056 4.68 2.173 5.82 1.662.181-1.293.697-2.174 1.27-2.674-4.441-.505-9.11-2.222-9.11-9.885 0-2.183.78-3.968 2.06-5.367-.207-.506-.893-2.539.195-5.293 0 0 1.68-.538 5.5 2.05a18.99 18.99 0 0 1 6.008-.813 19.02 19.02 0 0 1 6.006.813c3.819-2.588 5.495-2.05 5.495-2.05 1.092 2.754.406 4.787.2 5.293 1.282 1.399 2.057 3.184 2.057 5.367 0 7.683-4.677 9.374-9.132 9.869.718.618 1.358 1.838 1.358 3.704 0 1.788-.011 3.345-.018 4.376-.004.511-.007.893-.007 1.11 0 .535.36 1.158 1.375.963 3.651-1.22 6.834-3.46 9.207-6.386C35.873 41.11 30.274 44 24 44c-7.305 0-13.696-3.917-17.187-9.765z' fill='%23fff'/%3E%3C/svg%3E") no-repeat center/contain; vertical-align: middle; margin-right: 2px; }
    .dpfs-icon-local { display: inline-block; width: 16px; height: 16px; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zM2.5 2a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zm6.5.5A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zM1 10.5A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zm6.5.5A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3z' fill='%23888888'/%3E%3C/svg%3E") no-repeat center/contain; vertical-align: middle; margin-right: 2px; }
    .dpfs-icon-ssh { display: inline-block; width: 16px; height: 16px; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%23888888' d='M15 14s1 0 1-1-1-4-5-4-5 3-5 4 1 1 1 1h8zm-7.978-1A.722.722 0 0 1 7 12.5c0-1.38 1.51-3 4-3 2.49 0 4 1.62 4 3 0 .276-.222.5-.5.5H7.022zM4 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm0 1a2 2 0 1 1 0 4 2 2 0 0 1 0-4z'/%3E%3C/svg%3E") no-repeat center/contain; vertical-align: middle; margin-right: 2px; }
    /* Loading spinner */
    .dpfs-spinner {
      display: none; width: 16px; height: 16px;
      border: 2px solid var(--vscode-panel-border);
      border-top-color: var(--vscode-focusBorder);
      border-radius: 50%; animation: dpfs-spin 0.6s linear infinite;
      flex-shrink: 0;
    }
    .dpfs-spinner.active { display: inline-block; }
    @keyframes dpfs-spin { to { transform: rotate(360deg); } }
  `;
}

/** Build a label with icon from a URI scheme. */
function schemeLabel(uri: string): string {
  const scheme = (uri || '').split('://')[0].toLowerCase();
  switch (scheme) {
    case 'git': case 'github': return '<span class="dpfs-icon-github"></span> GitHub';
    case 'docker': return '<span class="dpfs-icon-docker"></span> Docker';
    case 'ssh': return '<span class="dpfs-icon-ssh"></span> SSH';
    case 'file': default: return '<span class="dpfs-icon-local"></span> Local';
  }
}

export function getDualPaneFsHtml(options: DualPaneFsOptions): string {
  const id = options.id || 'dpfs';
  const leftUri = options.leftUri || 'file:///';
  const rightUri = options.rightUri || 'file:///';

  return `
<div id="${id}" class="dpfs-root">
  <div class="dpfs-panels">
    <div id="${id}-panel-L" class="dpfs-panel active">
      <div class="dpfs-panel-header">
        <label id="${id}-label-L">${schemeLabel(leftUri)}</label>
        <input id="${id}-url-L" class="dpfs-panel-url" value="${leftUri}" />
        <button class="dpfs-action-btn" style="font-size:11px;padding:1px 5px;" data-panel="L">Go</button>
      </div>
      <div class="dpfs-table-header">
        <table class="dpfs-table">
          <colgroup><col><col style="width:70px"><col style="width:110px"><col style="width:55px"></colgroup>
          <thead><tr>
            <th>Name</th>
            <th class="align-right">Size</th>
            <th>Modified</th>
            <th>Mode</th>
          </tr></thead>
        </table>
      </div>
      <div class="dpfs-table-body-wrap">
        <table class="dpfs-table">
          <colgroup><col><col style="width:70px"><col style="width:110px"><col style="width:55px"></colgroup>
          <tbody id="${id}-body-L"></tbody>
        </table>
      </div>
      <div class="dpfs-panel-status" id="${id}-status-L"></div>
    </div>
    <div class="dpfs-panel-divider">
      <button class="dpfs-divider-btn" data-action="refresh" title="Refresh (Ctrl+R)">↻</button>
      <button class="dpfs-divider-btn" data-action="home" title="Go to workspace root">⌂</button>
      <span class="dpfs-divider-sep"></span>
      <button class="dpfs-divider-btn" data-action="copy" id="${id}-btn-copy" title="Copy to other panel">→</button>
      <button class="dpfs-divider-btn" data-action="move" id="${id}-btn-move" title="Move to other panel">⇢</button>
      <button class="dpfs-divider-btn" data-action="delete" id="${id}-btn-delete" title="Delete selected">✕</button>
      <button class="dpfs-divider-btn" data-action="compare" title="Compare directories">↔</button>
      <button class="dpfs-divider-btn" data-action="archive" title="Archive selected">🗜️</button>
    </div>
    <div id="${id}-panel-R" class="dpfs-panel">
      <div class="dpfs-panel-header">
        <label id="${id}-label-R">${schemeLabel(rightUri)}</label>
        <input id="${id}-url-R" class="dpfs-panel-url" value="${rightUri}" />
        <button class="dpfs-action-btn" style="font-size:11px;padding:1px 5px;" data-panel="R">Go</button>
      </div>
      <div class="dpfs-table-header">
        <table class="dpfs-table">
          <colgroup><col><col style="width:70px"><col style="width:110px"><col style="width:55px"></colgroup>
          <thead><tr>
            <th>Name</th>
            <th class="align-right">Size</th>
            <th>Modified</th>
            <th>Mode</th>
          </tr></thead>
        </table>
      </div>
      <div class="dpfs-table-body-wrap">
        <table class="dpfs-table">
          <colgroup><col><col style="width:70px"><col style="width:110px"><col style="width:55px"></colgroup>
          <tbody id="${id}-body-R"></tbody>
        </table>
      </div>
      <div class="dpfs-panel-status" id="${id}-status-R"></div>
    </div>
  </div>
  <div class="dpfs-statusbar">
    <span class="dpfs-spinner" id="${id}-spinner"></span>
    <span class="dpfs-info" id="${id}-info">Ready</span>
  </div>
</div>`;
}

// ─── Client-side script ─────────────────────────────────────────

export function getDualPaneFsScript(options: DualPaneFsOptions): string {
  const id = options.id || 'dpfs';

  return `
(function() {
  var vscode = acquireVsCodeApi();
  var D = '${id}';
  var panels = { L: null, R: null }; // { entries, focused, selection }
  var activePanel = 'L';
  var _clipboard = { paths: [], action: 'copy' }; // for Ctrl+C/X/V
  var filterTerms = { L: '', R: '' };

  function escape(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function updateLabel(panelId, uri) {
    var label = document.getElementById(D+'-label-'+panelId);
    if (!label) return;
    var scheme = (uri || '').split('://')[0].toLowerCase();
    var icon = '';
    var text = '';
    if (scheme === 'git' || scheme === 'github') { icon = 'dpfs-icon-github'; text = 'GitHub'; }
    else if (scheme === 'docker') { icon = 'dpfs-icon-docker'; text = 'Docker'; }
    else if (scheme === 'ssh') { icon = 'dpfs-icon-ssh'; text = 'SSH'; }
    else { icon = 'dpfs-icon-local'; text = 'Local'; }
    label.innerHTML = '<span class="' + icon + '"></span> ' + text;
  }

  function toggleActive(panelId) {
    document.getElementById(D+'-panel-'+(panelId === 'L' ? 'R' : 'L')).classList.remove('active');
    document.getElementById(D+'-panel-'+panelId).classList.add('active');
    activePanel = panelId;
    renderTable(panelId);
    updateDividerArrows();
  }

  function updateDividerArrows() {
    var copyBtn = document.getElementById(D+'-btn-copy');
    var moveBtn = document.getElementById(D+'-btn-move');
    if (copyBtn) copyBtn.textContent = activePanel === 'L' ? '→' : '←';
    if (moveBtn) moveBtn.textContent = activePanel === 'L' ? '⇢' : '⇠';
  }

  function renderTable(panelId) {
    var data = panels[panelId];
    if (!data) { document.getElementById(D+'-body-'+panelId).innerHTML = '<tr><td colspan="4" style="color:var(--vscode-descriptionForeground);padding:10px;">No data</td></tr>'; return; }
    var filter = filterTerms[panelId].toLowerCase();
    var tbody = document.getElementById(D+'-body-'+panelId);
    var html = '';
    data.entries.forEach(function(row, idx) {
      if (filter && !row.name.toLowerCase().includes(filter)) return;
      var cls = '';
      if (data.selection && data.selection.has(idx)) cls += ' selected';
      if (data.focused === idx) cls += ' focused';
      var iconChar = fileIcon(row.name, row.isDir);
      html += '<tr class="' + cls + '" data-panel="' + panelId + '" data-idx="' + idx + '">';
      html += '<td><span class="dpfs-icon-wrap">' + iconChar + '</span> ' + escape(row.name) + '</td>';
      html += '<td class="align-right">' + escape(row.sizeLabel || '') + '</td>';
      html += '<td>' + escape(row.modified || '') + '</td>';
      html += '<td>' + escape(row.mode || '') + '</td>';
      html += '</tr>';
    });
    tbody.innerHTML = html || '<tr><td colspan="4" style="color:var(--vscode-descriptionForeground);padding:10px;">No files</td></tr>';
  }

  function fileIcon(name, isDir) {
    // Browse root items — use provider-specific icons
    if (isDir && name === 'Local Filesystem') return '';
    if (isDir && name === 'Docker Containers') return '';
    if (isDir && name === 'SSH') return '';
    if (isDir && name === 'GitHub') return '';
    // "Add" entries already have their own icon in the name
    if (name.indexOf('➕') === 0) return '';
    if (isDir) return '📁';  // folder
    var ext = name.split('.').pop().toLowerCase();
    // Common file types
    var map = {
      ts: '🟦', tsx: '🟦',  // blue square for TypeScript
      js: '🟨', jsx: '🟨',  // yellow square for JavaScript
      json: '⚙️',  // gear
      html: '🌐', htm: '🌐',  // globe
      css: '🎨', scss: '🎨', less: '🎨',  // palette
      md: '📝', markdown: '📝',  // memo
      py: '🐍', rb: '🐍',  // snake for Python, Ruby
      yaml: '⚙️', yml: '⚙️',
      xml: '📄',  // page
      sh: '🔥', bash: '🔥', zsh: '🔥',  // fire for scripts
      png: '🖼', jpg: '🖼', jpeg: '🖼',
      gif: '🖼', svg: '🖼', ico: '🖼',
      bmp: '🖼', webp: '🖼',
      zip: '📦', tar: '📦', gz: '📦',
      '7z': '📦', rar: '📦',
      pdf: '📄',
      exe: '⚙️', dll: '⚙️', bin: '⚙️',
      so: '⚙️', o: '⚙️',
      gitignore: '📝', git: '📝',
      dockerfile: '🐳', Dockerfile: '🐳',  // whale
    };
    return map[ext] || '📄';  // generic file
  }

  // ── Set data for a panel ────────────────────────────────────
  function setPanelData(panelId, entries) {
    // Sort: directories first, then files, alphabetical within each group
    var sorted = (entries || []).slice().sort(function(a, b) {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '');
    });
    panels[panelId] = { entries: sorted, focused: 0, selection: new Set() };
    renderTable(panelId);
  }

  // ── Focus / selection helpers ───────────────────────────────
  function getVisibleRows(panelId) {
    var tbody = document.getElementById(D+'-body-'+panelId);
    return Array.from(tbody.querySelectorAll('tr'));
  }

  function focusRow(panelId, idx) {
    var data = panels[panelId];
    if (!data || !data.entries || data.entries.length === 0) return;
    if (idx < 0) idx = 0;
    if (idx >= data.entries.length) idx = data.entries.length - 1;
    data.focused = idx;
    renderTable(panelId);
    var rows = getVisibleRows(panelId);
    if (rows[idx]) rows[idx].scrollIntoView({ block: 'nearest' });
  }

  function getFocusedRow(panelId) {
    var data = panels[panelId];
    return data ? data.entries[data.focused] : null;
  }

  function navigateDir(panelId, path) {
    vscode.postMessage({ command: 'navigate', panel: panelId, path: path });
  }

  function viewFile(panelId, path) {
    vscode.postMessage({ command: 'viewFile', panel: panelId, path: path });
  }

  function activateRow(panelId) {
    var row = getFocusedRow(panelId);
    if (row) {
      if (row.isDir) {
        navigateDir(panelId, row._fullPath || row.name);
      } else if (shouldExecuteOnEnter(row)) {
        // Executable or script file → run in terminal
        vscode.postMessage({ command: 'executeFile', panel: panelId, path: row._fullPath || row.name });
      } else {
        viewFile(panelId, row._fullPath || row.name);
      }
    }
  }

  function isExecutable(row) {
    // Check if mode string (e.g. -rwxr-xr-x) contains 'x' and it's not a directory
    return row && !row.isDir && row.mode && row.mode.indexOf('x') !== -1;
  }

  function shouldExecuteOnEnter(row) {
    if (!row || row.isDir) return false;
    var path = row._fullPath || row.name;
    var isRemote = path.indexOf('docker://') === 0 || path.indexOf('ssh://') === 0;
    var ext = (row.name || '').split('.').pop().toLowerCase();
    // Scripts always run in terminal
    if (ext === 'bat' || ext === 'cmd' || ext === 'ps1' || ext === 'exe') return true;
    // .sh runs only on remote (docker/ssh), otherwise needs executable flag
    if (ext === 'sh' && isRemote) return true;
    // Regular executables (marked with 'x' in permissions)
    return isExecutable(row);
  }

  // ── Keyboard handler ────────────────────────────────────────
  document.addEventListener('keydown', function(e) {
    var p = activePanel;
    var data = panels[p];
    var key = e.key;
    var tag = document.activeElement ? document.activeElement.tagName : '';
    var isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    // Ctrl+A — select all files in active panel
    if ((e.ctrlKey || e.metaKey) && (key === 'a' || key === 'A')) {
      e.preventDefault();
      if (data && data.entries && data.entries.length > 0) {
        for (var i = 0; i < data.entries.length; i++) data.selection.add(i);
        renderTable(p);
      }
      return;
    }

    // Ctrl+Enter — send file path to terminal + space
    if ((e.ctrlKey || e.metaKey) && (key === 'Enter')) {
      e.preventDefault();
      var row = getFocusedRow(p);
      if (row && !row.isDir) {
        vscode.postMessage({ command: 'sendPathToTerminal', panel: p, path: row._fullPath || row.name });
      }
      return;
    }

    // Ctrl+R — refresh active panel
    if ((e.ctrlKey || e.metaKey) && (key === 'r' || key === 'R')) {
      e.preventDefault();
      vscode.postMessage({ command: 'refresh', panel: p });
      return;
    }

    // Ctrl+C — copy selected file paths to clipboard
    if ((e.ctrlKey || e.metaKey) && (key === 'c' || key === 'C')) {
      e.preventDefault();
      var selPaths = getSelectedPaths(p);
      if (selPaths.length > 0) {
        _clipboard = { paths: selPaths.slice(), action: 'copy' };
        try { navigator.clipboard.writeText(selPaths.join('\\n')); } catch {}
      }
      return;
    }

    // Ctrl+X — cut selected file paths to clipboard
    if ((e.ctrlKey || e.metaKey) && (key === 'x' || key === 'X')) {
      e.preventDefault();
      var selPathsX = getSelectedPaths(p);
      if (selPathsX.length > 0) {
        _clipboard = { paths: selPathsX.slice(), action: 'move' };
        try { navigator.clipboard.writeText(selPathsX.join('\\n')); } catch {}
      }
      return;
    }

    // Ctrl+V — paste from clipboard to active panel directory
    if ((e.ctrlKey || e.metaKey) && (key === 'v' || key === 'V')) {
      e.preventDefault();
      if (_clipboard.paths.length > 0 && data) {
        var destDir = data.currentPath;
        vscode.postMessage({ command: 'clipboardPaste', paths: _clipboard.paths.slice(), action: _clipboard.action, destDir: destDir });
      }
      return;
    }

    // Ctrl+L — count files and total size of selected entries
    if ((e.ctrlKey || e.metaKey) && (key === 'l' || key === 'L')) {
      e.preventDefault();
      var pathsL = getSelectedPaths(p);
      if (pathsL.length > 0) {
        vscode.postMessage({ command: 'computeSelectionInfo', panel: p, paths: pathsL });
      }
      return;
    }

    // Ctrl+U — swap panel positions (left ↔ right)
    if ((e.ctrlKey || e.metaKey) && (key === 'u' || key === 'U')) {
      e.preventDefault();
      vscode.postMessage({ command: 'swapPanels' });
      return;
    }

    // F3-F8 actions
    if (key === 'F3') { e.preventDefault(); var fRow3 = getFocusedRow(p); if (fRow3 && !fRow3.isDir) vscode.postMessage({ command: 'previewFile', panel: p, path: fRow3._fullPath || fRow3.name }); return; }
    if (key === 'F4') { e.preventDefault(); var fRow4 = getFocusedRow(p); if (fRow4 && !fRow4.isDir) vscode.postMessage({ command: 'viewFile', panel: p, path: fRow4._fullPath || fRow4.name }); return; }
    if (key === 'F5') { e.preventDefault(); e.stopImmediatePropagation(); doAction('copy'); return; }
    if (key === 'F6') { e.preventDefault(); e.stopImmediatePropagation(); doAction('move'); return; }
    if (key === 'F7') { e.preventDefault(); e.stopImmediatePropagation(); doAction('mkdir'); return; }
    if (key === 'F8' || key === 'Delete') { e.preventDefault(); e.stopImmediatePropagation(); doAction('delete'); return; }

    // When editing an input, only handle keys that should work globally (F5-F8, Tab, Esc)
    if (isInput) {
      // Tab between panels
      if (key === 'Tab') {
        e.preventDefault();
        var next = activePanel === 'L' ? 'R' : 'L';
        toggleActive(next);
        // Blur the input so focus moves to the activated panel
        document.activeElement && document.activeElement.blur();
        document.body.focus();
      }
      return;
    }

    switch (key) {
      case 'Tab':
        e.preventDefault();
        var next = activePanel === 'L' ? 'R' : 'L';
        toggleActive(next);
        break;
      case 'ArrowDown':
        e.preventDefault();
        focusRow(p, (data ? data.focused : -1) + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusRow(p, (data ? data.focused : -1) - 1);
        break;
      case 'Enter':
        e.preventDefault();
        activateRow(p);
        break;
      case 'Backspace':
        e.preventDefault();
        vscode.postMessage({ command: 'goBack', panel: p });
        break;
      case 'Escape':
        // Do nothing — let default behavior handle it (blur focus, etc.)
        break;
      case 'PageDown':
        e.preventDefault();
        // Move down by the number of visible rows in the panel
        (function() {
          var wrap = document.getElementById(D + '-panel-' + p).querySelector('.dpfs-table-body-wrap');
          var rowH = 20; // approximate row height
          var visible = wrap ? Math.floor(wrap.clientHeight / rowH) : 10;
          focusRow(p, (data ? data.focused : -1) + Math.max(visible, 1));
        })();
        break;
      case 'PageUp':
        e.preventDefault();
        (function() {
          var wrap = document.getElementById(D + '-panel-' + p).querySelector('.dpfs-table-body-wrap');
          var rowH = 20;
          var visible = wrap ? Math.floor(wrap.clientHeight / rowH) : 10;
          focusRow(p, (data ? data.focused : -1) - Math.max(visible, 1));
        })();
        break;
      case 'Home':
        e.preventDefault();
        focusRow(p, 0);
        break;
      case 'End':
        e.preventDefault();
        focusRow(p, 999999);
        break;
      case 'Shift':
        // Shift held — will be handled on arrow
        break;
      default:
        // Ignore
        return;
    }
  });

  // Handle Shift + Arrow for selection (keydown set a flag, keyup clears it)
  var shiftHeld = false;
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Shift') shiftHeld = true;
  });
  document.addEventListener('keyup', function(e) {
    if (e.key === 'Shift') shiftHeld = false;
  });

  // Override shift-aware navigation
  var origFocusRow = focusRow;
  focusRow = function(panelId, idx) {
    var data = panels[panelId];
    if (!data) return;
    if (shiftHeld && data.focused >= 0) {
      // Shift + Arrow: toggle selection of the CURRENT item, then move
      var cur = data.focused;
      if (data.selection.has(cur)) {
        data.selection.delete(cur);
      } else {
        data.selection.add(cur);
      }
    }
    // Plain arrows: preserve existing selection, just move focus
    origFocusRow(panelId, idx);
  };

  // Click on row → focus, switch panel on click
  document.addEventListener('click', function(e) {
    var tr = e.target.closest('tr');
    if (tr) {
      var panelId = tr.getAttribute('data-panel') || activePanel;
      var idx = parseInt(tr.getAttribute('data-idx'), 10);
      if (!isNaN(idx)) {
        var data = panels[panelId];
        if (data) {
          if (shiftHeld) {
            // Shift+click: extend selection
            var start = Math.min(data.focused >= 0 ? data.focused : idx, idx);
            var end = Math.max(data.focused >= 0 ? data.focused : idx, idx);
            for (var i = start; i <= end; i++) data.selection.add(i);
            data.focused = idx;
            toggleActive(panelId);
            renderTable(panelId);
          } else if (e.ctrlKey || e.metaKey) {
            // Ctrl+click: toggle single item
            if (data.selection.has(idx)) {
              data.selection.delete(idx);
            } else {
              data.selection.add(idx);
            }
            data.focused = idx;
            toggleActive(panelId);
            renderTable(panelId);
          } else if (data.focused === idx && activePanel === panelId) {
            // Plain click on same focused row in active panel → activate
            activateRow(panelId);
            return;
          } else {
            // Plain click: clear selection, switch panel, move focus
            data.selection.clear();
            data.focused = idx;
            toggleActive(panelId);
            renderTable(panelId);
          }
        }
      }
      return;
    }
  });

  // Double-click row → activate
  document.addEventListener('dblclick', function(e) {
    var tr = e.target.closest('tr');
    if (tr) {
      var panelId = tr.getAttribute('data-panel') || activePanel;
      activateRow(panelId);
    }
  });

  // Click on empty area of a panel → switch active panel
  document.addEventListener('click', function(e) {
    // Skip if clicking a row (handled above), divider, statusbar, or header
    if (e.target.closest('tr')) return;
    if (e.target.closest('.dpfs-panel-divider')) return;
    if (e.target.closest('.dpfs-statusbar')) return;
    if (e.target.closest('.dpfs-panel-header')) return;
    var panelEl = e.target.closest('.dpfs-panel');
    if (panelEl) {
      var panelId = panelEl.id.slice(-1);
      if (panelId !== activePanel) {
        toggleActive(panelId);
      }
    }
  });

  function doNavigate(panelId, uri) {
    updateLabel(panelId, uri);
    vscode.postMessage({ command: 'navigateToUri', panel: panelId, uri: uri });
  }

  // URL Go buttons
  document.querySelectorAll('[data-panel]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var p = btn.getAttribute('data-panel');
      var urlInput = document.getElementById(D+'-url-'+p);
      if (urlInput) doNavigate(p, urlInput.value);
    });
  });

  // Per-panel URL Enter
  document.querySelectorAll('.dpfs-panel-url').forEach(function(input) {
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        var p = input.id.slice(-1);
        doNavigate(p, input.value);
      }
    });
  });

  function getSelectedPaths(panelId) {
    var data = panels[panelId];
    if (!data || !data.entries) return [];
    var paths = [];
    if (data.selection && data.selection.size > 0) {
      data.selection.forEach(function(idx) {
        var row = data.entries[idx];
        if (row) paths.push(row._fullPath || row.name);
      });
    } else if (data.focused >= 0) {
      var row = data.entries[data.focused];
      if (row) paths.push(row._fullPath || row.name);
    }
    return paths;
  }

  function doAction(action) {
    var entries = getSelectedPaths(activePanel);
    if (action === 'compare') {
      var other = activePanel === 'L' ? 'R' : 'L';
      var otherEntries = getSelectedPaths(other);
      console.log('[dpfs] doAction compare', entries, otherEntries);
      vscode.postMessage({ command: 'action', action: action, panel: activePanel, entries: entries, otherEntries: otherEntries });
    } else {
      console.log('[dpfs] doAction', action, entries);
      vscode.postMessage({ command: 'action', action: action, panel: activePanel, entries: entries });
    }
  }

  // Divider buttons (between panels)
  document.querySelectorAll('.dpfs-divider-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      doAction(btn.getAttribute('data-action'));
    });
  });

  // Statusbar action buttons
  document.querySelectorAll('.dpfs-statusbar [data-action]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      doAction(btn.getAttribute('data-action'));
    });
  });

  // ── Handle messages from extension host ─────────────────────
  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (msg.type === 'panelData') {
      setPanelData(msg.panel, msg.entries || []);
      // update URL bar and label
      if (msg.uri) {
        var urlInput = document.getElementById(D+'-url-'+msg.panel);
        if (urlInput) urlInput.value = msg.uri;
        updateLabel(msg.panel, msg.uri);
      }
    }
    if (msg.type === 'info') {
      var info = document.getElementById(D+'-info');
      if (info) info.textContent = msg.text || '';
    }
    if (msg.type === 'loading') {
      var spinner = document.getElementById(D+'-spinner');
      if (spinner) spinner.classList.add('active');
      var info = document.getElementById(D+'-info');
      if (info) info.textContent = msg.text || 'Loading...';
    }
    if (msg.type === 'loaded') {
      var spinner = document.getElementById(D+'-spinner');
      if (spinner) spinner.classList.remove('active');
    }
  });

  // Initialise divider arrows
  updateDividerArrows();

  // Focus the webview body so keyboard events are captured
  document.body.setAttribute('tabindex', '0');
  document.body.focus();

  // Expose API for external use
  window.__dpfsApi = {
    setPanelData: setPanelData,
    toggleActive: toggleActive,
    activePanel: function() { return activePanel; }
  };
})();
`;
}
