// Local no-op stub for '@vscode/windows-process-tree' — see package.json for why this exists.
// Every real call site is guarded by process.platform === 'win32', so this never actually runs.
'use strict';

const ProcessDataFlag = {
	None: 0,
	Memory: 1,
	CommandLine: 2
};

function getProcessTree(_rootPid, callback) {
	callback(undefined);
}

function getProcessList(_rootPid, callback) {
	callback(undefined);
}

function getProcessCpuUsage(_processList, callback) {
	callback([]);
}

module.exports = { ProcessDataFlag, getProcessTree, getProcessList, getProcessCpuUsage };
