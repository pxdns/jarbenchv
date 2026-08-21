/*---------------------------------------------------------------------------------------------
 *  JarBench Toolkit — Gradle task provider.
 *
 *  Modeled on extensions/gulp/src/main.ts: Gradle has no JSON task listing (unlike npm's
 *  package.json scripts), so tasks are discovered by shelling out to the project's own
 *  `gradlew tasks --all` and parsing the plain-text output.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as vscode from 'vscode';

type AutoDetect = 'on' | 'off';

interface GradleTaskDefinition extends vscode.TaskDefinition {
	task: string;
	rootPath?: string;
}

async function exists(filename: string): Promise<boolean> {
	try {
		return (await fs.promises.stat(filename)).isFile();
	} catch {
		return false;
	}
}

function exec(command: string, options: cp.ExecOptions): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		cp.exec(command, { ...options, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) {
				reject({ error, stdout, stderr });
				return;
			}
			resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
		});
	});
}

let _channel: vscode.OutputChannel;
function getOutputChannel(): vscode.OutputChannel {
	if (!_channel) {
		_channel = vscode.window.createOutputChannel('JarBench: Gradle');
	}
	return _channel;
}

async function findGradleCommand(rootPath: string): Promise<string> {
	const wrapperName = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
	const wrapperPath = path.join(rootPath, wrapperName);
	if (await exists(wrapperPath)) {
		return process.platform === 'win32' ? wrapperPath : `"${wrapperPath}"`;
	}
	return 'gradle';
}

/**
 * Parses the plain-text output of `gradle tasks --all --console=plain`.
 *
 * Gradle groups tasks under headers like:
 *   Build tasks
 *   -----------
 *   assemble - Assembles the outputs of this project.
 *
 * A line is treated as a section header when the very next line is a run of '-' characters;
 * all other non-blank lines matching a `name` or `name - description` shape are tasks.
 */
export function parseGradleTasksOutput(stdout: string): { name: string; description?: string }[] {
	const lines = stdout.split(/\r?\n/);
	const isHeaderAt = (i: number): boolean => {
		const next = lines[i + 1];
		return !!next && /^-+$/.test(next.trim()) && next.trim().length > 0;
	};

	const tasks: { name: string; description?: string }[] = [];
	const taskLine = /^([A-Za-z0-9_][\w:.\-]*)(?:\s-\s(.+))?$/;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line.length === 0 || /^-+$/.test(line) || isHeaderAt(i)) {
			continue;
		}
		const match = taskLine.exec(line);
		if (match) {
			tasks.push({ name: match[1], description: match[2] });
		}
	}
	return tasks;
}

class FolderDetector {
	private fileWatcher: vscode.FileSystemWatcher | undefined;
	private promise: Thenable<vscode.Task[]> | undefined;

	constructor(
		private readonly _workspaceFolder: vscode.WorkspaceFolder,
		private readonly _gradleCommand: Promise<string>
	) { }

	public get workspaceFolder(): vscode.WorkspaceFolder {
		return this._workspaceFolder;
	}

	public isEnabled(): boolean {
		return vscode.workspace.getConfiguration('jarbench', this._workspaceFolder.uri).get<AutoDetect>('gradleAutoDetect') === 'on';
	}

	public start(): void {
		const pattern = path.join(this._workspaceFolder.uri.fsPath, '{build.gradle,build.gradle.kts,settings.gradle,settings.gradle.kts}');
		this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
		this.fileWatcher.onDidChange(() => this.promise = undefined);
		this.fileWatcher.onDidCreate(() => this.promise = undefined);
		this.fileWatcher.onDidDelete(() => this.promise = undefined);
	}

	public dispose(): void {
		this.promise = undefined;
		this.fileWatcher?.dispose();
	}

	public invalidate(): void {
		this.promise = undefined;
	}

	public async getTasks(): Promise<vscode.Task[]> {
		if (!this.isEnabled()) {
			return [];
		}
		if (!this.promise) {
			this.promise = this.computeTasks();
		}
		return this.promise;
	}

	public async getTask(_task: vscode.Task): Promise<vscode.Task | undefined> {
		const definition = _task.definition as GradleTaskDefinition;
		if (!definition.task) {
			return undefined;
		}
		const options: vscode.ShellExecutionOptions = { cwd: this.workspaceFolder.uri.fsPath };
		return new vscode.Task(definition, this.workspaceFolder, definition.task, 'gradle',
			new vscode.ShellExecution(await this._gradleCommand, [definition.task, '--console=plain'], options));
	}

	private async hasGradleProject(root: string): Promise<boolean> {
		for (const name of ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts']) {
			if (await exists(path.join(root, name))) {
				return true;
			}
		}
		return false;
	}

