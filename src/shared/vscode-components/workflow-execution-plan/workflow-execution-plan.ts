import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import * as vscode from 'vscode';
import { getRootFolder } from './repository';
import { executeCommand } from './terminal';

// Lazy-load the HTML template from the adjacent .html file
let _templateHtml: string | null = null;
function getTemplateHtml(): string {
  if (_templateHtml !== null) {
    return _templateHtml;
  }
  const templatePath = path.join(__dirname, 'workflow-execution-plan.html');
  _templateHtml = fs.readFileSync(templatePath, 'utf8');
  return _templateHtml;
}

export type WorkflowStepStatus = 'successful' | 'failed' | 'running' | 'not-executed' | 'skipped';

export interface FencedBlock {
  language: string;
  content: string;
  lines: string[];
}

export interface WorkflowFailurePattern {
  pattern: RegExp;
  description: string;
}

export interface WorkflowStepExecutionResult {
  success: boolean;
  output?: string[];
  failureDescription?: string;
}

export interface WorkflowFailurePatternDefinition {
  pattern: string;
  description: string;
  flags?: string;
}

export interface WorkflowRestCredentials {
  type: 'bearer' | 'basic' | 'apikey';
  token?: string;
  username?: string;
  password?: string;
  headerName?: string;
}

export interface WorkflowStepInputField {
  type: 'text' | 'selection' | 'multi-select' | 'confirm' | 'file-selector' | 'dynamic-multi-select';
  storeValueTo: string;
  enabled?: boolean;
  default?: string | string[];
  placeholder?: string;
  prompt?: string;
  required?: boolean;
  multiline?: boolean;
  items?: string[];
  /** For dynamic-multi-select: read items from a plan variable */
  itemsFromVariable?: string;
  /** For dynamic-multi-select or dynamic-combo: named query provider registered on the plan */
  queryProviderName?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  message?: string;
  /** For file-selector: allows multiple files */
  multifile?: boolean;
}

export interface WorkflowActionParameter {
  /** Human-readable description of what this parameter represents */
  description: string;
  /** Name of the context variable to read (or empty to skip) */
  variable: string;
}

export type WorkflowActionDescriptor = string | {
  name: string;
  parameters?: WorkflowActionParameter[];
};

export type WorkflowActionCallback = (context: WorkflowExecutionContext, plan: WorkflowExecutionPlan, parameters?: WorkflowActionParameter[]) => Promise<WorkflowStepExecutionResult>;

export interface WorkflowExecutionStepDefinition {
  name: string;
  description: string;
  type?: 'input' | 'shell' | 'rest' | 'extension-api';
  action?: string | { name: string; parameters?: WorkflowActionParameter[] };
  inputs?: WorkflowStepInputField[];
  execution?: string;
  command?: string;
  // REST step fields (type: 'rest')
  endpoint?: string;
  method?: string;
  headers?: Record<string, string>;
  credentials?: WorkflowRestCredentials;
  requestBody?: string;
  // Extension API step fields (type: 'extension-api')
  extensionCommand?: string;
  extensionArgs?: WorkflowVariableValue[];
  failurePatterns?: WorkflowFailurePatternDefinition[];
  abortWorkflowOnFailure?: boolean;
  skipIf?: string;
  storeResultTo?: string;
  skipUnless?: string;
  status?: WorkflowStepStatus;
  failureDescription?: string;
  output?: string[];
  plannedCommands?: string[];
  fencedBlocks?: FencedBlock[];
}

export interface WorkflowExecutionPlanDefinition {
  name: string;
  summary?: string;
  details?: string;
  variables?: WorkflowVariableMap;
  steps: WorkflowExecutionStepDefinition[];
}

export type WorkflowVariableValue = string | string[] | boolean | number | null;
export type WorkflowVariableMap = Record<string, WorkflowVariableValue>;

export interface WorkflowConfirmStepOptions {
  name: string;
  description: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  storeResultAs?: string;
}

export interface WorkflowTextEntryStepOptions {
  name: string;
  description: string;
  title: string;
  placeHolder?: string;
  prompt?: string;
  prefix?: string;
  multiline?: boolean;
  value?: string;
  valueFromVariable?: string;
  storeAs: string;
  required?: boolean;
  /** When false, the input is rendered as read-only/disabled. Default true. */
  enabled?: boolean;
}

export interface WorkflowMultiTextEntryFieldOptions {
  label: string;
  placeHolder?: string;
  prompt?: string;
  value?: string;
  valueFromVariable?: string;
  storeAs: string;
  required?: boolean;
  /** When false, the field is rendered as read-only/disabled. Default true. */
  enabled?: boolean;
}

export interface WorkflowMultiTextEntryStepOptions {
  name: string;
  description: string;
  title: string;
  fields: WorkflowMultiTextEntryFieldOptions[];
}

export interface WorkflowMixedField {
  type: 'selection' | 'text' | 'dynamic-multi-select' | 'file-selector';
  label: string;
  description?: string;
  storeAs: string;
  items?: string[];
  defaultSelected?: string[];
  requireAtLeastOne?: boolean;
  placeHolder?: string;
  prompt?: string;
  value?: string;
  required?: boolean;
  multiline?: boolean;
  /** When false, the field is rendered as read-only/disabled. Default true. */
  enabled?: boolean;
  /** For file-selector fields: allow multiple files. */
  multifile?: boolean;
}

export interface WorkflowMixedInputStepOptions {
  name: string;
  description: string;
  title: string;
  fields: WorkflowMixedField[];
}

export interface WorkflowSelectionStepOptions {
  name: string;
  description: string;
  title: string;
  placeHolder?: string;
  options?: string[];
  optionsFromVariable?: string;
  storeAs: string;
}

export interface WorkflowMultiSelectionStepOptions {
  name: string;
  description: string;
  title: string;
  placeHolder?: string;
  options?: string[];
  optionsFromVariable?: string;
  storeAs: string;
  requireAtLeastOne?: boolean;
  defaultAll?: boolean;
  defaultSelected?: string[];
  disabledItems?: string[];
  disabledItemsFromVariable?: string;
}

export type WorkflowComboQueryProvider = (filter: string, context: WorkflowExecutionContext) => Promise<string[]>;

export interface WorkflowDynamicComboSelectionStepOptions {
  name: string;
  description: string;
  title: string;
  placeHolder?: string;
  queryProvider: WorkflowComboQueryProvider;
  storeAs: string;
}

export interface WorkflowDynamicMultiSelectionStepOptions {
  name: string;
  description: string;
  title: string;
  placeHolder?: string;
  queryProvider: WorkflowComboQueryProvider;
  storeAs: string;
  requireAtLeastOne?: boolean;
  defaultAll?: boolean;
  defaultSelected?: string[];
}

export interface WorkflowFileSelectorStepOptions {
  name: string;
  description: string;
  title: string;
  prompt?: string;
  multifile?: boolean;
  default?: string[];
  storeAs: string;
  required?: boolean;
}

export interface WorkflowInputProvider {
  initialize?(plan: WorkflowExecutionPlan): Promise<void> | void;
  onStepStarted?(plan: WorkflowExecutionPlan, stepIndex: number): Promise<void> | void;
  onStepProgress?(plan: WorkflowExecutionPlan, stepIndex: number): Promise<void> | void;
  onStepFinished?(plan: WorkflowExecutionPlan, stepIndex: number): Promise<void> | void;
  complete?(plan: WorkflowExecutionPlan): Promise<void> | void;
  useMarkdownSnapshots?(): boolean;
  confirm(options: WorkflowConfirmStepOptions, context: WorkflowExecutionContext): Promise<boolean | null>;
  textEntry(options: WorkflowTextEntryStepOptions, context: WorkflowExecutionContext): Promise<string | null>;
  multiTextEntry(options: WorkflowMultiTextEntryStepOptions, context: WorkflowExecutionContext): Promise<Record<string, string> | null>;
  mixedInput(options: WorkflowMixedInputStepOptions, context: WorkflowExecutionContext): Promise<Record<string, unknown> | null>;
  selection(options: WorkflowSelectionStepOptions, items: string[], context: WorkflowExecutionContext): Promise<string | null>;
  multiSelection(options: WorkflowMultiSelectionStepOptions, items: string[], context: WorkflowExecutionContext): Promise<string[] | null>;
  dynamicComboSelection(options: WorkflowDynamicComboSelectionStepOptions, context: WorkflowExecutionContext): Promise<string | null>;
  dynamicMultiSelection(options: WorkflowDynamicMultiSelectionStepOptions, context: WorkflowExecutionContext): Promise<string[] | null>;
  fileSelector(options: WorkflowFileSelectorStepOptions, context: WorkflowExecutionContext): Promise<string[] | null>;
}

class VsCodeWorkflowInputProvider implements WorkflowInputProvider {
  async confirm(options: WorkflowConfirmStepOptions, context: WorkflowExecutionContext): Promise<boolean | null> {
    const confirmLabel = options.confirmLabel ?? 'Continue';
    const cancelLabel = options.cancelLabel ?? 'Cancel';
    const selection = await vscode.window.showInformationMessage(
      context.resolveTemplate(options.message),
      { modal: true },
      confirmLabel,
      cancelLabel
    );

    if (!selection) {
      return null;
    }

    return selection === confirmLabel;
  }

  async textEntry(options: WorkflowTextEntryStepOptions, context: WorkflowExecutionContext): Promise<string | null> {
    const defaultValueFromVariable = options.valueFromVariable
      ? context.getVariable(options.valueFromVariable)
      : undefined;
    const initialValue = typeof defaultValueFromVariable === 'string'
      ? defaultValueFromVariable
      : (options.value ?? '');

    // If the field is disabled, return the default value immediately without prompting
    if (options.enabled === false) {
      return initialValue;
    }

    const value = await vscode.window.showInputBox({
      title: context.resolveTemplate(options.title),
      placeHolder: options.placeHolder ? context.resolveTemplate(options.placeHolder) : undefined,
      prompt: options.prompt ? context.resolveTemplate(options.prompt) : undefined,
      value: context.resolveTemplate(initialValue)
    });

    return typeof value === 'string' ? value : null;
  }

  async multiTextEntry(options: WorkflowMultiTextEntryStepOptions, context: WorkflowExecutionContext): Promise<Record<string, string> | null> {
    const values: Record<string, string> = {};

    for (let index = 0; index < options.fields.length; index += 1) {
      const field = options.fields[index];
      const defaultValueFromVariable = field.valueFromVariable
        ? context.getVariable(field.valueFromVariable)
        : undefined;
      const initialValue = typeof defaultValueFromVariable === 'string'
        ? defaultValueFromVariable
        : (field.value ?? '');

      // Skip disabled fields — auto-store their default/empty values
      if (field.enabled === false) {
        values[field.storeAs] = initialValue;
        continue;
      }

      const value = await vscode.window.showInputBox({
        title: `${context.resolveTemplate(options.title)} (${index + 1}/${options.fields.length})`,
        placeHolder: field.placeHolder ? context.resolveTemplate(field.placeHolder) : undefined,
        prompt: field.prompt ? context.resolveTemplate(field.prompt) : context.resolveTemplate(field.label),
        value: context.resolveTemplate(initialValue)
      });

      if (typeof value !== 'string') {
        return null;
      }

      values[field.storeAs] = value;
    }

    return values;
  }

