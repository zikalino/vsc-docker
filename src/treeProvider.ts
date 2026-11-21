import * as vscode from 'vscode';
import * as cp from 'child_process';
import { DefinitionLoader } from './definitionLoader';
import { resolveJsonPath } from './jsonPath';

// ---------------------------------------------------------------------------
// Icon helpers – maps item types to icons
// ---------------------------------------------------------------------------

const ITEM_ICONS: Record<string, vscode.ThemeIcon> = {
  'docker-image': new vscode.ThemeIcon('package'),
  'docker-container': new vscode.ThemeIcon('symbol-structure'),
  'docker-container-running': new vscode.ThemeIcon('debug-start'),
  'docker-container-stopped': new vscode.ThemeIcon('debug-stop'),
  'docker-container-paused': new vscode.ThemeIcon('debug-pause'),
  'docker-registry-list': new vscode.ThemeIcon('database'),
  'docker-registry': new vscode.ThemeIcon('database'),
  welcome: new vscode.ThemeIcon('home'),
  docker: new vscode.ThemeIcon('server-environment'),
  generic: new vscode.ThemeIcon('question'),
};

/** Maps container state names to SVG icon filenames in the media folder */
const STATE_SVG_ICONS: Record<string, string> = {
  started: 'icon-state-started.svg',
  stopped: 'icon-state-stopped.svg',
};