	private async computeTasks(): Promise<vscode.Task[]> {
		const rootPath = this._workspaceFolder.uri.scheme === 'file' ? this._workspaceFolder.uri.fsPath : undefined;
		if (!rootPath || !await this.hasGradleProject(rootPath)) {
			return [];
		}

		const gradleCommand = await this._gradleCommand;
		const commandLine = `${gradleCommand} tasks --all --console=plain`;
		try {
			const { stdout, stderr } = await exec(commandLine, { cwd: rootPath });
			if (stderr && stderr.trim().length > 0) {
				getOutputChannel().appendLine(stderr);
			}
			const parsed = parseGradleTasksOutput(stdout);
			const result: vscode.Task[] = [];
			for (const { name, description } of parsed) {
				const definition: GradleTaskDefinition = { type: 'gradle', task: name, rootPath };
				const options: vscode.ShellExecutionOptions = { cwd: rootPath };
				const task = new vscode.Task(definition, this.workspaceFolder, name, 'gradle',
					new vscode.ShellExecution(gradleCommand, [name, '--console=plain'], options));
				task.detail = description;
				if (/^(build|assemble|jar|shadowJar)$/.test(name)) {
					task.group = vscode.TaskGroup.Build;
				} else if (/^test/i.test(name)) {
					task.group = vscode.TaskGroup.Test;
				}
				result.push(task);
			}
			return result;
		} catch (err: any) {
			const channel = getOutputChannel();
			if (err.stderr) {
				channel.appendLine(err.stderr);
			}
			channel.appendLine(vscode.l10n.t('Auto detecting Gradle tasks for folder {0} failed: {1}', this.workspaceFolder.name, err.error ? String(err.error) : 'unknown error'));
			return [];
		}
	}
}

export class GradleTaskDetector implements vscode.Disposable {
	private taskProvider: vscode.Disposable | undefined;
	private readonly detectors = new Map<string, FolderDetector>();

	public start(): void {
		const folders = vscode.workspace.workspaceFolders;
		if (folders) {
			this.updateWorkspaceFolders(folders, []);
		}
		vscode.workspace.onDidChangeWorkspaceFolders(event => this.updateWorkspaceFolders(event.added, event.removed));
		vscode.workspace.onDidChangeConfiguration(() => this.updateWorkspaceFolders(vscode.workspace.workspaceFolders ?? [], []));
	}

	public dispose(): void {
		this.taskProvider?.dispose();
		this.taskProvider = undefined;
		for (const detector of this.detectors.values()) {
			detector.dispose();
		}
		this.detectors.clear();
	}

	private updateWorkspaceFolders(added: readonly vscode.WorkspaceFolder[], removed: readonly vscode.WorkspaceFolder[]): void {
		for (const remove of removed) {
			this.detectors.get(remove.uri.toString())?.dispose();
			this.detectors.delete(remove.uri.toString());
		}
		for (const add of added) {
			if (this.detectors.has(add.uri.toString())) {
				continue;
			}
			const detector = new FolderDetector(add, findGradleCommand(add.uri.fsPath));
			this.detectors.set(add.uri.toString(), detector);
			if (detector.isEnabled()) {
				detector.start();
			}
		}
		this.updateProvider();
	}

	private updateProvider(): void {
		if (!this.taskProvider && this.detectors.size > 0) {
			this.taskProvider = vscode.tasks.registerTaskProvider('gradle', {
				provideTasks: () => this.computeAllTasks(),
				resolveTask: (task: vscode.Task) => this.resolveTask(task)
			});
		} else if (this.taskProvider && this.detectors.size === 0) {
			this.taskProvider.dispose();
			this.taskProvider = undefined;
		}
	}

	private async computeAllTasks(): Promise<vscode.Task[]> {
		const all: vscode.Task[] = [];
		for (const detector of this.detectors.values()) {
			all.push(...await detector.getTasks().catch(() => []));
		}
		return all;
	}

	private async resolveTask(task: vscode.Task): Promise<vscode.Task | undefined> {
		if (task.scope === vscode.TaskScope.Workspace || task.scope === vscode.TaskScope.Global || !task.scope) {
			return undefined;
		}
		return this.detectors.get(task.scope.uri.toString())?.getTask(task);
	}

	/** Used by the sidebar tree view, which needs the full task list independent of the TaskProvider protocol. */
	public getAllTasks(): Promise<vscode.Task[]> {
		return this.computeAllTasks();
	}

	/** Forces the next getAllTasks()/provideTasks() call to re-run `gradlew tasks` instead of using the cached result. */
	public invalidate(): void {
		for (const detector of this.detectors.values()) {
			detector.invalidate();
		}
	}
}