  async mixedInput(options: WorkflowMixedInputStepOptions, context: WorkflowExecutionContext): Promise<Record<string, unknown> | null> {
    const values: Record<string, string> = {};

    for (const field of options.fields) {
      // Skip disabled fields — auto-store their default values
      if (field.enabled === false) {
        values[field.storeAs] = field.value ?? '';
        continue;
      }

      if (field.type === 'selection') {
        const selected = await vscode.window.showQuickPick(field.items ?? [], {
          title: `${context.resolveTemplate(options.title)} — ${field.label}`,
          placeHolder: field.placeHolder ? context.resolveTemplate(field.placeHolder) : undefined
        });
        if (selected === undefined) {
          return null;
        }
        values[field.storeAs] = selected;
      } else {
        const value = await vscode.window.showInputBox({
          title: `${context.resolveTemplate(options.title)} — ${field.label}`,
          placeHolder: field.placeHolder ? context.resolveTemplate(field.placeHolder) : undefined,
          prompt: field.prompt ? context.resolveTemplate(field.prompt) : undefined,
          value: field.value ?? ''
        });
        if (value === undefined) {
          return null;
        }
        values[field.storeAs] = value;
      }
    }

    return values;
  }

  async selection(options: WorkflowSelectionStepOptions, items: string[], context: WorkflowExecutionContext): Promise<string | null> {
    const selected = await vscode.window.showQuickPick(items, {
      title: context.resolveTemplate(options.title),
      placeHolder: options.placeHolder ? context.resolveTemplate(options.placeHolder) : undefined
    });

    return selected ?? null;
  }

  async multiSelection(options: WorkflowMultiSelectionStepOptions, items: string[], context: WorkflowExecutionContext): Promise<string[] | null> {
    const disabledItems = resolveDisabledItems(context, options);
    const disabledSet = new Set(disabledItems);
    const quickPickItems: vscode.QuickPickItem[] = items.map(item => ({
      label: item,
      description: disabledSet.has(item) ? '(already built)' : undefined,
      picked: options.defaultAll && !disabledSet.has(item)
        ? true
        : (options.defaultSelected ? options.defaultSelected.includes(item) : false),
    }));
    const selected = await vscode.window.showQuickPick(quickPickItems, {
      title: context.resolveTemplate(options.title),
      placeHolder: options.placeHolder ? context.resolveTemplate(options.placeHolder) : undefined,
      canPickMany: true
    });

    return selected?.map(item => item.label) ?? null;
  }

  async dynamicComboSelection(options: WorkflowDynamicComboSelectionStepOptions, context: WorkflowExecutionContext): Promise<string | null> {
    const initialItems = await options.queryProvider('', context);
    const selected = await vscode.window.showQuickPick(initialItems, {
      title: context.resolveTemplate(options.title),
      placeHolder: options.placeHolder ? context.resolveTemplate(options.placeHolder) : undefined
    });
    return selected ?? null;
  }

  async dynamicMultiSelection(options: WorkflowDynamicMultiSelectionStepOptions, context: WorkflowExecutionContext): Promise<string[] | null> {
    const initialItems = await options.queryProvider('', context);
    const quickPickItems: vscode.QuickPickItem[] = initialItems.map(item => ({
      label: item,
      picked: options.defaultAll
        ? true
        : (options.defaultSelected ? options.defaultSelected.includes(item) : false),
    }));
    const selected = await vscode.window.showQuickPick(quickPickItems, {
      title: context.resolveTemplate(options.title),
      placeHolder: options.placeHolder ? context.resolveTemplate(options.placeHolder) : undefined,
      canPickMany: true
    });
    return selected?.map(item => item.label) ?? null;
  }

  async fileSelector(options: WorkflowFileSelectorStepOptions, context: WorkflowExecutionContext): Promise<string[] | null> {
    // Show a quick pick with "Select Files" and "Select Open Tabs" options
    const action = await vscode.window.showQuickPick(
      [
        { label: '$(file) Select Files', description: 'Pick files from the file system', id: 'select-files' },
        { label: '$(files) Select Open Tabs', description: 'Pick files from open editors', id: 'select-tabs' },
      ],
      {
        title: context.resolveTemplate(options.title),
        placeHolder: context.resolveTemplate(options.prompt ?? 'Add files...')
      }
    );
    if (!action) return null;

    if (action.id === 'select-files') {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: options.multifile ?? true,
        title: context.resolveTemplate(options.title)
      });
      if (!uris || uris.length === 0) return null;
      const paths = uris.map(uri => vscode.workspace.asRelativePath(uri).replace(/\\/g, '/'));
      return paths;
    }

    if (action.id === 'select-tabs') {
      const tabGroups = vscode.window.tabGroups.all;
      const openFiles: { label: string; description: string; uri: vscode.Uri }[] = [];
      for (const group of tabGroups) {
        for (const tab of group.tabs) {
          const uri = (tab.input as { uri?: vscode.Uri })?.uri;
          if (uri && uri.scheme === 'file') {
            const relativePath = vscode.workspace.asRelativePath(uri).replace(/\\/g, '/');
            openFiles.push({
              label: path.basename(uri.fsPath),
              description: relativePath,
              uri
            });
          }
        }
      }
      if (openFiles.length === 0) {
        vscode.window.showInformationMessage('No open tabs with file paths found.');
        return null;
      }
      const picked = await vscode.window.showQuickPick(openFiles, {
        canPickMany: options.multifile ?? true,
        title: context.resolveTemplate(options.title),
        placeHolder: 'Select open tabs...'
      });
      const selected = Array.isArray(picked) ? picked : (picked ? [picked] : []);
      if (selected.length === 0) return null;
      return selected.map(item => item.description);
    }

    return null;
  }
}

export class WebviewWorkflowInputProvider implements WorkflowInputProvider {
  private panel: vscode.WebviewPanel | null = null;
  private plan: WorkflowExecutionPlan | null = null;
  private activeStepIndex = -1;
  private inputPayload: unknown = null;
  private pendingResolve: ((value: unknown) => void) | null = null;
  private currentQueryProvider: WorkflowComboQueryProvider | null = null;
  private currentQueryContext: WorkflowExecutionContext | null = null;
  private disposed = false;

  public initialize(plan: WorkflowExecutionPlan): void {
    this.plan = plan;
    this.ensurePanel();
    if (this.panel) {
      this.panel.title = plan.name;
    }
    this.render();
  }

  public reveal(): void {
    this.ensurePanel();
    this.panel?.reveal(vscode.ViewColumn.Active);
  }

  public onStepStarted(plan: WorkflowExecutionPlan, stepIndex: number): void {
    this.plan = plan;
    this.activeStepIndex = stepIndex;
    this.inputPayload = null;
    if (this.panel) {
      this.panel.title = plan.name;
    }
    this.render();
  }

  public onStepProgress(plan: WorkflowExecutionPlan, stepIndex: number): void {
    this.plan = plan;
    this.activeStepIndex = stepIndex;
    if (this.panel) {
      this.panel.title = plan.name;
    }
    this.render();
  }

  public onStepFinished(plan: WorkflowExecutionPlan, stepIndex: number): void {
    this.plan = plan;
    this.activeStepIndex = -1;
    this.inputPayload = null;
    if (this.panel) {
      this.panel.title = plan.name;
    }
    this.render();
  }

  public complete(plan: WorkflowExecutionPlan): void {
    this.plan = plan;
    this.activeStepIndex = -1;
    this.inputPayload = null;
    if (this.panel) {
      this.panel.title = plan.name;
    }
    this.render();
  }

  public useMarkdownSnapshots(): boolean {
    return false;
  }

  async confirm(options: WorkflowConfirmStepOptions, context: WorkflowExecutionContext): Promise<boolean | null> {
    const response = await this.prompt({
      type: 'confirm',
      title: options.name,
      description: options.description,
      message: context.resolveTemplate(options.message),
      confirmLabel: options.confirmLabel ?? 'Continue',
      cancelLabel: options.cancelLabel ?? 'Cancel'
    }) as { cancelled?: boolean; confirmed?: boolean } | undefined;

    if (!response || response.cancelled) {
      return null;
    }

    return !!response.confirmed;
  }

  async textEntry(options: WorkflowTextEntryStepOptions, context: WorkflowExecutionContext): Promise<string | null> {
    const defaultValueFromVariable = options.valueFromVariable
      ? context.getVariable(options.valueFromVariable)
      : undefined;
    const initialValue = typeof defaultValueFromVariable === 'string'
      ? defaultValueFromVariable
      : (options.value ?? '');

    const response = await this.prompt({
      type: 'text',
      title: context.resolveTemplate(options.title),
      description: options.description,
      placeHolder: options.placeHolder ? context.resolveTemplate(options.placeHolder) : '',
      prompt: options.prompt ? context.resolveTemplate(options.prompt) : '',
      prefix: options.prefix ?? '',
      multiline: options.multiline === true,
      value: context.resolveTemplate(initialValue),
      required: !!options.required
    }) as { cancelled?: boolean; value?: string } | undefined;

    if (!response || response.cancelled) {
      return null;
    }

    return typeof response.value === 'string' ? response.value : '';
  }

  async multiTextEntry(options: WorkflowMultiTextEntryStepOptions, context: WorkflowExecutionContext): Promise<Record<string, string> | null> {
    const fields = options.fields.map(field => {
      const defaultValueFromVariable = field.valueFromVariable
        ? context.getVariable(field.valueFromVariable)
        : undefined;
      const initialValue = typeof defaultValueFromVariable === 'string'
        ? defaultValueFromVariable
        : (field.value ?? '');

      return {
        label: context.resolveTemplate(field.label),
        placeHolder: field.placeHolder ? context.resolveTemplate(field.placeHolder) : '',
        prompt: field.prompt ? context.resolveTemplate(field.prompt) : '',
        value: context.resolveTemplate(initialValue),
        storeAs: field.storeAs,
        required: !!field.required,
        enabled: field.enabled !== false // default true
      };
    });

    const response = await this.prompt({
      type: 'multi-text',
      title: context.resolveTemplate(options.title),
      description: options.description,
      fields
    }) as { cancelled?: boolean; values?: Record<string, string> } | undefined;

    if (!response || response.cancelled) {
      return null;
    }

    return typeof response.values === 'object' && response.values !== null
      ? response.values
      : {};
  }

  async mixedInput(options: WorkflowMixedInputStepOptions, context: WorkflowExecutionContext): Promise<Record<string, unknown> | null> {
    const fields = options.fields.map(field => {
      const base = {
        type: field.type,
        label: context.resolveTemplate(field.label),
        placeHolder: field.placeHolder ? context.resolveTemplate(field.placeHolder) : '',
        prompt: field.prompt ? context.resolveTemplate(field.prompt) : '',
        value: context.resolveTemplate(field.value ?? ''),
        storeAs: field.storeAs,
        required: !!field.required,
        multiline: !!field.multiline,
        description: field.description ? context.resolveTemplate(field.description) : '',
        enabled: field.enabled !== false // default true
      };
      if (field.type === 'selection') {
        return { ...base, items: field.items ?? [] };
      }
      if (field.type === 'dynamic-multi-select') {
        return {
          ...base,
          items: field.items ?? [],
          defaultSelected: field.defaultSelected ?? [],
          requireAtLeastOne: !!field.requireAtLeastOne
        };
      }
      return base;
    });

    const response = await this.prompt({
      type: 'mixed',
      title: context.resolveTemplate(options.title),
      description: options.description,
      fields
    }) as { cancelled?: boolean; values?: Record<string, string> } | undefined;

    if (!response || response.cancelled) {
      return null;
    }

    return typeof response.values === 'object' && response.values !== null
      ? response.values
      : {};
  }

