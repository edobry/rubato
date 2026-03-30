import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export interface ClipStore {
	/** Save clip data and return the relative URL path (e.g. `/clips/clip-123.webm`). */
	save(id: string, data: Buffer): Promise<string>;
	/** Retrieve clip data by filename, or null if not found. */
	get(id: string): Promise<Buffer | null>;
	/** List all stored clip filenames. */
	list(): Promise<string[]>;
	/** Create a writable stream for the given filename, returning the relative URL path. */
	filePath(id: string): string;
}

export class FileClipStore implements ClipStore {
	constructor(private directory: string) {
		fs.mkdirSync(directory, { recursive: true });
	}

	async save(id: string, data: Buffer): Promise<string> {
		const filepath = path.join(this.directory, id);
		await fsp.writeFile(filepath, data);
		return `/clips/${id}`;
	}

	async get(id: string): Promise<Buffer | null> {
		const filepath = path.join(this.directory, id);
		try {
			return await fsp.readFile(filepath);
		} catch {
			return null;
		}
	}

	async list(): Promise<string[]> {
		try {
			return await fsp.readdir(this.directory);
		} catch {
			return [];
		}
	}

	filePath(id: string): string {
		return path.join(this.directory, id);
	}
}
