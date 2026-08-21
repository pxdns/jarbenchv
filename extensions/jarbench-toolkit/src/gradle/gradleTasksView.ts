/*---------------------------------------------------------------------------------------------
 *  JarBench Toolkit — "Gradle Tasks" sidebar tree.
 *
 *  Shows the same tasks the GradleTaskDetector exposes to the Tasks: Run Task picker, but
 *  organized as a tree: one root per workspace folder (skipped when there's only one folder),
 *  then a group per Gradle task category (Build / Verification / Other), then the tasks
 *  themselves. Clicking a task runs it, matching the built-in npm explorer's convention.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { GradleTaskDetector } from './gradleTaskProvider';

class FolderNode {
	constructor(public readonly folder: vscode.WorkspaceFolder) { }
}

class GroupNode {
	constructor(
		public readonly folder: vscode.WorkspaceFolder,
		public readonly label: string,
		public readonly tasks: vscode.Task[]
	) { }
}

class TaskNode {
	constructor(public readonly task: vscode.Task) { }
}

class MessageNode {
	constructor(public readonly message: string) { }
}

type TreeNode = FolderNode | GroupNode | TaskNode | MessageNode;

function groupFor(task: vscode.Task): string {
	if (task.group === vscode.TaskGroup.Build) {
		return 'Build';
	}
	if (task.group === vscode.TaskGroup.Test) {
		return 'Verification';
	}
	return 'Other';
}

function groupIcon(label: string): vscode.ThemeIcon {
	switch (label) {
		case 'Build': return new vscode.ThemeIcon('tools');
		case 'Verification': return new vscode.ThemeIcon('beaker');
		default: return new vscode.ThemeIcon('list-tree');
	}
}

const GROUP_ORDER = ['Build', 'Verification', 'Other'];

export class GradleTasksViewProvider implements vscode.TreeDataProvider<TreeNode> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(private readonly detector: GradleTaskDetector) { }

	public refresh(): void {
		this.detector.invalidate();
		this._onDidChangeTreeData.fire();
	}

	public getTreeItem(element: TreeNode): vscode.TreeItem {
		if (element instanceof FolderNode) {
			const item = new vscode.TreeItem(element.folder.name, vscode.TreeItemCollapsibleState.Expanded);
			item.iconPath = new vscode.ThemeIcon('root-folder');
			item.contextValue = 'jarbenchGradleFolder';
			return item;
		}
		if (element instanceof GroupNode) {
			const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
			item.iconPath = groupIcon(element.label);
			item.contextValue = 'jarbenchGradleGroup';
			return item;
		}
		if (element instanceof MessageNode) {
			const item = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
			item.contextValue = 'jarbenchGradleMessage';
			return item;
		}
		const task = element.task;
		const item = new vscode.TreeItem(task.name, vscode.TreeItemCollapsibleState.None);
		item.description = task.detail;
		item.tooltip = task.detail ? `${task.name} — ${task.detail}` : task.name;
		item.iconPath = new vscode.ThemeIcon('play');
		item.contextValue = 'jarbenchGradleTask';
		item.command = {
			command: 'jarbench.runGradleTask',
			title: vscode.l10n.t('Run Gradle Task'),
			arguments: [task]
		};
		return item;
	}

	public async getChildren(element?: TreeNode): Promise<TreeNode[]> {
		const folders = vscode.workspace.workspaceFolders ?? [];
		if (!element) {
			if (folders.length === 0) {
				return [new MessageNode(vscode.l10n.t('No workspace folder open.'))];
			}
			if (folders.length === 1) {
				return this.groupsForFolder(folders[0]);
			}
			return folders.map(f => new FolderNode(f));
		}
		if (element instanceof FolderNode) {
			return this.groupsForFolder(element.folder);
		}
		if (element instanceof GroupNode) {
			return element.tasks.map(t => new TaskNode(t));
		}
		return [];
	}

	private async groupsForFolder(folder: vscode.WorkspaceFolder): Promise<TreeNode[]> {
		const allTasks = await this.detector.getAllTasks().catch(() => []);
		const tasks = allTasks.filter(t => t.scope === folder);
		if (tasks.length === 0) {
			return [new MessageNode(vscode.l10n.t('No Gradle project detected here.'))];
		}
		const byGroup = new Map<string, vscode.Task[]>();
		for (const task of tasks) {
			const label = groupFor(task);
			if (!byGroup.has(label)) {
				byGroup.set(label, []);
			}
			byGroup.get(label)!.push(task);
		}
		return GROUP_ORDER
			.filter(label => byGroup.has(label))
			.map(label => new GroupNode(folder, label, byGroup.get(label)!.sort((a, b) => a.name.localeCompare(b.name))));
	}
}