  async selection(options: WorkflowSelectionStepOptions, items: string[], context: WorkflowExecutionContext): Promise<string | null> {
    const response = await this.prompt({
      type: 'single-select',
      title: context.resolveTemplate(options.title),
      description: options.description,
      placeHolder: options.placeHolder ? context.resolveTemplate(options.placeHolder) : '',
      items
    }) as { cancelled?: boolean; value?: string } | undefined;

    if (!response || response.cancelled) {
      return null;
    }

    return typeof response.value === 'string' ? response.value : null;
  }

  async multiSelection(options: WorkflowMultiSelectionStepOptions, items: string[], context: WorkflowExecutionContext): Promise<string[] | null> {
    const response = await this.prompt({
      type: 'multi-select',
      title: context.resolveTemplate(options.title),
      description: options.description,
      placeHolder: options.placeHolder ? context.resolveTemplate(options.placeHolder) : '',
      items,
      requireAtLeastOne: !!options.requireAtLeastOne,
      defaultAll: !!options.defaultAll,
      defaultSelected: options.defaultSelected ?? null,
      disabledItems: resolveDisabledItems(context, options),
    }) as { cancelled?: boolean; values?: string[] } | undefined;

    if (!response || response.cancelled) {
      return null;
    }

    return Array.isArray(response.values) ? response.values : [];
  }

  async dynamicComboSelection(options: WorkflowDynamicComboSelectionStepOptions, context: WorkflowExecutionContext): Promise<string | null> {
    this.currentQueryProvider = options.queryProvider;
    this.currentQueryContext = context;

    const initialResults = await options.queryProvider('', context);

    const response = await this.prompt({
      type: 'dynamic-combo',
      title: context.resolveTemplate(options.title),
      description: options.description,
      placeHolder: options.placeHolder ? context.resolveTemplate(options.placeHolder) : '',
      initialResults
    }) as { cancelled?: boolean; value?: string } | undefined;

    this.currentQueryProvider = null;
    this.currentQueryContext = null;

    if (!response || response.cancelled) {
      return null;
    }

    return typeof response.value === 'string' ? response.value : null;
  }

  async dynamicMultiSelection(options: WorkflowDynamicMultiSelectionStepOptions, context: WorkflowExecutionContext): Promise<string[] | null> {
    this.currentQueryProvider = options.queryProvider;
    this.currentQueryContext = context;

    const initialResults = await options.queryProvider('', context);

    const response = await this.prompt({
      type: 'dynamic-multi-select',
      title: context.resolveTemplate(options.title),
      description: options.description,
      placeHolder: options.placeHolder ? context.resolveTemplate(options.placeHolder) : '',
      initialResults,
      requireAtLeastOne: !!options.requireAtLeastOne,
      defaultAll: !!options.defaultAll,
      defaultSelected: options.defaultSelected ?? null,
    }) as { cancelled?: boolean; values?: string[] } | undefined;

    this.currentQueryProvider = null;
    this.currentQueryContext = null;

    if (!response || response.cancelled) {
      return null;
    }

    return Array.isArray(response.values) ? response.values : [];
  }

  async fileSelector(options: WorkflowFileSelectorStepOptions, context: WorkflowExecutionContext): Promise<string[] | null> {
    const defaultPaths = (options.default ?? []).map(p => context.resolveTemplate(p));

    // Compute file sizes for default paths
    const fileSizeMap: Record<string, number> = {};
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    for (const fp of defaultPaths) {
      try {
        const absPath = path.isAbsolute(fp) ? vscode.Uri.file(fp).fsPath : (root ? vscode.Uri.joinPath(root, fp.replace(/\\/g, '/')).fsPath : '');
        if (absPath && fs.existsSync(absPath)) {
          fileSizeMap[fp] = fs.statSync(absPath).size;
        }
      } catch { /* skip */ }
    }

    const response = await this.prompt({
      type: 'file-selector',
      title: context.resolveTemplate(options.title),
      description: options.description,
      prompt: context.resolveTemplate(options.prompt ?? 'Select files'),
      multifile: options.multifile ?? true,
      default: defaultPaths,
      fileSizeMap,
      storeAs: options.storeAs,
      required: !!options.required
    }) as { cancelled?: boolean; files?: string[] } | undefined;

    if (!response || response.cancelled) {
      return null;
    }

    return Array.isArray(response.files) ? response.files : [];
  }

  private async prompt(payload: unknown): Promise<unknown> {
    if (this.disposed) {
      return { cancelled: true };
    }

    this.ensurePanel();
    if (!this.panel) {
      return { cancelled: true };
    }

    this.inputPayload = payload;
    this.render();
    this.panel.reveal(vscode.ViewColumn.Active);

    if (this.pendingResolve) {
      this.pendingResolve({ cancelled: true });
      this.pendingResolve = null;
    }

    return new Promise(resolve => {
      this.pendingResolve = resolve;
    });
  }

