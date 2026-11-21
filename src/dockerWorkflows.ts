import * as vscode from 'vscode';
import * as cp from 'child_process';
import {
  WorkflowExecutionPlan,
  WorkflowExecutionStep,
  WebviewWorkflowInputProvider,
  executeFlow,
} from './shared/vscode-components/workflow-execution-plan';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortId(id: string): string { return (id || '').substring(0, 12); }

function shellSync(cmd: string): boolean {
  try {
    cp.execSync(cmd, { shell: process.platform === 'win32' ? 'powershell' : '/bin/bash' });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 1. Create Container (docker run -it)
// ---------------------------------------------------------------------------

export async function runCreateContainerWorkflow(imageId: string): Promise<void> {
  const plan = new WorkflowExecutionPlan(
    'Docker Runner: Create Container',
    [],
    `Create and run a container from ${shortId(imageId)}`,
    `This will execute: docker run -it ${imageId}`
  );

  plan.setVariable('imageId', imageId);

  // Step: show info, then run docker run in a terminal
  plan.addStep(new WorkflowExecutionStep(
    'Create Container',
    `Run interactive container from image ${shortId(imageId)}`,
    async (context) => {
      const id = context.getVariable('imageId') as string;
      const cmd = `docker run -it ${id}`;
      await context.reportProgress([`Executing: ${cmd}`]);

      // Open in a VS Code terminal (interactive)
      const terminal = vscode.window.createTerminal({ name: `Container: ${shortId(id)}` });
      terminal.sendText(cmd);
      terminal.show();

      return { success: true, output: [`Started: ${cmd}`] };
    },
    [],
    undefined,
    false // don't abort workflow on "failure" (interactive)
  ));

  await executeFlow(plan, new WebviewWorkflowInputProvider());
}

// ---------------------------------------------------------------------------
// 2. Commit Container (docker commit)
// ---------------------------------------------------------------------------

export async function runCommitContainerWorkflow(containerId: string): Promise<void> {
  const plan = new WorkflowExecutionPlan(
    'Docker Runner: Commit Container',
    [],
    `Commit changes from ${shortId(containerId)} as a new image`,
    'Collects repository and tag, then runs: docker commit <container> <repository>:<tag>'
  );

  plan.setVariable('containerId', containerId);

  // Step 1: collect repository and tag
  plan.addStep(new WorkflowExecutionStep(
    'Repository & Tag',
    'Enter the repository name and tag for the new image',
    async (context) => {
      const input = context.getInputProvider();
      const values = await input.multiTextEntry({
        name: 'Repository & Tag',
        description: 'Enter the repository name and tag for the new image',
        title: 'Commit Settings',
        fields: [
          { label: 'Repository', storeAs: 'repository', prompt: 'e.g. my-image', required: true },
          { label: 'Tag', storeAs: 'tag', prompt: 'e.g. latest', value: 'latest' },
        ],
      }, context);

      if (values === null) {
        return { success: false, failureDescription: 'Cancelled by user.' };
      }
      return { success: true, output: [`Repository: ${values.repository}:${values.tag}`] };
    }
  ));

  // Step 2: execute docker commit
  plan.addStep(new WorkflowExecutionStep(
    'Commit',
    'Run docker commit',
    async (context) => {
      const cid = context.getVariable('containerId') as string;
      const repo = context.getVariable('repository') as string;
      const tag = context.getVariable('tag') as string;
      const cmd = `docker commit ${cid} ${repo}:${tag}`;
      await context.reportProgress([`Executing: ${cmd}`]);

      const ok = shellSync(cmd);
      return ok
        ? { success: true, output: [`Committed: ${repo}:${tag}`] }
        : { success: false, failureDescription: `docker commit failed.` };
    }
  ));

  // Step 3: refresh tree
  plan.addStep(new WorkflowExecutionStep(
    'Done',
    'Commit complete',
    async (_context) => {
      vscode.commands.executeCommand('vscode-docker-runner.refresh');
      return { success: true, output: ['Tree refreshed.'] };
    }
  ));

  await executeFlow(plan, new WebviewWorkflowInputProvider());
}

// ---------------------------------------------------------------------------
// 3. Load Image (docker image load --input)
// ---------------------------------------------------------------------------

export async function runLoadImageWorkflow(): Promise<void> {
  const plan = new WorkflowExecutionPlan(
    'Docker Runner: Load Image (from save tar)',
    [],
    'Load a Docker image from a save tar — preserves tags and layer history',
    'Select a .tar file and run: docker image load --input <file>'
  );

  // Step 1: select .tar file
  plan.addStep(WorkflowExecutionStep.createFileSelectorStep({
    name: 'Select .tar File',
    description: 'Choose a .tar file to load as a Docker image',
    title: 'Select .tar File',
    storeAs: 'tarFiles',
    required: true,
  }));

  // Step 2: execute docker image load
  plan.addStep(new WorkflowExecutionStep(
    'Load Image',
    'Run docker image load',
    async (context) => {
      const files = context.getVariable('tarFiles') as string[];
      const filePath = files && files.length > 0 ? files[0] : '';
      if (!filePath) {
        return { success: false, failureDescription: 'No file selected.' };
      }
      const cmd = `docker image load --input "${filePath}"`;
      await context.reportProgress([`Executing: ${cmd}`]);

      const ok = shellSync(cmd);
      return ok
        ? { success: true, output: [`Loaded image from: ${filePath}`] }
        : { success: false, failureDescription: `docker image load failed.` };
    }
  ));

  // Step 3: refresh tree
  plan.addStep(new WorkflowExecutionStep(
    'Done',
    'Load complete',
    async (_context) => {
      vscode.commands.executeCommand('vscode-docker-runner.refresh');
      return { success: true, output: ['Tree refreshed.'] };
    }
  ));

  await executeFlow(plan, new WebviewWorkflowInputProvider());
}

// ---------------------------------------------------------------------------
// 4. Import Image (docker image import)
// ---------------------------------------------------------------------------

export async function runImportImageWorkflow(): Promise<void> {
  const plan = new WorkflowExecutionPlan(
    'Docker Runner: Import Image (from filesystem tar)',
    [],
    'Import a Docker image from a filesystem tar — single layer, no history',
    'Select a .tar file and run: docker image import <file>'
  );

  // Step 1: select .tar file
  plan.addStep(WorkflowExecutionStep.createFileSelectorStep({
    name: 'Select .tar File',
    description: 'Choose a .tar file to import as a Docker image',
    title: 'Select .tar File',
    storeAs: 'tarFiles',
    required: true,
  }));

  // Step 2: execute docker image import
  plan.addStep(new WorkflowExecutionStep(
    'Import Image',
    'Run docker image import',
    async (context) => {
      const files = context.getVariable('tarFiles') as string[];
      const filePath = files && files.length > 0 ? files[0] : '';
      if (!filePath) {
        return { success: false, failureDescription: 'No file selected.' };
      }
      const cmd = `docker image import "${filePath}"`;
      await context.reportProgress([`Executing: ${cmd}`]);

      const ok = shellSync(cmd);
      return ok
        ? { success: true, output: [`Imported from: ${filePath}`] }
        : { success: false, failureDescription: `docker image import failed.` };
    }
  ));

  // Step 3: refresh tree
  plan.addStep(new WorkflowExecutionStep(
    'Done',
    'Import complete',
    async (_context) => {
      vscode.commands.executeCommand('vscode-docker-runner.refresh');
      return { success: true, output: ['Tree refreshed.'] };
    }
  ));

  await executeFlow(plan, new WebviewWorkflowInputProvider());
}
