// Local no-op stub for '@vscode/windows-process-tree' — see package.json for why this exists.

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
	commandLine?: string;
}

export const enum ProcessDataFlag {
	None = 0,
	MemoryUsage = 1,
	CommandLine = 2
}

export function getProcessTree(rootPid: number, callback: (tree: IProcessTreeNode | undefined) => void, flags?: ProcessDataFlag): void;
export function getProcessList(rootPid: number, callback: (processList: IProcessInfo[] | undefined) => void, flags?: ProcessDataFlag): void;