  private ensurePanel(): void {
    if (this.panel) {
      return;
    }

    if (this.disposed) {
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'workflowExecution',
      this.plan?.name ?? 'Workflow Execution',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.onDidDispose(() => {
      this.panel = null;
      this.disposed = true;
      if (this.pendingResolve) {
        this.pendingResolve({ cancelled: true });
        this.pendingResolve = null;
      }
    });

    this.panel.webview.onDidReceiveMessage(message => {
      if ((message?.type === 'query' || message?.type === 'dynamic-multi-query') && this.currentQueryProvider && this.currentQueryContext) {
        const filter = String(message.filter ?? '');
        void this.currentQueryProvider(filter, this.currentQueryContext).then(results => {
          if (this.panel) {
            this.panel.webview.postMessage({ type: 'query-results', results });
          }
        });
        return;
      }

      if (message?.type === 'submit' && this.pendingResolve) {
        const resolve = this.pendingResolve;
        this.pendingResolve = null;
        this.inputPayload = null;
        this.render();
        resolve(message.payload ?? {});
      }

      if (message?.type === 'cancel' && this.pendingResolve) {
        const resolve = this.pendingResolve;
        this.pendingResolve = null;
        this.inputPayload = null;
        this.render();
        resolve({ cancelled: true });
      }

      if (message?.type === 'open-file') {
        const filePath = String(message.path ?? '');
        if (filePath) {
          void vscode.workspace.openTextDocument(vscode.Uri.file(filePath))
            .then(doc => vscode.window.showTextDocument(doc));
        }
      }

      if (message?.type === 'display-yaml') {
        this.displayYaml();
      }

      if (message?.type === 'save-yaml') {
        this.saveYamlToVault();
      }

      // ─── Show raw prompt (what would be sent to the API) ──
      if (message?.type === 'show-raw-prompt' && this.plan) {
        const plan = this.plan;
        const objective = String(plan.getVariable('objective') || '');
        const files: string[] = Array.isArray(plan.getVariable('selectedFiles'))
          ? plan.getVariable('selectedFiles') as string[]
          : [];
        const model = String(plan.getVariable('selectedModel') || '');
        const tags: string[] = Array.isArray(plan.getVariable('selectedTags'))
          ? plan.getVariable('selectedTags') as string[]
          : [];

        const lines: string[] = [];
        lines.push('=== Objective ===');
        lines.push(objective || '(not set)');
        lines.push('');
        if (model) { lines.push(`Model: ${model}`); }
        if (tags.length > 0) { lines.push(`Tags: @${tags.join(', @')}`); }
        lines.push('');
        if (files.length > 0) {
          lines.push('=== Context Files ===');
          for (const f of files) {
            lines.push(`  - ${f}`);
          }
          lines.push('');
        }

        // If response text is available, show it too
        const responseText = String(plan.getVariable('responseText') || '');
        if (responseText) {
          lines.push('=== Response ===');
          lines.push(responseText);
        }

        const uri = vscode.Uri.parse('untitled:raw-prompt.md');
        void vscode.workspace.openTextDocument(uri).then(doc => {
          const edit = new vscode.WorkspaceEdit();
          edit.insert(uri, new vscode.Position(0, 0), lines.join('\n'));
          void vscode.workspace.applyEdit(edit).then(() => {
            void vscode.window.showTextDocument(doc);
          });
        });
      }

      // ─── Open step details markdown in editor ─────────────
      if (message?.type === 'open-step-details') {
        const content = String(message.content ?? '');
        if (content) {
          const uri = vscode.Uri.parse('untitled:step-details.md');
          void vscode.workspace.openTextDocument(uri).then(doc => {
            const edit = new vscode.WorkspaceEdit();
            edit.insert(uri, new vscode.Position(0, 0), content);
            void vscode.workspace.applyEdit(edit).then(() => {
              void vscode.window.showTextDocument(doc);
            });
          });
        }
      }

      // ─── Open raw fenced-block content in editor ──────────
      if (message?.type === 'open-raw-content') {
        const content = String(message.content ?? '');
        const lang = String(message.language ?? 'txt');
        if (content) {
          const ext = lang === 'yaml' ? 'yaml' : (lang === 'markdown' || lang === 'md' ? 'md' : 'txt');
          const uri = vscode.Uri.parse(`untitled:response-raw.${ext}`);
          void vscode.workspace.openTextDocument(uri).then(doc => {
            const edit = new vscode.WorkspaceEdit();
            edit.insert(uri, new vscode.Position(0, 0), content);
            void vscode.workspace.applyEdit(edit).then(() => {
              void vscode.window.showTextDocument(doc);
            });
          });
        }
      }

      // ─── Compute sizes for files in the selector ──────────
      if (message?.type === 'compute-sizes') {
        const filesToSize: string[] = Array.isArray(message.files) ? message.files : [];
        const sizeMap: Record<string, number> = {};
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        for (const fp of filesToSize) {
          if (sizeMap[fp] !== undefined) continue;
          try {
            const absPath = path.isAbsolute(fp) ? vscode.Uri.file(fp).fsPath : (root ? vscode.Uri.joinPath(root, fp.replace(/\\/g, '/')).fsPath : '');
            if (absPath && fs.existsSync(absPath)) {
              sizeMap[fp] = fs.statSync(absPath).size;
            }
          } catch { /* skip */ }
        }
        if (this.panel) {
          this.panel.webview.postMessage({ type: 'sizes-result', sizeMap });
        }
        return;
      }

      // ─── File-selector actions ─────────────────────────────
      if (message?.type === 'file-selector-action') {
        const action = String(message.action ?? '');
        const multifile = message.multifile !== false;

        if (action === 'select-files') {
          void vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: multifile,
            title: message.dialogTitle ?? 'Select Files'
          }).then(uris => {
            if (!uris || uris.length === 0) return;
            const paths = uris.map(uri => vscode.workspace.asRelativePath(uri).replace(/\\/g, '/'));
            if (this.panel) {
              this.panel.webview.postMessage({ type: 'file-selector-result', files: paths });
            }
          });
          return;
        }

        if (action === 'select-tabs') {
          const tabGroups = vscode.window.tabGroups.all;
          const openFiles: { label: string; description: string; uri: vscode.Uri }[] = [];
          for (const group of tabGroups) {
            for (const tab of group.tabs) {
              const uri = (tab.input as { uri?: vscode.Uri })?.uri;
              if (uri && uri.scheme === 'file') {
                const relativePath = vscode.workspace.asRelativePath(uri).replace(/\\/g, '/');
                openFiles.push({
                  label: path.basename(uri.fsPath),
                  description: relativePath,
                  uri
                });
              }
            }
          }

          if (openFiles.length === 0) {
            void vscode.window.showInformationMessage('No open tabs with file paths found.');
            return;
          }

          const tabPicks = openFiles.map(f => ({
            label: f.label,
            description: f.description
          }));
          const canPickMany = multifile;
          void (canPickMany
            ? vscode.window.showQuickPick(tabPicks, { canPickMany: true, title: 'Select Open Tabs' })
            : vscode.window.showQuickPick(tabPicks, { canPickMany: false, title: 'Select Open Tabs' })
          ).then((selected: any) => {
            if (!selected) return;
            const items = Array.isArray(selected) ? selected : [selected];
            const paths = items.map((item: { description?: string; label: string }) => item.description ?? item.label);
            if (this.panel) {
              this.panel.webview.postMessage({ type: 'file-selector-result', files: paths });
            }
          });
          return;
        }
      }
    });
  }

  private displayYaml(): void {
    const exported = this.exportYamlForWorkflow();
    if (!exported) {
      return;
    }

    try {
      const uri = vscode.Uri.parse(`untitled:${exported.suggestedFileName}.yaml`);
      void vscode.workspace.openTextDocument(uri).then(doc => {
        const edit = new vscode.WorkspaceEdit();
        edit.insert(uri, new vscode.Position(0, 0), exported.yamlContent);
        void vscode.workspace.applyEdit(edit).then(() => {
          void vscode.window.showTextDocument(doc);
        });
      });
    } catch (err) {
      void vscode.window.showErrorMessage('Failed to export YAML: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  private saveYamlToVault(): void {
    if (!this.plan) {
      return;
    }

    const definition = this.plan.toDefinition();
    const definitionForSave = this.buildDefinitionForSave(definition, this.plan.getVariables());
    const yamlContent = definitionToYaml(definitionForSave);
    const suggestedFileName = `Workflow-${this.plan.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

    void vscode.commands.executeCommand('deepseek.saveWorkflowToVault', yamlContent, suggestedFileName)
      .then(
        () => undefined,
        () => {
          // Fallback for consumers that do not register DeepSeek-specific save command.
          this.displayYaml();
        }
      );
  }

  private buildDefinitionForSave(
    definition: WorkflowExecutionPlanDefinition,
    variables: WorkflowVariableMap
  ): WorkflowExecutionPlanDefinition {
    const normalizeDefaultValue = (value: WorkflowVariableValue): string | string[] | undefined => {
      if (Array.isArray(value)) {
        return value.map(item => String(item));
      }
      if (typeof value === 'string') {
        return value;
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
      }
      return undefined;
    };

    const steps = definition.steps.map(step => {
      const nextStep: WorkflowExecutionStepDefinition = {
        ...step,
      };
      delete nextStep.status;
      delete nextStep.output;

      if (Array.isArray(step.inputs)) {
        nextStep.inputs = step.inputs.map(input => {
          const nextInput: WorkflowStepInputField = {
            ...input,
          };
          const key = typeof input.storeValueTo === 'string' ? input.storeValueTo.trim() : '';
          if (!key || !Object.prototype.hasOwnProperty.call(variables, key)) {
            return nextInput;
          }
          const defaultValue = normalizeDefaultValue(variables[key]);
          if (defaultValue !== undefined) {
            nextInput.default = defaultValue;
          }
          return nextInput;
        });
      }

      return nextStep;
    });

    return {
      ...definition,
      variables: undefined,
      steps,
    };
  }

  private exportYamlForWorkflow(): { yamlContent: string; suggestedFileName: string } | null {
    if (!this.plan) {
      return null;
    }

    const definition = this.plan.toDefinition();
    const yamlContent = definitionToYaml(definition);
    const suggestedFileName = `Workflow-${this.plan.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    return { yamlContent, suggestedFileName };
  }

  private render(): void {
    if (!this.panel) {
      return;
    }

    this.panel.webview.html = this.getHtml();
  }

  private getHtml(): string {
    const steps = this.plan ? this.plan.getSteps() : [];
    const variables = this.plan ? this.plan.getVariables() : {};
    const visibleSteps = steps
      .map((step, index) => ({ step, index }))
      .filter(item => item.step.isVisible(variables));

    const stepData = visibleSteps.map(item => {
      const step = item.step;
      return {
        name: step.name,
        description: step.description,
        details: step.details ?? '',
        status: step.status,
        failureDescription: step.failureDescription,
        output: step.output,
        execution: typeof step.execution === 'string' ? step.execution : '',
        plannedCommands: step.plannedCommands,
        inputs: (step.inputs ?? []).map(input => ({
          type: input.type,
          prompt: input.prompt ?? input.storeValueTo,
          storeValueTo: input.storeValueTo,
          default: input.default
        }))
      };
    });

    const planName = this.plan?.name ?? 'Workflow Execution';

    // Map original plan index to visible steps index, since steps in the HTML
    // template iterate over visible steps only.
    const visibleActiveIndex = this.activeStepIndex >= 0
      ? visibleSteps.findIndex(item => item.index === this.activeStepIndex)
      : -1;

    const data = JSON.stringify({
      planName,
      activeStepIndex: visibleActiveIndex,
      steps: stepData,
      variables,
      inputPayload: this.inputPayload ?? {}
    }).replace(/</g, '\\u003c');

    let template = getTemplateHtml();
    template = template.replace('__DATA__', data);
    return template;
  }
}

export class WorkflowExecutionContext {
  private activeStepIndex = -1;

  constructor(public readonly plan: WorkflowExecutionPlan,
              private readonly inputProvider: WorkflowInputProvider) {}

  public setActiveStepIndex(stepIndex: number): void {
    this.activeStepIndex = stepIndex;
  }

  public async reportProgress(lines: string | string[]): Promise<void> {
    if (this.activeStepIndex < 0) {
      return;
    }

    const step = this.plan.getSteps()[this.activeStepIndex];
    if (!step) {
      return;
    }

    const payload = Array.isArray(lines) ? lines : [lines];
    const normalized = payload
      .map(line => String(line).trimEnd())
      .filter(line => line !== '');

    if (normalized.length === 0) {
      return;
    }

    step.output.push(...normalized);
    await this.inputProvider.onStepProgress?.(this.plan, this.activeStepIndex);
  }

  public getVariable(name: string): WorkflowVariableValue {
    return this.plan.getVariable(name);
  }

  public setVariable(name: string, value: WorkflowVariableValue): void {
    this.plan.setVariable(name, value);
  }

  public resolveTemplate(input: string): string {
    return this.plan.resolveTemplate(input);
  }

  public resolveTemplates(inputs: string[]): string[] {
    return inputs.map(value => this.resolveTemplate(value));
  }

  public getInputProvider(): WorkflowInputProvider {
    return this.inputProvider;
  }
}

export type WorkflowStepExecutor = (context: WorkflowExecutionContext) => Promise<WorkflowStepExecutionResult>;
export type WorkflowStepExecution = WorkflowStepExecutor | string;
export type WorkflowStepVisibilityCondition = (variables: WorkflowVariableMap) => boolean;

export class WorkflowExecutionStep {
  constructor(public readonly name: string,
              public readonly description: string,
              public readonly execution: WorkflowStepExecution,
              public readonly failurePatterns: WorkflowFailurePattern[] = [],
              public readonly visibilityCondition?: WorkflowStepVisibilityCondition,
              public readonly abortWorkflowOnFailure: boolean = true,
              public readonly skipIf?: string,
              public readonly storeResultTo?: string,
              public readonly skipUnless?: string,
              public readonly stepType: 'input' | 'shell' | 'rest' | 'extension-api' = 'shell',
              public readonly endpoint?: string,
              public readonly method?: string,
              public readonly headers?: Record<string, string>,
              public readonly credentials?: WorkflowRestCredentials,
              public readonly requestBody?: string,
              public readonly extensionCommand?: string,
              public readonly extensionArgs?: WorkflowVariableValue[],
              public readonly inputs?: WorkflowStepInputField[],
              public readonly action?: string,
              public readonly actionParameters?: WorkflowActionParameter[]) {}

  public status: WorkflowStepStatus = 'not-executed';
  public failureDescription = '';
  public output: string[] = [];
  public plannedCommands: string[] = [];
  public fencedBlocks: FencedBlock[] = [];
  /** Long-form details shown as tooltip and in step export */
  public details: string = '';

  public getFencedBlocks(): FencedBlock[] {
    return this.fencedBlocks;
  }

  public getFencedBlockCount(): number {
    return this.fencedBlocks.length;
  }

  public getFencedBlocksByLanguage(language: string): FencedBlock[] {
    return this.fencedBlocks.filter(b => b.language === language);
  }

  public hasFencedBlocks(language?: string): boolean {
    if (language) {
      return this.fencedBlocks.some(b => b.language === language);
    }
    return this.fencedBlocks.length > 0;
  }

  public matchFailureDescription(output: string[]): string | null {
    const text = output.join('\n');
    for (const pattern of this.failurePatterns) {
      if (pattern.pattern.test(text)) {
        return pattern.description;
      }
    }
    return null;
  }

  public isVisible(variables: WorkflowVariableMap): boolean {
    if (!this.visibilityCondition) {
      return true;
    }

    return this.visibilityCondition(variables);
  }

  public static createConfirmStep(options: WorkflowConfirmStepOptions): WorkflowExecutionStep {
    return new WorkflowExecutionStep(
      options.name,
      options.description,
      async context => {
        const confirmed = await context.getInputProvider().confirm(options, context);
        if (options.storeResultAs) {
          context.setVariable(options.storeResultAs, confirmed === true);
        }

        if (confirmed !== true) {
          return {
            success: false,
            output: ['User cancelled at confirmation step.'],
            failureDescription: 'Cancelled by user.'
          };
        }

        return {
          success: true,
          output: ['User confirmed step.']
        };
      }
    );
  }

  public static createTextEntryStep(options: WorkflowTextEntryStepOptions): WorkflowExecutionStep {
    return new WorkflowExecutionStep(
      options.name,
      options.description,
      async context => {
        const value = await context.getInputProvider().textEntry(options, context);

        if (value === null) {
          return {
            success: false,
            output: ['User cancelled text entry.'],
            failureDescription: 'Cancelled by user.'
          };
        }

        if (options.required && value.trim() === '') {
          return {
            success: false,
            output: ['Text value is required but empty.'],
            failureDescription: 'Required input is empty.'
          };
        }

        context.setVariable(options.storeAs, value);
        return {
          success: true,
          output: [`Stored value in variable: ${options.storeAs}`]
        };
      }
    );
  }

  public static createMultiTextEntryStep(options: WorkflowMultiTextEntryStepOptions): WorkflowExecutionStep {
    return new WorkflowExecutionStep(
      options.name,
      options.description,
      async context => {
        const values = await context.getInputProvider().multiTextEntry(options, context);

        if (values === null) {
          return {
            success: false,
            output: ['User cancelled multi text entry.'],
            failureDescription: 'Cancelled by user.'
          };
        }

        for (const field of options.fields) {
          const value = String(values[field.storeAs] ?? '');
          if (field.required && value.trim() === '') {
            return {
              success: false,
              output: [`Field '${field.label}' is required but empty.`],
              failureDescription: 'Required input is empty.'
            };
          }
          context.setVariable(field.storeAs, value);
        }

        return {
          success: true,
          output: [`Stored values for ${options.fields.length} fields.`]
        };
      }
    );
  }

  public static createSelectionStep(options: WorkflowSelectionStepOptions): WorkflowExecutionStep {
    return new WorkflowExecutionStep(
      options.name,
      options.description,
      async context => {
        const items = resolveSelectionItems(context, options.options, options.optionsFromVariable);
        if (items.length === 0) {
          return {
            success: false,
            output: ['Selection list is empty.'],
            failureDescription: 'No options available for selection.'
          };
        }

        const selected = await context.getInputProvider().selection(options, items, context);

        if (!selected) {
          return {
            success: false,
            output: ['User cancelled single selection.'],
            failureDescription: 'Cancelled by user.'
          };
        }

        context.setVariable(options.storeAs, selected);
        return {
          success: true,
          output: [`Selected: ${selected}`]
        };
      }
    );
  }

  public static createMultiSelectionStep(options: WorkflowMultiSelectionStepOptions): WorkflowExecutionStep {
    return new WorkflowExecutionStep(
      options.name,
      options.description,
      async context => {
        const items = resolveSelectionItems(context, options.options, options.optionsFromVariable);
        if (items.length === 0) {
          return {
            success: false,
            output: ['Selection list is empty.'],
            failureDescription: 'No options available for selection.'
          };
        }

        const selected = await context.getInputProvider().multiSelection(options, items, context);

        if (!selected) {
          return {
            success: false,
            output: ['User cancelled multi-selection.'],
            failureDescription: 'Cancelled by user.'
          };
        }

        if (options.requireAtLeastOne && selected.length === 0) {
          return {
            success: false,
            output: ['No items selected.'],
            failureDescription: 'At least one item must be selected.'
          };
        }

        context.setVariable(options.storeAs, selected);
        return {
          success: true,
          output: [`Stored multi-selection in variable: ${options.storeAs}`]
        };
      }
    );
  }

  public static createDynamicComboSelectionStep(options: WorkflowDynamicComboSelectionStepOptions): WorkflowExecutionStep {
    return new WorkflowExecutionStep(
      options.name,
      options.description,
      async context => {
        const selected = await context.getInputProvider().dynamicComboSelection(options, context);

        if (!selected) {
          return {
            success: false,
            output: ['User cancelled dynamic combo selection.'],
            failureDescription: 'Cancelled by user.'
          };
        }

        context.setVariable(options.storeAs, selected);
        return {
          success: true,
          output: [`Selected: ${selected}`]
        };
      }
    );
  }

  public static createDynamicMultiSelectionStep(options: WorkflowDynamicMultiSelectionStepOptions): WorkflowExecutionStep {
    return new WorkflowExecutionStep(
      options.name,
      options.description,
      async context => {
        const selected = await context.getInputProvider().dynamicMultiSelection(options, context);

        if (!selected) {
          return {
            success: false,
            output: ['User cancelled dynamic multi-selection.'],
            failureDescription: 'Cancelled by user.'
          };
        }

        if (options.requireAtLeastOne && selected.length === 0) {
          return {
            success: false,
            output: ['No items selected.'],
            failureDescription: 'At least one item must be selected.'
          };
        }

        context.setVariable(options.storeAs, selected);
        return {
          success: true,
          output: [`Stored multi-selection in variable: ${options.storeAs}`]
        };
      }
    );
  }

  public static createFileSelectorStep(options: WorkflowFileSelectorStepOptions): WorkflowExecutionStep {
    return new WorkflowExecutionStep(
      options.name,
      options.description,
      async context => {
        const files = await context.getInputProvider().fileSelector(options, context);

        if (files === null) {
          return {
            success: false,
            output: ['User cancelled file selection.'],
            failureDescription: 'Cancelled by user.'
          };
        }

        if (options.required && files.length === 0) {
          return {
            success: false,
            output: ['At least one file must be selected.'],
            failureDescription: 'Required file selection is empty.'
          };
        }

        context.setVariable(options.storeAs, files);
        return {
          success: true,
          output: [`Stored ${files.length} file(s) in variable: ${options.storeAs}`]
        };
      }
    );
  }
}

export class WorkflowExecutionPlan {
  private readonly actionMap = new Map<string, WorkflowActionCallback>();
  private readonly queryProviderMap = new Map<string, WorkflowComboQueryProvider>();

  constructor(public readonly name: string,
              private readonly steps: WorkflowExecutionStep[] = [],
              public summary = '',
              public details = '',
              private readonly variables: WorkflowVariableMap = {}) {}

  public registerAction(actionName: string, callback: WorkflowActionCallback): void {
    this.actionMap.set(actionName, callback);
  }

  public getActionCallback(actionName: string): WorkflowActionCallback | undefined {
    return this.actionMap.get(actionName);
  }

  public registerQueryProvider(name: string, provider: WorkflowComboQueryProvider): void {
    this.queryProviderMap.set(name, provider);
  }

  public getQueryProvider(name: string): WorkflowComboQueryProvider | undefined {
    return this.queryProviderMap.get(name);
  }

  public static fromDefinition(definition: WorkflowExecutionPlanDefinition): WorkflowExecutionPlan {
    const plan = new WorkflowExecutionPlan(
      definition.name,
      [],
      definition.summary ?? '',
      definition.details ?? '',
      { ...(definition.variables ?? {}) }
    );

    for (const stepDefinition of definition.steps ?? []) {
      // Auto-detect type: if 'inputs' is present and non-empty, default to 'input'
      const hasInputs = Array.isArray(stepDefinition.inputs) && stepDefinition.inputs.length > 0;
      const stepType = stepDefinition.type ?? (hasInputs ? 'input' : 'shell');
      const execution = stepDefinition.execution ?? stepDefinition.command;

      // Resolve action — can be a string or an object { name, parameters }
      let actionName = '';
      let actionParameters: WorkflowActionParameter[] | undefined;
      if (typeof stepDefinition.action === 'string') {
        actionName = stepDefinition.action;
      } else if (stepDefinition.action && typeof stepDefinition.action === 'object') {
        actionName = stepDefinition.action.name ?? '';
        actionParameters = stepDefinition.action.parameters;
      }

      if (stepType === 'shell' || stepType === 'input') {
        const hasAction = typeof actionName === 'string' && actionName.trim() !== '';
        if (!hasInputs && !hasAction && (typeof execution !== 'string' || execution.trim() === '')) {
          throw new Error(`Workflow step "${stepDefinition.name}" is missing required 'execution' or 'command' field with a non-empty string value.`);
        }
      } else if (stepType === 'rest') {
        if (!stepDefinition.endpoint || typeof stepDefinition.endpoint !== 'string') {
          throw new Error(`Workflow step "${stepDefinition.name}" of type 'rest' is missing required 'endpoint' field.`);
        }
      } else if (stepType === 'extension-api') {
        if (!stepDefinition.extensionCommand || typeof stepDefinition.extensionCommand !== 'string') {
          throw new Error(`Workflow step "${stepDefinition.name}" of type 'extension-api' is missing required 'extensionCommand' field.`);
        }
      }

      const step = new WorkflowExecutionStep(
        stepDefinition.name,
        stepDefinition.description,
        execution ?? '',
        (stepDefinition.failurePatterns ?? [])
          .filter(pattern => typeof pattern?.pattern === 'string' && typeof pattern?.description === 'string')
          .map(pattern => ({
            pattern: new RegExp(pattern.pattern, pattern.flags ?? ''),
            description: pattern.description
          })),
        undefined,
        stepDefinition.abortWorkflowOnFailure ?? true,
        stepDefinition.skipIf,
        stepDefinition.storeResultTo,
        stepDefinition.skipUnless,
        stepType,
        stepDefinition.endpoint,
        stepDefinition.method,
        stepDefinition.headers,
        stepDefinition.credentials,
        stepDefinition.requestBody,
        stepDefinition.extensionCommand,
        Array.isArray(stepDefinition.extensionArgs) ? stepDefinition.extensionArgs : undefined,
        stepDefinition.inputs,
        actionName,
        actionParameters
      );

      if (stepDefinition.status) {
        step.status = stepDefinition.status;
      }
      if (typeof stepDefinition.failureDescription === 'string') {
        step.failureDescription = stepDefinition.failureDescription;
      }
      if (Array.isArray(stepDefinition.output)) {
        step.output = stepDefinition.output
          .filter(line => typeof line === 'string' || typeof line === 'number' || typeof line === 'boolean')
          .map(line => String(line));
      }
      if (Array.isArray(stepDefinition.plannedCommands)) {
        step.plannedCommands = stepDefinition.plannedCommands
          .filter(line => typeof line === 'string' || typeof line === 'number' || typeof line === 'boolean')
          .map(line => String(line));
      }

      plan.addStep(step);
    }

    return plan;
  }

  public addStep(step: WorkflowExecutionStep): void {
    this.steps.push(step);
  }

  public getSteps(): WorkflowExecutionStep[] {
    return this.steps;
  }

  public getVariables(): WorkflowVariableMap {
    return { ...this.variables };
  }

  public setVariable(name: string, value: WorkflowVariableValue): void {
    this.variables[name] = value;
  }

  public getVariable(name: string): WorkflowVariableValue {
    return this.variables[name];
  }

  public resolveTemplate(input: string): string {
    if (!input) {
      return input;
    }

    return input.replace(/\$\{([a-zA-Z0-9_.-]+)\}/g, (_full, variableName: string) => {
      const value = this.variables[variableName];
      if (Array.isArray(value)) {
        return value.join(', ');
      }
      if (value === null || typeof value === 'undefined') {
        return '';
      }
      return String(value);
    });
  }

  public toMarkdownLines(): string[] {
    const rows: string[] = [];

    rows.push(`# Workflow Execution Plan: ${this.name}`);
    rows.push('');

    if (this.summary.trim() !== '') {
      rows.push(`**Summary:** ${escapeTableCell(this.summary)}`);
      rows.push('');
    }

    if (this.details.trim() !== '') {
      rows.push('<details>');
      rows.push('<summary><strong>Details</strong></summary>');
      rows.push('');
      rows.push(escapeTableCell(this.details));
      rows.push('');
      rows.push('</details>');
      rows.push('');
    }

    rows.push('| Status | Step | Description | Failure |');
    rows.push('|---|---|---|---|');

    const allSteps = this.getSteps();
    for (let i = 0; i < allSteps.length; i += 1) {
      const step = allSteps[i];
      rows.push(`| ${getStatusIcon(step.status)} | ${escapeTableCell(step.name)} | ${escapeTableCell(step.description)} | ${escapeTableCell(step.failureDescription)} |`);
    }

    rows.push('');

    return rows;
  }

  public toDefinition(): WorkflowExecutionPlanDefinition {
    return {
      name: this.name,
      summary: this.summary,
      details: this.details,
      variables: this.getVariables(),
      steps: this.steps.map(step => {
        const base: WorkflowExecutionStepDefinition = {
          name: step.name,
          description: step.description,
          type: step.stepType,
          failurePatterns: step.failurePatterns.map(pattern => ({
            pattern: pattern.pattern.source,
            flags: pattern.pattern.flags,
            description: pattern.description
          })),
          abortWorkflowOnFailure: step.abortWorkflowOnFailure,
          skipIf: step.skipIf,
          storeResultTo: step.storeResultTo,
          skipUnless: step.skipUnless,
          status: step.status,
          failureDescription: step.failureDescription,
          output: [...step.output],
          plannedCommands: [...step.plannedCommands],
          inputs: step.inputs ? step.inputs.map(inp => ({ ...inp })) : undefined,
          action: step.action
            ? (step.actionParameters && step.actionParameters.length > 0
              ? { name: step.action, parameters: step.actionParameters }
              : step.action)
            : undefined
        };

        if (step.stepType === 'input') {
          // Input-only step — no execution or command needed
        } else if (step.stepType === 'shell' && step.action) {
          // Action-based step — no execution needed
        } else if (step.stepType === 'shell' && typeof step.execution === 'string') {
          base.execution = step.execution;
        } else if (step.stepType === 'shell' && step.inputs && step.inputs.length > 0) {
          // Input-only step — no execution needed
        } else if (step.stepType === 'shell' && typeof step.execution === 'function') {
          base.execution = '(custom executor function)';
        } else if (step.stepType === 'rest') {
          base.endpoint = step.endpoint;
          base.method = step.method;
          base.headers = step.headers;
          base.credentials = step.credentials;
          base.requestBody = step.requestBody;
        } else if (step.stepType === 'extension-api') {
          base.extensionCommand = step.extensionCommand;
          base.extensionArgs = step.extensionArgs;
        }

        return base;
      })
    };
  }
}

export async function executeFlow(
  plan: WorkflowExecutionPlan,
  inputProvider: WorkflowInputProvider = new VsCodeWorkflowInputProvider()
): Promise<WorkflowExecutionPlan> {
  let continueExecution = true;
  const context = new WorkflowExecutionContext(plan, inputProvider);

  // Pre-populate step output for file-selector inputs that already have variable values,
  // so preselected files are visible in the webview from the very first render.
  // Skip steps that have a registered action — the action handler produces its own output.
  for (const step of plan.getSteps()) {
    if (step.action && plan.getActionCallback(step.action)) continue;
    if (step.inputs && step.inputs.length > 0) {
      for (const inp of step.inputs) {
        if (inp.type === 'file-selector') {
          const existingVar = plan.getVariable(inp.storeValueTo);
          if (Array.isArray(existingVar) && existingVar.length > 0) {
            const seen = new Set<string>();
            for (const f of existingVar) {
              const normalized = String(f).replace(/\\/g, '/');
              if (!seen.has(normalized)) { seen.add(normalized); step.output.push(`- ${normalized}`); }
            }
          }
        }
      }
    }
  }

  await inputProvider.initialize?.(plan);
  const useMarkdownSnapshots = inputProvider.useMarkdownSnapshots ? inputProvider.useMarkdownSnapshots() : true;

  for (let i = 0; i < plan.getSteps().length; i += 1) {
    const step = plan.getSteps()[i];

    if (!step.isVisible(plan.getVariables())) {
      step.status = 'not-executed';
      step.failureDescription = '';
      step.output = [];
      continue;
    }

    if (step.skipIf && !!plan.getVariable(step.skipIf)) {
      step.status = 'skipped';
      step.failureDescription = '';
      step.output = [];
      continue;
    }

    if (step.skipUnless && !plan.getVariable(step.skipUnless)) {
      step.status = 'skipped';
      step.failureDescription = '';
      step.output = [];
      continue;
    }

    step.status = 'running';
    step.output = [];

    // Pre-populate step output for file-selector inputs that already have variable values,
    // so preselected files are visible in the webview even before the step becomes active.
    if (step.inputs && step.inputs.length > 0) {
      for (const inp of step.inputs) {
        if (inp.type === 'file-selector') {
          const existingVar = plan.getVariable(inp.storeValueTo);
          if (Array.isArray(existingVar) && existingVar.length > 0) {
            const seen = new Set<string>();
            for (const f of existingVar) {
              const normalized = String(f).replace(/\\/g, '/');
              if (!seen.has(normalized)) { seen.add(normalized); step.output.push(`- ${normalized}`); }
            }
          }
        }
      }
    }

    context.setActiveStepIndex(i);
    await inputProvider.onStepStarted?.(plan, i);
    if (!continueExecution) {
      step.status = 'not-executed';
      await inputProvider.onStepFinished?.(plan, i);
      if (useMarkdownSnapshots) {
        await publishExecutionProgress(plan, i + 1);
      }
      continue;
    }

    // Auto-collect declarative inputs before step execution
    if (step.inputs && step.inputs.length > 0) {
      const collected = await collectStepInputs(step, context);
      if (collected === null) {
        step.status = 'failed';
        step.failureDescription = 'User cancelled input collection.';
        await inputProvider.onStepFinished?.(plan, i);
        if (useMarkdownSnapshots) {
          await publishExecutionProgress(plan, i + 1);
        }
        continue;
      }

      // Auto-generate output lines for collected inputs — one bullet per field.
      // Skip if the step has a registered action that handles its own display.
      const hasRegisteredAction = step.action ? !!plan.getActionCallback(step.action) : false;
      if (hasRegisteredAction) {
        // Clear any pre-populated output (e.g. file-selector file paths);
        // the action handler will produce its own complete output.
        step.output = [];
      } else {
        const inputSummary: string[] = [];
        for (const inp of step.inputs) {
          const value = collected[inp.storeValueTo];
          if (value === undefined || value === null || value === '') continue;
          const label = inp.prompt || inp.storeValueTo;
          inputSummary.push(`- **${label}**: ${value}`);
        }
        if (inputSummary.length > 0) {
          step.output.push(...inputSummary);
        }
      }
    }

    try {
      const result = await executeStep(step, context);
      const output = result.output ?? [];
      // Avoid duplicating lines already streamed via reportProgress.
      let overlap = 0;
      const maxOverlap = Math.min(step.output.length, output.length);
      for (let size = maxOverlap; size > 0; size -= 1) {
        const suffix = step.output.slice(-size);
        const prefix = output.slice(0, size);
        if (suffix.every((line, index) => line === prefix[index])) {
          overlap = size;
          break;
        }
      }
      if (overlap < output.length) {
        step.output.push(...output.slice(overlap));
      }

      if (result.success) {
        step.status = 'successful';
        step.failureDescription = '';
      } else {
        step.status = 'failed';
        step.failureDescription = result.failureDescription
          ?? step.matchFailureDescription(output)
          ?? 'Step failed.';
        if (step.abortWorkflowOnFailure) {
          continueExecution = false;
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const output = [message];
      step.output.push(...output);
      step.status = 'failed';
      step.failureDescription = step.matchFailureDescription(output) ?? message;
      if (step.abortWorkflowOnFailure) {
        continueExecution = false;
      }
    }

    // Populate fenced blocks from step output
    step.fencedBlocks = parseFencedBlocksFromOutput(step.output);

    if (step.storeResultTo) {
      plan.setVariable(step.storeResultTo, step.status === 'successful');
    }

    await inputProvider.onStepFinished?.(plan, i);
    if (useMarkdownSnapshots) {
      await publishExecutionProgress(plan, i + 1);
    }
  }

  await inputProvider.complete?.(plan);

  return plan;
}

export function writeExecutionPlanMarkdown(plan: WorkflowExecutionPlan): string {
  const reportsRoot = `${getRootFolder()}/reports`;
  fs.mkdirSync(reportsRoot, { recursive: true });

  const timestamp = Math.floor(Date.now() / 1000);
  const safeName = plan.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const filePath = `${reportsRoot}/workflow-plan-${safeName || 'plan'}-${timestamp}.md`;

  fs.writeFileSync(filePath, plan.toMarkdownLines().join('\n'), 'utf8');
  return filePath;
}

function writeExecutionPlanMarkdownSnapshot(plan: WorkflowExecutionPlan, stepIndex: number): string {
  const reportsRoot = `${getRootFolder()}/reports`;
  fs.mkdirSync(reportsRoot, { recursive: true });

  const timestamp = Math.floor(Date.now() / 1000);
  const safeName = plan.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const filePath = `${reportsRoot}/workflow-plan-${safeName || 'plan'}-step-${stepIndex}-${timestamp}.md`;

  fs.writeFileSync(filePath, plan.toMarkdownLines().join('\n'), 'utf8');
  return filePath;
}

function getStatusIcon(status: WorkflowStepStatus): string {
  if (status === 'successful') {
    return '🟢';
  }
  if (status === 'failed') {
    return '🔴';
  }
  if (status === 'running') {
    return '🔵';
  }
  if (status === 'skipped') {
    return '⚫';
  }
  return '⚪';
}

function escapeTableCell(input: string): string {
  return (input ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br/>');
}

async function executeStep(step: WorkflowExecutionStep, context: WorkflowExecutionContext): Promise<WorkflowStepExecutionResult> {
  // Check for registered action callback first
  if (step.action) {
    const callback = context.plan.getActionCallback(step.action);
    if (callback) {
      return callback(context, context.plan, step.actionParameters);
    }
  }

  if (step.stepType === 'extension-api') {
    const command = step.extensionCommand!;
    const args = (step.extensionArgs ?? []).map(a => typeof a === 'string' ? context.resolveTemplate(a) : a);
    try {
      await vscode.commands.executeCommand(command, ...args);
      return {
        success: true,
        output: [`Extension command executed: ${command}`]
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: [`Extension command failed: ${command}`, message],
        failureDescription: `Extension command failed: ${message}`
      };
    }
  }

  if (step.stepType === 'rest') {
    const endpoint = context.resolveTemplate(step.endpoint ?? '');
    if (!endpoint) {
      return {
        success: false,
        output: ['REST step has no endpoint configured.'],
        failureDescription: 'REST step missing endpoint.'
      };
    }

    const method = (step.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = { ...(step.headers ?? {}) };
    let body: string | undefined;

    // Apply credentials
    if (step.credentials) {
      if (step.credentials.type === 'bearer' && step.credentials.token) {
        headers['Authorization'] = `Bearer ${step.credentials.token}`;
      } else if (step.credentials.type === 'basic' && step.credentials.username && step.credentials.password) {
        const encoded = Buffer.from(`${step.credentials.username}:${step.credentials.password}`).toString('base64');
        headers['Authorization'] = `Basic ${encoded}`;
      } else if (step.credentials.type === 'apikey' && step.credentials.token) {
        const headerName = step.credentials.headerName ?? 'X-API-Key';
        headers[headerName] = step.credentials.token;
      }
    }

    // Resolve and set content-type for requests with body
    if (step.requestBody) {
      body = context.resolveTemplate(step.requestBody);
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const output: string[] = [];
    output.push(`${method} ${endpoint}`);

    try {
      const url = new URL(endpoint);
      const isHttps = url.protocol === 'https:';
      const transport = isHttps ? https : http;

      const result = await new Promise<{ success: boolean; data: string; statusCode?: number }>((resolve, reject) => {
        const options: http.RequestOptions = {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method,
          headers,
          timeout: 30000
        };

        const req = transport.request(options, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const responseBody = Buffer.concat(chunks).toString('utf-8');
            const statusCode = res.statusCode ?? 0;
            const success = statusCode >= 200 && statusCode < 300;
            resolve({ success, data: responseBody, statusCode });
          });
        });

        req.on('error', (err) => {
          reject(err);
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timed out after 30 seconds'));
        });

        if (body) {
          req.write(body);
        }
        req.end();
      });

      output.push(`Status: ${result.statusCode}`);
      if (result.data) {
        // Try to pretty-print JSON responses
        try {
          const parsed = JSON.parse(result.data);
          output.push(JSON.stringify(parsed, null, 2));
        } catch {
          output.push(result.data);
        }
      }

      if (result.success) {
        return { success: true, output };
      }

      return {
        success: false,
        output,
        failureDescription: `REST call failed with status ${result.statusCode}: ${endpoint}`
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      output.push(`Error: ${message}`);
      return {
        success: false,
        output,
        failureDescription: `REST call error: ${message}`
      };
    }
  }

  if (step.stepType === 'shell' && typeof step.execution === 'string' && step.execution.trim() !== '') {
    const resolvedExecution = context.resolveTemplate(step.execution as string);
    const result = await executeWorkflowCommand(resolvedExecution);
    const outputWithCommand = [`$ ${resolvedExecution}`, ...result.output];
    if (result.success) {
      return {
        success: true,
        output: outputWithCommand
      };
    }

    return {
      success: false,
      output: outputWithCommand,
      failureDescription: `Command failed: ${resolvedExecution}`
    };
  }

  if (typeof step.execution === 'function') {
    return step.execution(context);
  }

  // Step has no execution (just inputs) — skip as successful
  return { success: true, output: [] };
}

function resolveSelectionItems(
  context: WorkflowExecutionContext,
  directOptions?: string[],
  optionsFromVariable?: string
): string[] {
  if (directOptions && directOptions.length > 0) {
    return context.resolveTemplates(directOptions);
  }

  if (!optionsFromVariable) {
    return [];
  }

  const value = context.getVariable(optionsFromVariable);
  if (Array.isArray(value)) {
    return context.resolveTemplates(value.map(item => String(item)));
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return [context.resolveTemplate(value)];
  }

  return [];
}

function resolveDisabledItems(
  context: WorkflowExecutionContext,
  options: WorkflowMultiSelectionStepOptions
): string[] {
  if (options.disabledItems && options.disabledItems.length > 0) {
    return options.disabledItems.slice();
  }
  if (!options.disabledItemsFromVariable) {
    return [];
  }
  const value = context.getVariable(options.disabledItemsFromVariable);
  return Array.isArray(value) ? value.map(item => String(item)) : [];
}

async function publishExecutionProgress(plan: WorkflowExecutionPlan, stepIndex: number): Promise<void> {
  const markdownPath = writeExecutionPlanMarkdownSnapshot(plan, stepIndex);
  const uri = vscode.Uri.file(markdownPath);
  await vscode.commands.executeCommand('markdown.showPreview', uri);
}

function parseFencedBlocksFromOutput(output: string[]): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  let current: { language: string; contentLines: string[] } | null = null;

  for (const line of output) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (current === null) {
        // Opening fence
        const tag = trimmed.slice(3).trim();
        current = { language: tag || 'code', contentLines: [] };
      } else {
        // Closing fence
        blocks.push({
          language: current.language,
          content: current.contentLines.join('\n'),
          lines: [...current.contentLines]
        });
        current = null;
      }
    } else if (current !== null) {
      current.contentLines.push(line);
    }
  }

  // If fenced block never closed, still save what we captured
  if (current !== null && current.contentLines.length > 0) {
    blocks.push({
      language: current.language,
      content: current.contentLines.join('\n'),
      lines: [...current.contentLines]
    });
  }

  return blocks;
}

async function executeWorkflowCommand(command: string): Promise<{ success: boolean; output: string[] }> {
  const output = await executeCommand(command);
  if (output === false) {
    return {
      success: false,
      output: ['Command failed in terminal shell integration.']
    };
  }

  return {
    success: true,
    output
  };
}

// ─── Collect step inputs at runtime ───────────────────────────────────

async function collectStepInputs(step: WorkflowExecutionStep, context: WorkflowExecutionContext): Promise<Record<string, string> | null> {
  const provider = context.getInputProvider();
  const inputs = step.inputs ?? [];
  const result: Record<string, string> = {};

  // Separate enabled and disabled inputs — disabled fields auto-store their defaults
  const enabledInputs = inputs.filter(inp => inp.enabled !== false);
  const disabledInputs = inputs.filter(inp => inp.enabled === false);

  // Auto-store disabled field defaults (prefer existing plan variables over input.default)
  for (const input of disabledInputs) {
    const existingVar = context.getVariable(input.storeValueTo);
    const val = existingVar !== undefined && existingVar !== null && existingVar !== ''
      ? (Array.isArray(existingVar) ? existingVar.join(', ') : String(existingVar))
      : (Array.isArray(input.default) ? input.default.join(', ') : (input.default ?? ''));
    context.setVariable(input.storeValueTo, val);
    result[input.storeValueTo] = val;
  }

  // If there are multiple enabled fields with UI-compatible types, batch them into a single mixedInput call.
  const canBatchTypes = new Set(['selection', 'text', 'dynamic-multi-select', 'file-selector']);
  const shouldBatch = enabledInputs.length > 1 && enabledInputs.every(inp => canBatchTypes.has(inp.type));
  if (shouldBatch) {
    const mixedFieldDefs: WorkflowMixedField[] = [];
    for (const inp of enabledInputs) {
      if (inp.type === 'selection') {
        const existingVar = context.getVariable(inp.storeValueTo);
        mixedFieldDefs.push({
          type: 'selection',
          label: inp.prompt ?? inp.storeValueTo,
          description: '',
          storeAs: inp.storeValueTo,
          items: inp.items ?? [],
          placeHolder: inp.placeholder ?? '',
          value: typeof existingVar === 'string' ? existingVar : (typeof inp.default === 'string' ? inp.default : ''),
          required: inp.required ?? false,
          multiline: false
        });
        continue;
      }

      if (inp.type === 'dynamic-multi-select') {
        let items: string[] = [];
        if (inp.items && inp.items.length > 0) {
          items = inp.items.slice();
        } else if (inp.itemsFromVariable) {
          const varValue = context.getVariable(inp.itemsFromVariable);
          if (Array.isArray(varValue)) {
            items = varValue.map(item => String(item));
          } else if (typeof varValue === 'string') {
            items = [varValue];
          }
        } else if (inp.queryProviderName) {
          const qp = context.plan.getQueryProvider(inp.queryProviderName);
          if (qp) {
            try {
              items = await qp('', context);
            } catch {
              items = [];
            }
          }
        }

        const existingVar = context.getVariable(inp.storeValueTo);
        const defaultSelected = Array.isArray(existingVar)
          ? existingVar.map(item => String(item))
          : (Array.isArray(inp.default)
            ? inp.default.map(item => String(item))
            : (typeof inp.default === 'string' && inp.default.trim() ? [inp.default] : []));

        mixedFieldDefs.push({
          type: 'dynamic-multi-select',
          label: inp.prompt ?? inp.storeValueTo,
          description: '',
          storeAs: inp.storeValueTo,
          items,
          defaultSelected,
          requireAtLeastOne: inp.required ?? false,
          placeHolder: inp.placeholder ?? '',
          required: inp.required ?? false,
          multiline: false
        });
        continue;
      }

      if (inp.type === 'file-selector') {
        const existingVar = context.getVariable(inp.storeValueTo);
        const defaultFiles = Array.isArray(existingVar)
          ? existingVar.map(item => String(item))
          : (Array.isArray(inp.default) ? inp.default.map(item => String(item)) : []);
        mixedFieldDefs.push({
          type: 'file-selector',
          label: inp.prompt ?? inp.storeValueTo,
          description: '',
          storeAs: inp.storeValueTo,
          placeHolder: inp.placeholder ?? '',
          value: defaultFiles.join(', '),
          multifile: inp.multifile ?? true,
          required: inp.required ?? false,
          multiline: false
        });
        continue;
      }

      const existingVar = context.getVariable(inp.storeValueTo);
      const textLabel = inp.prompt ?? inp.storeValueTo;
      mixedFieldDefs.push({
        type: 'text',
        label: textLabel,
        description: '',
        storeAs: inp.storeValueTo,
        placeHolder: inp.placeholder ?? '',
        prompt: '', // prompt rendered below label would duplicate label text
        value: typeof existingVar === 'string' ? existingVar : (typeof inp.default === 'string' ? inp.default : ''),
        required: inp.required ?? false,
        multiline: inp.multiline ?? false
      });
    }

    const response = await provider.mixedInput({
      name: step.name,
      description: '',
      title: '',
      fields: mixedFieldDefs
    }, context);
    if (response === null) return null;

    for (const input of enabledInputs) {
      const rawValue = response[input.storeValueTo];
      if (input.type === 'dynamic-multi-select') {
        const selected = Array.isArray(rawValue)
          ? rawValue.map(v => String(v))
          : (typeof rawValue === 'string' && rawValue.trim()
            ? rawValue.split(',').map(v => v.trim()).filter(Boolean)
            : []);
        context.setVariable(input.storeValueTo, selected);
        result[input.storeValueTo] = selected.join(', ');
      } else if (input.type === 'file-selector') {
        const files = Array.isArray(rawValue)
          ? rawValue.map(v => String(v))
          : (typeof rawValue === 'string' && rawValue.trim()
            ? rawValue.split(',').map(v => v.trim()).filter(Boolean)
            : []);
        context.setVariable(input.storeValueTo, files);
        result[input.storeValueTo] = files.join(', ');
      } else {
        const normalized = String(rawValue ?? '');
        context.setVariable(input.storeValueTo, normalized);
        result[input.storeValueTo] = normalized;
      }
    }

    return result;
  }

  for (const input of enabledInputs) {
    if (input.type === 'confirm') {
      const confirmed = await provider.confirm({
        name: step.name,
        description: step.description,
        message: input.message ?? 'Proceed?',
        confirmLabel: input.confirmLabel,
        cancelLabel: input.cancelLabel,
        storeResultAs: ''
      }, context);
      if (confirmed === null) return null;
      context.setVariable(input.storeValueTo, String(confirmed));
      result[input.storeValueTo] = String(confirmed);
      continue;
    }

    if (input.type === 'text') {
      const existingVar = context.getVariable(input.storeValueTo);
      const value = await provider.textEntry({
        name: step.name,
        description: step.description,
        title: input.prompt ?? '',
        placeHolder: input.placeholder,
        prompt: input.prompt,
        storeAs: input.storeValueTo,
        value: typeof existingVar === 'string' ? existingVar : (typeof input.default === 'string' ? input.default : undefined),
        required: input.required ?? false,
        multiline: input.multiline ?? false
      }, context);
      if (value === null) return null;
      context.setVariable(input.storeValueTo, value);
      result[input.storeValueTo] = value;
      continue;
    }

    if (input.type === 'selection') {
      const items = input.items ?? [];
      const selected = await provider.selection({
        name: step.name,
        description: step.description,
        title: input.prompt ?? '',
        placeHolder: input.placeholder,
        storeAs: input.storeValueTo
      }, items, context);
      if (selected === null) return null;
      context.setVariable(input.storeValueTo, selected);
      result[input.storeValueTo] = selected;
      continue;
    }

    if (input.type === 'multi-select') {
      const items = input.items ?? [];
      const selected = await provider.multiSelection({
        name: step.name,
        description: step.description,
        title: input.prompt ?? '',
        placeHolder: input.placeholder,
        storeAs: input.storeValueTo
      }, items, context);
      if (selected === null) return null;
      context.setVariable(input.storeValueTo, selected);
      result[input.storeValueTo] = selected.join(', ');
      continue;
    }

    if (input.type === 'dynamic-multi-select') {
      // Resolve items: inline items, itemsFromVariable, or queryProvider
      let items: string[] = [];
      if (input.items && input.items.length > 0) {
        items = input.items.slice();
      } else if (input.itemsFromVariable) {
        const varValue = context.getVariable(input.itemsFromVariable);
        if (Array.isArray(varValue)) {
          items = varValue.map(item => String(item));
        } else if (typeof varValue === 'string') {
          items = [varValue];
        }
      }

      // Determine query provider — registered name or inline
      let queryProvider: WorkflowComboQueryProvider | undefined;
      if (input.queryProviderName) {
        queryProvider = context.plan.getQueryProvider(input.queryProviderName);
      }

      const existingVar = context.getVariable(input.storeValueTo);
      const defaultValues = Array.isArray(existingVar)
        ? existingVar.map(item => String(item))
        : (Array.isArray(input.default) ? input.default.map(item => String(item)) : (input.default ? [String(input.default)] : []));

      if (queryProvider) {
        // Dynamic (server-queried) mode
        const selected = await provider.dynamicMultiSelection({
          name: step.name,
          description: step.description,
          title: input.prompt ?? '',
          placeHolder: input.placeholder,
          queryProvider,
          storeAs: input.storeValueTo,
          requireAtLeastOne: input.required ?? false,
          defaultAll: false,
          defaultSelected: defaultValues
        }, context);
        if (selected === null) return null;
        context.setVariable(input.storeValueTo, selected);
        result[input.storeValueTo] = selected.join(', ');
      } else {
        // Static (client-filtered) mode — use Webview multi-select with pre-filtering
        // We pass items as initialResults into a dynamic-multi-select
        const selected = await provider.dynamicMultiSelection({
          name: step.name,
          description: step.description,
          title: input.prompt ?? '',
          placeHolder: input.placeholder,
          queryProvider: async (_filter: string) => items,
          storeAs: input.storeValueTo,
          requireAtLeastOne: input.required ?? false,
          defaultAll: false,
          defaultSelected: defaultValues
        }, context);
        if (selected === null) return null;
        context.setVariable(input.storeValueTo, selected);
        result[input.storeValueTo] = selected.join(', ');
      }
      continue;
    }

    if (input.type === 'file-selector') {
      const existingVar = context.getVariable(input.storeValueTo);
      const defaultPaths = Array.isArray(existingVar)
        ? existingVar.map(item => String(item))
        : (Array.isArray(input.default) ? input.default : (input.default ? [input.default] : []));
      const files = await provider.fileSelector({
        name: step.name,
        description: step.description,
        title: input.prompt ?? '',
        prompt: input.prompt,
        multifile: input.multifile ?? true,
        default: defaultPaths,
        storeAs: input.storeValueTo,
        required: input.required ?? false
      }, context);
      if (files === null) return null;
      context.setVariable(input.storeValueTo, files);
      result[input.storeValueTo] = files.join(', ');
      continue;
    }
  }

  return result;
}

// ─── Minimal YAML serializer (no external deps) ──────────────────────

function yamlValue(val: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  if (val === null || val === undefined) {
    return 'null';
  }
  if (typeof val === 'boolean') {
    return val ? 'true' : 'false';
  }
  if (typeof val === 'number') {
    return String(val);
  }
  if (typeof val === 'string') {
    if (/^[a-zA-Z0-9_./@:\- ]+$/.test(val) && !/^[0-9]/.test(val) && !/^[*&!|>?'"`%]/.test(val)) {
      return val;
    }
    // Escape special characters
    const escaped = val
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `"${escaped}"`;
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    const items = val.map(v => `${pad}  - ${yamlValue(v, indent + 1)}`);
    return '\n' + items.join('\n');
  }
  if (typeof val === 'object') {
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return '\n' + entries.map(([k, v]) => {
      const vStr = yamlValue(v, indent + 1);
      if (vStr.startsWith('\n')) {
        return `${pad}  ${k}:${vStr}`;
      }
      return `${pad}  ${k}: ${vStr}`;
    }).join('\n');
  }
  return String(val);
}

function definitionToYaml(def: WorkflowExecutionPlanDefinition): string {
  const lines: string[] = [];
  lines.push(`name: ${yamlValue(def.name, 0)}`);
  if (def.summary) lines.push(`summary: ${yamlValue(def.summary, 0)}`);
  if (def.details) lines.push(`details: ${yamlValue(def.details, 0)}`);
  if (def.variables && Object.keys(def.variables).length > 0) {
    lines.push('variables:');
    for (const [k, v] of Object.entries(def.variables)) {
      lines.push(`  ${k}: ${yamlValue(v, 1)}`);
    }
  }
  lines.push('steps:');
  for (const step of def.steps) {
    lines.push(`  - name: ${yamlValue(step.name, 2)}`);
    lines.push(`    description: ${yamlValue(step.description, 2)}`);
    if (step.type && step.type !== 'shell') {
      lines.push(`    type: ${step.type}`);
    }
    if (step.action) {
      if (typeof step.action === 'object' && step.action.parameters && step.action.parameters.length > 0) {
        lines.push(`    action:`);
        lines.push(`      name: ${yamlValue(step.action.name, 2)}`);
        lines.push(`      parameters:`);
        for (const param of step.action.parameters) {
          lines.push(`        - description: ${yamlValue(param.description, 4)}`);
          lines.push(`          variable: ${yamlValue(param.variable, 4)}`);
        }
      } else {
        const actionVal = typeof step.action === 'string' ? step.action : step.action.name;
        lines.push(`    action: ${yamlValue(actionVal, 2)}`);
      }
    }
    if (step.inputs && step.inputs.length > 0) {
      lines.push('    inputs:');
      for (const inp of step.inputs) {
        lines.push(`      - type: ${inp.type}`);
        lines.push(`        storeValueTo: ${inp.storeValueTo}`);
        if (inp.enabled !== undefined) lines.push(`        enabled: ${inp.enabled}`);
        if (inp.default !== undefined) lines.push(`        default: ${yamlValue(inp.default, 3)}`);
        if (inp.placeholder) lines.push(`        placeholder: ${yamlValue(inp.placeholder, 3)}`);
        if (inp.prompt) lines.push(`        prompt: ${yamlValue(inp.prompt, 3)}`);
        if (inp.required !== undefined) lines.push(`        required: ${inp.required}`);
        if (inp.items && inp.items.length > 0) lines.push(`        items: ${yamlValue(inp.items, 3)}`);
        if (inp.confirmLabel) lines.push(`        confirmLabel: ${yamlValue(inp.confirmLabel, 3)}`);
        if (inp.cancelLabel) lines.push(`        cancelLabel: ${yamlValue(inp.cancelLabel, 3)}`);
        if (inp.message) lines.push(`        message: ${yamlValue(inp.message, 3)}`);
        if (inp.type === 'dynamic-multi-select') {
          if (inp.itemsFromVariable) lines.push(`        itemsFromVariable: ${inp.itemsFromVariable}`);
          if (inp.queryProviderName) lines.push(`        queryProviderName: ${inp.queryProviderName}`);
        }
        if (inp.type === 'file-selector') {
          if (inp.multifile !== undefined) lines.push(`        multifile: ${inp.multifile}`);
        }
      }
    }
    // Only emit execution/command for steps that have them and are not input-only or action-only
    if (step.execution && !(step.inputs && step.inputs.length > 0) && !step.action) {
      lines.push(`    execution: ${yamlValue(step.execution, 2)}`);
    } else if (step.command) {
      lines.push(`    command: ${yamlValue(step.command, 2)}`);
    }
    if (step.endpoint) lines.push(`    endpoint: ${yamlValue(step.endpoint, 2)}`);
    if (step.method) lines.push(`    method: ${step.method}`);
    if (step.extensionCommand) lines.push(`    extensionCommand: ${yamlValue(step.extensionCommand, 2)}`);
    if (step.extensionArgs && step.extensionArgs.length > 0) {
      lines.push(`    extensionArgs: ${yamlValue(step.extensionArgs, 2)}`);
    }
    if (step.credentials) {
      lines.push(`    credentials:`);
      lines.push(`      type: ${step.credentials.type}`);
      if (step.credentials.token) lines.push(`      token: ${yamlValue(step.credentials.token, 3)}`);
      if (step.credentials.username) lines.push(`      username: ${yamlValue(step.credentials.username, 3)}`);
      if (step.credentials.password) lines.push(`      password: ${yamlValue(step.credentials.password, 3)}`);
      if (step.credentials.headerName) lines.push(`      headerName: ${yamlValue(step.credentials.headerName, 3)}`);
    }
    if (step.requestBody) lines.push(`    requestBody: ${yamlValue(step.requestBody, 2)}`);
    if (step.headers && Object.keys(step.headers).length > 0) {
      lines.push('    headers:');
      for (const [hk, hv] of Object.entries(step.headers)) {
        lines.push(`      ${hk}: ${yamlValue(hv, 3)}`);
      }
    }
    if (step.failurePatterns && step.failurePatterns.length > 0) {
      lines.push('    failurePatterns:');
      for (const fp of step.failurePatterns) {
        lines.push(`      - pattern: ${yamlValue(fp.pattern, 4)}`);
        if (fp.flags) lines.push(`        flags: ${fp.flags}`);
        lines.push(`        description: ${yamlValue(fp.description, 4)}`);
      }
    }
    if (step.abortWorkflowOnFailure !== undefined) {
      lines.push(`    abortWorkflowOnFailure: ${step.abortWorkflowOnFailure}`);
    }
    if (step.skipIf) lines.push(`    skipIf: ${step.skipIf}`);
    if (step.storeResultTo) lines.push(`    storeResultTo: ${step.storeResultTo}`);
    if (step.skipUnless) lines.push(`    skipUnless: ${step.skipUnless}`);
    if (step.status && step.status !== 'not-executed') lines.push(`    status: ${step.status}`);
    if (step.failureDescription) lines.push(`    failureDescription: ${yamlValue(step.failureDescription, 2)}`);
    if (step.output && step.output.length > 0) {
      lines.push(`    output: ${yamlValue(step.output, 2)}`);
    }
    if (step.plannedCommands && step.plannedCommands.length > 0) {
      lines.push(`    plannedCommands: ${yamlValue(step.plannedCommands, 2)}`);
    }
  }
  return lines.join('\n');
}
