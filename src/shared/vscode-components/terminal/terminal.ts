import * as vscode from 'vscode';
import { stripVTControlCharacters } from 'util';

let startingShell = false;
let terminal: vscode.Terminal | null = null;
let shell: vscode.TerminalShellIntegration | null = null;
const TERMINAL_EXECUTION_END_TIMEOUT_MS = 5000;

export function terminalChangedShellIntegration(shellIntegration: vscode.TerminalShellIntegration) {
	if (startingShell === true && shell !== shellIntegration) {
		shell = shellIntegration;
	}
}

export function terminalDidClose(e: vscode.Terminal) {
	if (e === terminal) {
		terminal = null;
		shell = null;
		startingShell = false;
	}
}

export async function executeCommand(cmd: string, ignoreFailure: boolean = false) {

	await ensureShell();
	if (!shell) return false;
	const command = shell.executeCommand(cmd);
	const exitStatusPromise = waitForTerminalCommandEnd(cmd, terminal);

	let response: string = '';
	for await (let v of command.read()) {
		response += v;
	}
	response = stripVTControlCharacters(response);

	const e = await exitStatusPromise;
	const exitStatus = e ? (e.exitCode === 0) : false;

	if (exitStatus || ignoreFailure || e === null) {
		// empty response would lead to failure sometimes?
		if (!response) {
			response = "OK";
		}
		return response.split(/\r?\n/);
	} else {
		return false;
	}
}

export async function executeCommandStreaming(cmd: string,
                                              onOutputLine?: (line: string) => void | Promise<void>,
                                              ignoreFailure: boolean = false) {

	await ensureShell();
	if (!shell) return false;
	const command = shell.executeCommand(cmd);
	const exitStatusPromise = waitForTerminalCommandEnd(cmd, terminal);

	let response: string = '';
	let pendingLine = '';
	for await (let v of command.read()) {
		const chunk = stripVTControlCharacters(v);
		response += chunk;

		if (onOutputLine) {
			pendingLine += chunk;
			const parts = pendingLine.split(/\r?\n/);
			pendingLine = parts.pop() ?? '';

			for (const line of parts) {
				const normalized = line.trimEnd();
				if (normalized !== '') {
					await onOutputLine(normalized);
				}
			}
		}
	}

	if (onOutputLine) {
		const tail = pendingLine.trimEnd();
		if (tail !== '') {
			await onOutputLine(tail);
		}
	}

	response = stripVTControlCharacters(response);

	const e = await exitStatusPromise;
	const exitStatus = e ? (e.exitCode === 0) : false;

	if (exitStatus || ignoreFailure || e === null) {
		if (!response) {
			response = 'OK';
		}
		return response.split(/\r?\n/);
	} else {
		return false;
	}
}

export function getShellCwd() {
	if (terminal) {
		if (terminal.shellIntegration) {
			return terminal.shellIntegration.cwd?.fsPath;
		}
	}
	return '';
}

async function ensureShell() {

	if (shell === null && !startingShell) {
		startingShell = true;
		terminal = vscode.window.createTerminal({
			name: 'Opera',
			shellPath: process.platform === 'win32'
				? 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
				: '/bin/bash',
			shellArgs: []
		});
		terminal.show();
	}

	while (shell === null) {
		await new Promise(resolve => setTimeout(resolve, 50));
	}
}

function waitForTerminalCommandEnd(cmd: string,
											 commandTerminal: vscode.Terminal | null): Promise<vscode.TerminalShellExecutionEndEvent | null> {
	return new Promise<vscode.TerminalShellExecutionEndEvent | null>(resolve => {
		let resolved = false;
		const finish = (value: vscode.TerminalShellExecutionEndEvent | null) => {
			if (resolved) {
				return;
			}
			resolved = true;
			clearTimeout(timeoutHandle);
			onEndDisposable.dispose();
			onCloseDisposable.dispose();
			resolve(value);
		};

		const onEndDisposable = vscode.window.onDidEndTerminalShellExecution(e => {
			if (e.execution.commandLine.value === cmd) {
				finish(e);
			}
		});

		const onCloseDisposable = vscode.window.onDidCloseTerminal(e => {
			if (commandTerminal !== null && e === commandTerminal) {
				finish(null);
			}
		});

		const timeoutHandle = setTimeout(() => finish(null), TERMINAL_EXECUTION_END_TIMEOUT_MS);
	});
}
