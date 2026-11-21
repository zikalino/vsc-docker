import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';

/**
 * Minimal YAML definition loader with $include resolution.
 * Replaces the external @zim.kalinowski/vscode-helper-toolkit DefinitionLoader.
 */
export class DefinitionLoader {
  private yaml: any = null;
  private yamlErrors: string[] = [];

  constructor(
    private readonly rootFolder: string,
    private readonly location: string
  ) {
    this.yaml = this.loadYaml(path.posix.join(rootFolder, location));
  }

  /** Returns the parsed YAML object, or null on failure. */
  getYaml(): any {
    return this.yaml;
  }

  /** Returns validation errors (always empty in this minimal version). */
  getErrors(): string[] {
    return this.yamlErrors;
  }

  // ---- internal -----------------------------------------------------------

  private loadYaml(filePath: string): any {
    const resolvedPath = this.resolveWindowsPath(filePath);
    if (!fs.existsSync(resolvedPath)) {
      this.yamlErrors.push(`File not found: ${resolvedPath}`);
      return null;
    }

    let raw: string;
    try {
      raw = fs.readFileSync(resolvedPath, 'utf8');
    } catch (e: any) {
      this.yamlErrors.push(`Could not read file: ${resolvedPath} — ${e.message}`);
      return null;
    }

    let parsed: any;
    try {
      parsed = parseYaml(raw) as any;
    } catch (e: any) {
      this.yamlErrors.push(`Could not parse YAML: ${resolvedPath} — ${e.message}`);
      return null;
    }

    if (parsed && typeof parsed === 'object') {
      this.resolveIncludes(parsed, path.dirname(resolvedPath));
    }

    return parsed;
  }

  /** Resolve all $include directives in-place, merging included YAML content. */
  private resolveIncludes(obj: any, baseDir: string): void {
    if (!obj || typeof obj !== 'object') { return; }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        if (obj[i] && typeof obj[i] === 'object' && '$include' in obj[i]) {
          const includePath = obj[i].$include;
          const included = this.loadYaml(path.posix.join(baseDir, includePath));
          if (included !== null) {
            if (Array.isArray(included)) {
              // Splice the loaded array into the parent — handles YAML files
              // like ____tree_items.yaml that contain a list of items
              obj.splice(i, 1, ...included);
              i += included.length - 1;
            } else {
              obj[i] = included;
            }
          }
        } else {
          this.resolveIncludes(obj[i], baseDir);
        }
      }
    } else {
      // Check for top-level $include (merge included content into this object)
      if ('$include' in obj) {
        const includePath = obj.$include;
        delete obj.$include;
        const included = this.loadYaml(path.posix.join(baseDir, includePath));
        if (included && typeof included === 'object' && !Array.isArray(included)) {
          Object.assign(obj, included);
        }
      }
      // Recurse into all properties
      for (const key of Object.keys(obj)) {
        this.resolveIncludes(obj[key], baseDir);
      }
    }
  }

  private resolveWindowsPath(filePath: string): string {
    return filePath.replace(/\//g, path.sep);
  }
}
