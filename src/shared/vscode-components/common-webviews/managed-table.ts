/**
 * managed-table — Generic webview table component for common-webviews.
 *
 * Provides a standard HTML/CSS layout for table-based webviews:
 * - Fixed header row (position:sticky) while the table body scrolls
 * - Integrated filter/search toolbar
 * - Actions button (···) with dropdown menu in the top-right corner
 * - Reload button with rotating refresh icon
 *
 * The layout uses a flex-column body so the toolbar and table header
 * stay fixed while only the table body scrolls.
 */

export interface ManagedTableColumn {
  id: string;
  label: string;
  /** Optional source field name in the backing data source. Defaults to id. */
  sourceField?: string;
  /** Optional semantic type hint for clients. */
  type?: 'text' | 'html' | 'number' | 'date' | 'status' | 'custom' | 'badge';
  /** Text alignment for this column. Defaults to 'left'. */
  align?: 'left' | 'right' | 'center';
  /** Optional CSS width value (e.g. '80px', '10%'). */
  width?: string;
  /** When true, renders a checkbox column header with a select-all control. */
  selectAll?: boolean;

  /** Custom cell renderer. Receives raw cell value and the full row, returns HTML string. */
  formatter?: (value: any, rowData: any) => string;

  /** For type: 'badge' — maps status value to CSS class, e.g. { success: 'badge-ok', failure: 'badge-fail' } */
  badgeClassMap?: Record<string, string>;

  /** Inline action buttons to render in this cell (e.g. Retry/Cancel per row). */
  actions?: Array<{ id: string; label: string; className?: string }>;

  /** When true, row becomes clickable and emits rowSelected event. */
  clickable?: boolean;
}

export interface ManagedTableFilterOption {
  value: string;
  label: string;
}

export interface ManagedTableFilterControl {
  id: string;
  label?: string;
  type?: 'text' | 'select';
  placeholder?: string;
  value?: string;
  width?: string;
  options?: ManagedTableFilterOption[];
}

export interface ManagedTableAction {
  id: string;
  label: string;
}

export interface ManagedTableOptions {
  /** Column definitions. */
  columns: ManagedTableColumn[];
  /** Optional title shown in the toolbar row, alongside the reload/actions buttons. */
  title?: string;
  /** DOM id for the title element. */
  titleId?: string;
  /** Optional table DOM id. */
  tableId?: string;
  /** DOM id for the table <tbody> element. */
  bodyId?: string;
  /** Whether to render the default free-text filter input. Defaults to true. */
  showTextFilter?: boolean;
  /** Placeholder text for the filter input. */
  filterPlaceholder?: string;
  /** DOM id for the filter input. */
  filterId?: string;
  /** Extra filter controls to render in the toolbar. */
  filterControls?: ManagedTableFilterControl[];
  /** Actions to show in the actions dropdown menu. */
  actions?: ManagedTableAction[];
  /** DOM id for the reload button. */
  reloadButtonId?: string;
  /** DOM id for the actions button. */
  actionsButtonId?: string;
  /** DOM id for the actions menu container. */
  actionsMenuId?: string;
  /** DOM id for the status text element. */
  statusId?: string;
  /** If set, a detail panel div with this id is rendered below the table and toggled on row click. */
  detailPanelId?: string;
}

/** Row data structure for managed-table rows. */
export interface ManagedTableRow {
  id: string;
  cells: Record<string, any>;
  selected?: boolean;
  /** Optional CSS class(es) applied to the <tr> element. */
  className?: string;
  /** Arbitrary metadata attached to the row, retrievable via getRowMeta(). */
  meta?: Record<string, any>;
}

/**
 * Returns the base CSS string for a managed table layout.
 * Include this inside a <style> tag in the webview HTML.
 */