function getIconForType(
  type: string | undefined,
  state: string | undefined,
  extensionPath: string
): vscode.ThemeIcon | vscode.Uri | undefined {
  if (!type) { return undefined; }

  // Prefer state-specific SVG icon for containers
  if (type === 'docker-container' && state && state in STATE_SVG_ICONS) {
    return vscode.Uri.joinPath(
      vscode.Uri.file(extensionPath), 'media', STATE_SVG_ICONS[state]
    );
  }

  // Prefer state-specific theme icon (fallback)
  if (type === 'docker-container' && state) {
    const key = `docker-container-${state}` as keyof typeof ITEM_ICONS;
    if (key in ITEM_ICONS) { return ITEM_ICONS[key]; }
  }

  return ITEM_ICONS[type] ?? undefined;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DockerYamlItem {
  name: string;
  description?: string;
  id: string;
  icon?: string;
  details?: string;
  type?: string;
  generic_type?: string;
  subitems?: DockerYamlItem[];
  raw?: any;
  [key: string]: any;
}

interface TreeTemplates {
  'item-sources'?: any[];
  'detail-sources'?: any[];
  extractors?: any[];
  operations?: any[];
  'detail-templates'?: any[];
}

// ---------------------------------------------------------------------------
// Tree item
// ---------------------------------------------------------------------------

export class DockerTreeItem extends vscode.TreeItem {
  constructor(
    public readonly data: DockerYamlItem,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly extensionPath: string,
    public readonly parentType?: string
  ) {
    super(data.name, collapsibleState);
    this.id = data.id;
    this.description = data.description;
    this.tooltip = data.description || data.name;
    this.contextValue = data.type || 'docker-item';

    // Icon: state-based container SVG has highest priority
    if (data.type === 'docker-container' && data.state) {
      const icon = getIconForType(data.type, data.state, extensionPath);
      if (icon instanceof vscode.ThemeIcon || icon instanceof vscode.Uri) {
        this.iconPath = icon;
      }
    } else if (data.icon && !data.icon.endsWith('.svg') && !data.icon.endsWith('.png')) {
      // Could be a codicon string like "$(debug-start)" stored in YAML
      const codiconName = data.icon.replace('$(', '').replace(')', '');
      this.iconPath = new vscode.ThemeIcon(codiconName);
    } else if (data.icon) {
      this.iconPath = vscode.Uri.joinPath(
        vscode.Uri.file(extensionPath), 'media', data.icon
      );
    } else {
      const icon = getIconForType(data.type, data.state, extensionPath);
      if (icon instanceof vscode.ThemeIcon || icon instanceof vscode.Uri) {
        this.iconPath = icon;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tree data provider
// ---------------------------------------------------------------------------

export class DockerTreeProvider implements vscode.TreeDataProvider<DockerTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<DockerTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private rootItems: DockerYamlItem[] = [];
  private templates: TreeTemplates = {};
  private extensionPath: string;

  constructor(extensionPath: string) {
    this.extensionPath = extensionPath;
    this.loadTree();
  }

  // ---- public API -------------------------------------------------------

  refresh(): void {
    this.loadTree();
    this._onDidChangeTreeData.fire(undefined);
  }

  refreshItem(item: DockerTreeItem): void {
    this._onDidChangeTreeData.fire(item);
  }

  /** Get the provider's extension path (useful for command handlers) */
  getExtensionPath(): string { return this.extensionPath; }

  /** Execute a shell command and return stdout */
  execShell(cmd: string): string {
    try {
      if (process.platform === 'win32') {
        return cp.execSync(cmd, { shell: 'powershell' }).toString().trim();
      } else {
        return cp.execSync(cmd, { shell: '/bin/bash' }).toString().trim();
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(`Command failed: ${e.message}`);
      return '';
    }
  }

  getTreeItem(element: DockerTreeItem): vscode.TreeItem {
    return element;
  }

  getParent(element: DockerTreeItem): DockerTreeItem | undefined {
    // Parent tracking is optional – TreeView falls back to flattening
    return undefined;
  }

  async getChildren(element?: DockerTreeItem): Promise<DockerTreeItem[]> {
    if (!element) {
      // Root level – return static tree items
      return this.rootItems.map(item =>
        this.buildTreeItem(item, this.getCollapsible(item))
      );
    }

    // Return static subitems if present
    if (element.data.subitems && element.data.subitems.length > 0) {
      return element.data.subitems.map(item =>
        this.buildTreeItem(item, this.getCollapsible(item))
      );
    }

    // Try dynamic children
    const childrenQuery = this.findChildrenQuery(element.data);
    if (childrenQuery) {
      return this.queryDynamicChildren(element.data, childrenQuery, element);
    }

    return [];
  }

  // ---- load tree from YAML ----------------------------------------------

  private loadTree(): void {
    try {
      const loader = new DefinitionLoader(this.extensionPath, 'defs/____tree.yaml');
      const yaml = loader.getYaml();
      if (yaml && yaml.items) {
        this.rootItems = yaml.items;
      }
    } catch {
      this.rootItems = [];
    }

    try {
      const templateLoader = new DefinitionLoader(
        this.extensionPath, 'defs/____tree_templates.yaml'
      );
      const t = templateLoader.getYaml();
      if (t) {
        this.templates = t;
      }
    } catch {
      this.templates = {};
    }
  }

  // ---- tree item helpers ------------------------------------------------

  private getCollapsible(item: DockerYamlItem): vscode.TreeItemCollapsibleState {
    if (item.subitems && item.subitems.length > 0) {
      return vscode.TreeItemCollapsibleState.Collapsed;
    }
    if (this.findChildrenQuery(item) !== null) {
      return vscode.TreeItemCollapsibleState.Collapsed;
    }
    return vscode.TreeItemCollapsibleState.None;
  }

  private buildTreeItem(
    data: DockerYamlItem,
    state: vscode.TreeItemCollapsibleState,
    parentType?: string
  ): DockerTreeItem {
    return new DockerTreeItem(data, state, this.extensionPath, parentType);
  }

  // ---- template matching ------------------------------------------------

  private findMatchingTemplates(item: DockerYamlItem, all: any[] | undefined): any[] {
    if (!all) { return []; }
    const selected: any[] = [];
    const itemType = item.type;
    const itemTypeGeneric = item.generic_type;

    for (const tmpl of all) {
      const types = tmpl['item-types'];
      if (typeof types === 'string') {
        if (itemType === types || itemTypeGeneric === types) {
          selected.push(tmpl);
        }
      } else if (Array.isArray(types)) {
        if (types.includes(itemType) || types.includes(itemTypeGeneric)) {
          selected.push(tmpl);
        }
      }
    }
    return selected;
  }

  private findChildrenQuery(item: DockerYamlItem): any | null {
    const matches = this.findMatchingTemplates(item, this.templates['item-sources']);
    return matches.length > 0 ? matches[0] : null;
  }

  findDetailQuery(item: DockerYamlItem): any | null {
    const matches = this.findMatchingTemplates(item, this.templates['detail-sources']);
    return matches.length > 0 ? matches[0] : null;
  }

  findExtractors(item: DockerYamlItem): any[] {
    return this.findMatchingTemplates(item, this.templates['extractors']);
  }

  findOperationsForType(itemType: string): any[] {
    const all = this.templates['operations'] || [];
    const selected: any[] = [];
    for (const op of all) {
      const types = op['item-types'];
      if (typeof types === 'string') {
        if (itemType === types) { selected.push(op); }
      } else if (Array.isArray(types)) {
        if (types.includes(itemType)) { selected.push(op); }
      }
    }
    return selected;
  }

  findDetailTemplates(item: DockerYamlItem): any[] {
    return this.findMatchingTemplates(item, this.templates['detail-templates']);
  }

  // ---- dynamic children from shell command ------------------------------

  private async queryDynamicChildren(
    parentData: DockerYamlItem,
    query: any,
    parentElement: DockerTreeItem
  ): Promise<DockerTreeItem[]> {
    try {
      const parser = query['parser'] || 'json';
      const data = this.genericQuery(
        this.replaceQueryParameters(query['cmd'], parentData),
        parser
      );

      const ids: string[] = resolveJsonPath(data, query['path-id']);
      const names: string[] = resolveJsonPath(data, query['path-name']);
      const rawArray: any[] = resolveJsonPath(data, query['path-raw']);

      let type = query['item-type'] || 'unknown';
      const genericType = query['item-type-generic'] || 'unknown';

      const items: DockerTreeItem[] = [];
      for (let idx = 0; idx < ids.length; idx++) {
        let itemType = type;
        if (typeof itemType === 'string' && itemType.startsWith('$')) {
          const extracted = resolveJsonPath(rawArray[idx], itemType);
          if (extracted && extracted.length > 0) {
            itemType = extracted[0];
          }
        }

        const item: DockerYamlItem = {
          name: names[idx]?.toString() || ids[idx],
          type: itemType,
          generic_type: genericType,
          id: ids[idx]?.toString() || `item-${idx}`,
          icon: parentData.icon,
          raw: rawArray[idx],
        };

        // Unpack extractor fields (populates state, repo_tag, etc.)
        this.unpackDetails(item);

        // Set state on item so icons can be contextual
        if (item.state) {
          item.state = item.state;
        }

        const canHaveChildren = this.findChildrenQuery(item) !== null;
        const state = canHaveChildren
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None;

        items.push(this.buildTreeItem(item, state, parentData.type));
      }

      items.sort((a, b) => (a.data.name || '').localeCompare(b.data.name || ''));
      return items;
    } catch {
      return [];
    }
  }

  // ---- shell query ------------------------------------------------------

  private genericQuery(cmd: string, parser: string): any {
    let r = '';
    try {
      if (process.platform === 'win32') {
        r = cp.execSync(cmd, { shell: 'powershell' }).toString();
      } else {
        r = cp.execSync(cmd, { shell: '/bin/bash' }).toString();
      }
    } catch {
      return [];
    }

    try {
      if (parser === 'json') {
        return JSON.parse(r);
      } else if (parser === 'rows-json') {
        const lines = r.split(/\r?\n/).filter((l: string) => l.trim().length > 0);
        return lines.map((l: string) => JSON.parse(l));
      }
    } catch {
      // ignore parse errors
    }
    return [];
  }

  private replaceQueryParameters(cmd: string, data: any): string {
    const regex = /\${([a-zA-Z0-9_-]*)}/;
    let result = cmd;
    let match: RegExpExecArray | null;
    do {
      match = regex.exec(result);
      if (match) {
        const key = match[1];
        const value = key in data ? data[key] : 'unknown';
        result = result.replace('${' + key + '}', value);
      }
    } while (match);
    return result;
  }

  // ---- extractor unpacking ----------------------------------------------

  private unpackDetails(item: DockerYamlItem): void {
    const extractors = this.findExtractors(item);
    for (const ext of extractors) {
      if (!ext.fields) { continue; }
      for (const fieldName of Object.keys(ext.fields)) {
        const fieldDef = ext.fields[fieldName];
        let value: any = 'x';
        try {
          const result = resolveJsonPath(item.raw, fieldDef.path);
          if (Array.isArray(result) && result.length > 0) {
            value = result[0];
          }
        } catch {
          // ignore
        }

        // Apply value mapping
        if (fieldDef.map) {
          if (value in fieldDef.map) {
            value = fieldDef.map[value];
          } else {
            for (const k of Object.keys(fieldDef.map)) {
              try {
                const re = new RegExp(k, 'g');
                if (String(value).match(re)) {
                  value = fieldDef.map[k];
                }
              } catch {
                // invalid regex, skip
              }
            }
          }
        }

        item[fieldName] = value;
      }
    }
  }

  // ---- detail query -----------------------------------------------------

  executeDetailQuery(cmd: string): any[] {
    const parser = cmd.includes('--format json') ? 'rows-json' : 'json';
    return this.genericQuery(cmd, parser);
  }

  getOperationCommands(item: DockerYamlItem): any[] {
    const itemType = item.type || '';
    const allOps = this.findOperationsForType(itemType);
    return allOps.filter(op => {
      if (!op.when) { return true; }
      const actualValue = resolveJsonPath(item, op.when.path)[0];
      if (op.when.compare === 'ne') {
        return String(actualValue) !== String(op.when.value);
      }
      return String(actualValue) === String(op.when.value);
    });
  }
}
