/** Path handling for the ACP `fs/*` methods: everything stays inside the session cwd. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export function resolveWithin(root: string, target: string): string {
	const base = resolve(root);
	const absolute = isAbsolute(target) ? resolve(target) : resolve(base, target);
	const rel = relative(base, absolute);
	if (rel.length > 0 && (rel.startsWith("..") || isAbsolute(rel))) {
		throw new Error(`Path is outside the session directory: ${target}`);
	}
	return absolute;
}

export async function readTextWithin(
	root: string,
	target: string,
	options: { line?: number | null; limit?: number | null } = {},
): Promise<string> {
	const file = resolveWithin(root, target);
	const raw = await readFile(file, "utf8");
	const start = typeof options.line === "number" && options.line > 0 ? options.line - 1 : 0;
	const limit = typeof options.limit === "number" && options.limit > 0 ? options.limit : undefined;
	if (start === 0 && limit === undefined) return raw;
	const lines = raw.split("\n");
	const slice = lines.slice(start, limit === undefined ? undefined : start + limit);
	return slice.join("\n");
}

export async function writeTextWithin(root: string, target: string, content: string): Promise<void> {
	const file = resolveWithin(root, target);
	await mkdir(resolve(file, ".."), { recursive: true });
	await writeFile(file, content, "utf8");
}