export function getManagedTableStyles(): string {
  return `
    html, body {
      height: 100%;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .managed-table-toolbar {
      display: flex;
      flex-direction: column;
      gap: 0;
      padding: 6px 10px;
      background: var(--vscode-editor-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }
    .managed-table-toolbar-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .managed-table-toolbar-row + .managed-table-toolbar-row {
      margin-top: 4px;
    }
    .managed-table-toolbar-row input[type="text"] {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 4px 8px;
      border-radius: 4px;
      min-width: 200px;
    }
    .managed-table-toolbar-spacer {
      flex: 1;
    }
    .managed-table-status {
      flex-shrink: 0;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      padding: 0 10px 6px 10px;
    }
    .managed-table-container {
      flex: 1;
      min-height: 0;
      overflow: auto;
      border-top: 1px solid var(--vscode-panel-border);
    }
    .managed-table-container table {
      width: 100%;
      border-collapse: collapse;
    }
    .managed-table-container thead th {
      position: sticky;
      top: 0;
      background: var(--vscode-editor-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      padding: 6px 8px;
      text-align: left;
      font-size: 12px;
      font-weight: 600;
      z-index: 10;
      white-space: nowrap;
    }
    .managed-table-container thead th.align-right { text-align: right; }
    .managed-table-container thead th.align-center { text-align: center; }
    .managed-table-container tbody td {
      border-bottom: 1px solid var(--vscode-panel-border);
      padding: 5px 8px;
      font-size: 12px;
    }
    .managed-table-container tbody td.align-right { text-align: right; }
    .managed-table-container tbody td.align-center { text-align: center; }
    .managed-table-container tbody tr:hover td {
      background: var(--vscode-list-hoverBackground);
    }
    .managed-table-title {
      font-size: 16px;
      font-weight: 600;
      margin: 0;
      white-space: nowrap;
    }
    .managed-btn {
      background: var(--vscode-button-secondaryBackground, transparent);
      border: 1px solid var(--vscode-panel-border);
      color: var(--vscode-foreground);
      cursor: pointer;
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      white-space: nowrap;
    }
    .managed-btn:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .managed-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .managed-reload-btn {
      font-size: 16px;
      padding: 2px 8px;
      position: relative;
    }
    .managed-reload-btn .reload-icon {
      display: inline-block;
    }
    .managed-reload-btn.refreshing .reload-icon {
      animation: managed-table-spin 0.8s linear infinite;
    }
    @keyframes managed-table-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .managed-actions-btn {
      font-weight: 700;
      letter-spacing: 0.05em;
      position: relative;
    }
    .managed-actions-menu-wrap {
      position: relative;
      display: inline-block;
    }
    /* Badge styles for type: 'badge' columns */
    .managed-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 500;
    }
    .managed-badge-ok,
    .managed-badge-success,
    .managed-badge-passed { background: #1a7f37; color: #fff; }
    .managed-badge-fail,
    .managed-badge-failure,
    .managed-badge-failed { background: #cf222e; color: #fff; }
    .managed-badge-warn,
    .managed-badge-warnings { background: #9a6700; color: #fff; }
    .managed-badge-running { background: #0065ff; color: #fff; }
    .managed-badge-waiting,
    .managed-badge-pending { background: #e07000; color: #fff; }
    .managed-badge-idle { background: #6e7781; color: #fff; }
    .managed-badge-offline { background: #6e7781; color: #fff; }
    .managed-badge-closed,
    .managed-badge-merged { background: #8250df; color: #fff; }
    .managed-badge-draft { background: #6e7781; color: #fff; }
    .managed-badge-open { background: #1a7f37; color: #fff; }
    .managed-badge-default {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    /* Inline action buttons rendered in cells */
    .managed-inline-action-btn {
      background: var(--vscode-button-secondaryBackground, transparent);
      border: 1px solid var(--vscode-panel-border);
      color: var(--vscode-foreground);
      cursor: pointer;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 11px;
      margin-right: 4px;
      white-space: nowrap;
    }
    .managed-inline-action-btn:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .managed-inline-action-btn.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
    }
    /* Clickable row styling */
    .managed-table-container tbody tr.clickable {
      cursor: pointer;
    }
    .managed-table-container tbody tr.clickable:hover td {
      background: var(--vscode-list-hoverBackground);
    }
    /* Detail panel below the table */
    .managed-detail-panel {
      display: none;
      border-top: 1px solid var(--vscode-panel-border);
      padding: 10px;
      background: var(--vscode-editor-background);
      flex-shrink: 0;
      max-height: 40%;
      overflow: auto;
    }
    .managed-detail-panel.visible {
      display: block;
    }
  `;
}

