/*---------------------------------------------------------------------------------------------
 *  JarBench Toolkit — Gradle dependency tree.
 *
 *  Shells out to `gradlew dependencies --console=plain` and parses Gradle's own ASCII tree
 *  format, e.g.:
 *
 *    compileClasspath - Compile classpath for source set 'main'.
 *    +--- org.foo:bar:1.0
 *    |    \--- org.baz:qux:2.0 -> 2.1
 *    \--- org.other:thing:3.0 (*)
 *
 *  Each 5-character prefix group ("|    " or "     ") is one indentation level; the line's own
 *  marker ("+--- " / "\--- ") is the last one. "->" means the requested version was resolved to
 *  a different one (a real conflict); "(*)" means the subtree was already printed elsewhere.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface DependencyNode {
	/** "group:artifact:requestedVersion", exactly as Gradle printed it (minus the -> / (*) markers). */
	coordinate: string;
	/** Present when Gradle resolved this to a different version than requested (a real conflict). */
	resolvedVersion?: string;
	/** True when Gradle collapsed this subtree because it's printed in full elsewhere in the same tree. */
	omitted: boolean;
	children: DependencyNode[];
}

export interface ConfigurationTree {
	name: string;
	description?: string;
	roots: DependencyNode[];
}

const MARKER_RE = /^(?:\|    |     )*(\+--- |\\--- )/;

export function parseGradleDependenciesOutput(stdout: string): ConfigurationTree[] {
	const lines = stdout.split(/\r?\n/);
	const configs: ConfigurationTree[] = [];

	let current: ConfigurationTree | undefined;
	// Stack of [depth, node] pairs to attach children to the right parent as indentation changes.
	let stack: { depth: number; node: DependencyNode }[] = [];

	const headerRe = /^([A-Za-z][\w.]*) - (.*)$/;
	const bareHeaderRe = /^([A-Za-z][\w.]*)$/;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const match = MARKER_RE.exec(line);
		if (match) {
			if (!current) {
				continue;
			}
			const depth = (match[0].length - match[1].length) / 5;
			const rest = line.slice(match[0].length).trim();
			const omitted = rest.endsWith('(*)');
			const body = omitted ? rest.slice(0, -3).trim() : rest;
			const arrow = body.match(/^(.*?)\s*->\s*(.+)$/);
			const node: DependencyNode = {
				coordinate: arrow ? arrow[1] : body,
				resolvedVersion: arrow ? arrow[2] : undefined,
				omitted,
				children: []
			};

			stack = stack.filter(s => s.depth < depth);
			const parent = stack.length > 0 ? stack[stack.length - 1].node : undefined;
			if (parent) {
				parent.children.push(node);
			} else {
				current.roots.push(node);
			}
			stack.push({ depth, node });
			continue;
		}

		// Not a tree line: either blank (ends the current configuration) or a new configuration header.
		if (line.trim().length === 0) {
			current = undefined;
			stack = [];
			continue;
		}
		const header = headerRe.exec(line) ?? bareHeaderRe.exec(line);
		if (header && !line.startsWith(' ')) {
			current = { name: header[1], description: header[2], roots: [] };
			configs.push(current);
			stack = [];
		}
	}

	return configs;
}

function exec(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise(resolve => {
		cp.execFile(command, args, { cwd, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
			resolve({ stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '', code: error ? (error as any).code ?? 1 : 0 });
		});
	});
}

async function exists(filePath: string): Promise<boolean> {
	try {
		return (await fs.promises.stat(filePath)).isFile();
	} catch {
		return false;
	}
}

async function findGradleCommand(rootPath: string): Promise<string> {
	const wrapperName = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
	const wrapperPath = path.join(rootPath, wrapperName);
	if (await exists(wrapperPath)) {
		return wrapperPath;
	}
	return 'gradle';
}

export async function fetchDependencyTree(rootPath: string): Promise<ConfigurationTree[]> {
	const gradleCommand = await findGradleCommand(rootPath);
	const result = await exec(gradleCommand, ['dependencies', '--console=plain'], rootPath);
	return parseGradleDependenciesOutput(result.stdout);
}
