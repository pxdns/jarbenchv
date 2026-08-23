// Local no-op stub for '@vscode/windows-process-tree' — see package.json for why this exists.
// Shape kept in sync with what this codebase actually calls (verified via tsc errors against
// src/vs/base/node/ps.ts and src/vs/platform/terminal/node/windowsShellHelper.ts), not the
// full real API surface.

export interface IProcessTreeNode {
	pid: number;
	name: string;
	memory?: number;
	commandLine?: string;
	children: IProcessTreeNode[];
}

export interface IProcessInfo {
	pid: number;
	ppid: number;
	name: string;
	memory?: number;
	cpu?: number;
	commandLine?: string;
}

export const enum ProcessDataFlag {
	None = 0,
	Memory = 1,
	CommandLine = 2
}

export function getProcessTree(rootPid: number, callback: (tree: IProcessTreeNode | undefined) => void, flags?: ProcessDataFlag): void;
export function getProcessList(rootPid: number, callback: (processList: IProcessInfo[] | undefined) => void, flags?: ProcessDataFlag): void;
export function getProcessCpuUsage(processList: IProcessInfo[], callback: (completeProcessList: IProcessInfo[]) => void): void;