/**
 * Returns the HTML string for the managed table toolbar and table structure.
 * Wire the interactive behaviour with getManagedTableScript().
 */
export function getManagedTableHtml(options: ManagedTableOptions): string {
  const {
    columns,
    title,
    titleId = 'managedTableTitle',
    tableId = 'managedTable',
    bodyId = 'managedTableBody',
    showTextFilter = true,
    filterPlaceholder = 'Filter...',
    filterId = 'managedTableFilter',
    filterControls = [],
    actions = [],
    reloadButtonId = 'managedReloadBtn',
    actionsButtonId = 'managedActionsBtn',
    actionsMenuId = 'managedActionsMenu',
    statusId = 'managedTableStatus',
    detailPanelId,
  } = options;

  const titleHtml = title ? `<h1 id="${titleId}" class="managed-table-title">${title}</h1>` : '';

  const reloadBtnHtml = `<button id="${reloadButtonId}" class="managed-btn managed-reload-btn" title="Reload" type="button"><span class="reload-icon">↻</span></button>`;

  const actionsMenuHtml = actions.length > 0
    ? `<div class="managed-actions-menu-wrap">
        <button id="${actionsButtonId}" class="managed-btn managed-actions-btn" type="button" disabled data-actions="${actions.map(a => `${a.id}:${a.label}`).join('|')}">···</button>
      </div>`
    : '';

  const textFilterHtml = showTextFilter
    ? `<input id="${filterId}" type="text" placeholder="${filterPlaceholder}" />`
    : '';

  const extraFiltersHtml = filterControls.map(control => {
    const type = control.type ?? 'text';
    const widthStyle = control.width ? ` style="width:${control.width}"` : '';
    const labelPrefix = control.label ? `<label for="${control.id}">${control.label}</label>` : '';

    if (type === 'select') {
      const optionsHtml = (control.options ?? [])
        .map(o => `<option value="${o.value}">${o.label}</option>`)
        .join('');
      return `${labelPrefix}<select id="${control.id}"${widthStyle}>${optionsHtml}</select>`;
    }

    return `${labelPrefix}<input id="${control.id}" type="text" placeholder="${control.placeholder ?? ''}" value="${control.value ?? ''}"${widthStyle} />`;
  }).join('');

  const colHeaders = columns.map(col => {
    const alignClass = col.align && col.align !== 'left' ? ` class="align-${col.align}"` : '';
    const widthStyle = col.width ? ` style="width:${col.width}"` : '';
    if (col.selectAll) {
      return `<th class="align-center"${widthStyle}><input id="managedSelectAll" type="checkbox" title="Select all visible" /></th>`;
    }
    return `<th data-column-id="${col.id}"${alignClass}${widthStyle}>${col.label}</th>`;
  }).join('');

  return `
  <div class="managed-table-toolbar">
    <div class="managed-table-toolbar-row">
      ${titleHtml}
      <span class="managed-table-toolbar-spacer"></span>
      ${reloadBtnHtml}
      ${actionsMenuHtml}
    </div>
    <div class="managed-table-toolbar-row">
      ${textFilterHtml}
      ${extraFiltersHtml}
    </div>
  </div>
  <div id="${statusId}" class="managed-table-status"></div>
  <div class="managed-table-container">
    <table id="${tableId}">
      <thead><tr>${colHeaders}</tr></thead>
      <tbody id="${bodyId}"></tbody>
    </table>
  </div>
  ${detailPanelId ? `<div id="${detailPanelId}" class="managed-detail-panel"></div>` : ''}`;
}

/**
 * Returns a JavaScript snippet to wire up the standard managed table interactions:
 * - Reload button spinning state
 * - Actions menu open/close (including outside-click)
 * - Exposes window.__managedSetRefreshing(active) for callers to control the spinner
 *
 * @param reloadHandler JS expression to invoke on reload (e.g. 'load()')
 */
