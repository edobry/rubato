import { readFile, writeFile } from "node:fs/promises";

/**
 * Async interface for preset persistence.
 * Implementations can back this with the filesystem, a database, etc.
 */
export interface PresetStore {
	list(): Promise<Record<string, unknown>>;
	save(name: string, preset: unknown): Promise<void>;
	delete(name: string): Promise<void>;
}

/**
 * Stores presets as a single JSON file on disk.
 * Missing files are treated as an empty preset collection.
 */
export class FilePresetStore implements PresetStore {
	constructor(private filePath: string) {}

	async list(): Promise<Record<string, unknown>> {
		try {
			const raw = await readFile(this.filePath, "utf-8");
			return JSON.parse(raw) as Record<string, unknown>;
		} catch (err: unknown) {
			// Missing file → empty collection
			if (
				err instanceof Error &&
				"code" in err &&
				(err as NodeJS.ErrnoException).code === "ENOENT"
			) {
				return {};
			}
			throw err;
		}
	}

	async save(name: string, preset: unknown): Promise<void> {
		const data = await this.list();
		data[name] = preset;
		await writeFile(this.filePath, JSON.stringify(data, null, "\t"), "utf-8");
	}

	async delete(name: string): Promise<void> {
		const data = await this.list();
		delete data[name];
		await writeFile(this.filePath, JSON.stringify(data, null, "\t"), "utf-8");
	}
}