export function getManagedTableScript(options: {
  reloadHandler: string;
  columns?: ManagedTableColumn[];
  tableBodyId?: string;
  statusId?: string;
  selectAllId?: string;
  reloadButtonId?: string;
  actionsButtonId?: string;
  actionsMenuId?: string;
}): string {
  const {
    reloadHandler,
    columns = [],
    tableBodyId = 'managedTableBody',
    statusId = 'managedTableStatus',
    selectAllId = 'managedSelectAll',
    reloadButtonId = 'managedReloadBtn',
    actionsButtonId = 'managedActionsBtn',
    actionsMenuId = 'managedActionsMenu',
  } = options;

  const columnConfigJson = JSON.stringify(columns);

  return `
    (function() {
      var columnConfig = ${columnConfigJson};
      var body = document.getElementById('${tableBodyId}');
      var statusEl = document.getElementById('${statusId}');
      var selectAll = document.getElementById('${selectAllId}');
      var reloadBtn = document.getElementById('${reloadButtonId}');
      var actionsBtn = document.getElementById('${actionsButtonId}');
      var actionHandlers = [];
      var rowClickHandlers = [];
      var rowMetaStore = {};

      function escapeHtml(value) {
        return String(value == null ? '' : value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function syncSelectAll() {
        if (!selectAll || !body) { return; }
        var boxes = body.querySelectorAll('input.managed-row-select');
        if (!boxes || boxes.length === 0) {
          selectAll.checked = false;
          selectAll.indeterminate = false;
          return;
        }
        var checked = 0;
        boxes.forEach(function(box) { if (box.checked) { checked += 1; } });
        selectAll.checked = checked === boxes.length;
        selectAll.indeterminate = checked > 0 && checked < boxes.length;
      }

      function getSelectedRowIds() {
        if (!body) { return []; }
        var boxes = body.querySelectorAll('input.managed-row-select:checked');
        var ids = [];
        boxes.forEach(function(box) {
          var id = box.getAttribute('data-row-id') || box.value || '';
          if (id) { ids.push(id); }
        });
        return ids;
      }

      function setStatus(text) {
        if (!statusEl) { return; }
        statusEl.textContent = text == null ? '' : String(text);
      }

      function setActionsEnabled(enabled) {
        if (!actionsBtn) { return; }
        actionsBtn.disabled = !enabled;
      }

      function clearRows() {
        if (!body) { return; }
        body.innerHTML = '';
        syncSelectAll();
      }

      function setRows(rows) {
        if (!body) { return; }
        var renderedRows = Array.isArray(rows) ? rows : [];
        body.innerHTML = '';
        rowMetaStore = {};

        renderedRows.forEach(function(row) {
          var tr = document.createElement('tr');
          var rowId = row && row.id != null ? String(row.id) : '';
          if (rowId) {
            tr.setAttribute('data-row-id', rowId);
          }

          // Apply optional CSS class to the row
          if (row && row.className) {
            tr.className = row.className;
          }

          // Store row metadata
          if (rowId && row && row.meta) {
            rowMetaStore[rowId] = row.meta;
          }

          // Check if any column is clickable — mark row as clickable
          var hasClickable = false;

          (columnConfig || []).forEach(function(column) {
            var td = document.createElement('td');
            if (column && column.align && column.align !== 'left') {
              td.className = 'align-' + column.align;
            }

            if (column && column.selectAll) {
              td.className = (td.className ? td.className + ' ' : '') + 'col-check';
              var cb = document.createElement('input');
              cb.type = 'checkbox';
              cb.className = 'managed-row-select';
              cb.value = rowId;
              cb.setAttribute('data-row-id', rowId);
              cb.checked = !!(row && row.selected);
              cb.addEventListener('change', syncSelectAll);
              td.appendChild(cb);
              tr.appendChild(td);
              return;
            }

            // Inline action buttons column
            if (column && column.actions && Array.isArray(column.actions) && column.actions.length > 0) {
              column.actions.forEach(function(action) {
                var btn = document.createElement('button');
                btn.className = 'managed-inline-action-btn' + (action.className ? ' ' + action.className : '');
                btn.textContent = action.label;
                btn.setAttribute('data-action-id', action.id);
                btn.setAttribute('data-row-id', rowId);
                td.appendChild(btn);
              });
              tr.appendChild(td);
              return;
            }

            var rawValue = row && row.cells ? row.cells[column.id] : '';
            var cellHtml = '';

            // Check for formatter callback
            if (column && typeof column.formatter === 'function') {
              cellHtml = String(column.formatter(rawValue, row));
              td.innerHTML = cellHtml;
            } else if (column && column.type === 'badge') {
              // Badge type rendering
              var badgeText = rawValue == null ? '' : String(rawValue);
              var badgeClassMap = column.badgeClassMap || {};
              var badgeCls = badgeClassMap[badgeText] || 'managed-badge-default';
              td.innerHTML = '<span class="managed-badge ' + badgeCls + '">' + escapeHtml(badgeText) + '</span>';
            } else if (rawValue && typeof rawValue === 'object' && rawValue.html != null) {
              td.innerHTML = String(rawValue.html);
            } else {
              td.innerHTML = escapeHtml(rawValue == null ? '' : rawValue);
            }

            if (column && column.clickable) {
              hasClickable = true;
            }

            tr.appendChild(td);
          });

          if (hasClickable) {
            tr.classList.add('clickable');
          }

          body.appendChild(tr);
        });

        syncSelectAll();
      }

      function onAction(handler) {
        if (typeof handler === 'function') {
          actionHandlers.push(handler);
        }
      }

      function onRowClick(handler) {
        if (typeof handler === 'function') {
          rowClickHandlers.push(handler);
        }
      }

      function getRowMeta(rowId) {
        return rowMetaStore[rowId];
      }

      if (selectAll && body) {
        selectAll.addEventListener('change', function() {
          var checked = !!selectAll.checked;
          body.querySelectorAll('input.managed-row-select').forEach(function(box) {
            box.checked = checked;
          });
          syncSelectAll();
        });
      }

      function setRefreshing(active) {
        if (!reloadBtn) { return; }
        if (active) {
          reloadBtn.classList.add('refreshing');
          reloadBtn.disabled = true;
        } else {
          reloadBtn.classList.remove('refreshing');
          reloadBtn.disabled = false;
        }
      }

      if (reloadBtn) {
        reloadBtn.addEventListener('click', function() {
          setRefreshing(true);
          ${reloadHandler}
        });
      }

      if (actionsBtn) {
        actionsBtn.addEventListener('click', function() {
          if (actionsBtn.disabled) { return; }
          var raw = actionsBtn.getAttribute('data-actions') || '';
          var actions = raw ? raw.split('|').map(function(entry) {
            var idx = entry.indexOf(':');
            return idx < 0 ? { id: entry, label: entry } : { id: entry.slice(0, idx), label: entry.slice(idx + 1) };
          }) : [];
          vscode.postMessage({ type: 'showActionsMenu', actions: actions });
        });
      }

      // Event delegation for inline action buttons and clickable rows
      if (body) {
        body.addEventListener('click', function(e) {
          // Check for inline action button click
          var actionBtn = e.target.closest('.managed-inline-action-btn');
          if (actionBtn) {
            e.stopPropagation();
            var actionId = actionBtn.getAttribute('data-action-id') || '';
            var rowId = actionBtn.getAttribute('data-row-id') || '';
            actionHandlers.forEach(function(handler) {
              try { handler(actionId, rowId); } catch (_err) {}
            });
            return;
          }

          // Check for row click (clickable rows)
          var row = e.target.closest('tr.clickable');
          if (row) {
            var rid = row.getAttribute('data-row-id') || '';
            rowClickHandlers.forEach(function(handler) {
              try { handler(rid); } catch (_err) {}
            });
          }
        });
      }

      window.addEventListener('message', function(event) {
        var msg = event.data;
        if (msg && msg.type === 'actionSelected') {
          var actionId = String(msg.actionId || '');
          actionHandlers.forEach(function(handler) {
            try { handler(actionId); } catch (_err) {}
          });
        }
      });

      window.__managedSetRefreshing = setRefreshing;
      window.__managedTableApi = {
        setRefreshing: setRefreshing,
        setStatus: setStatus,
        setActionsEnabled: setActionsEnabled,
        clearRows: clearRows,
        setRows: setRows,
        getSelectedRowIds: getSelectedRowIds,
        onAction: onAction,
        onRowClick: onRowClick,
        getRowMeta: getRowMeta,
      };
    })();
  `;
}
