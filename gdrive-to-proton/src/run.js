// Orchestration: list Google, work out what's new or changed, download in
// batches to a staging folder, upload each batch with the Proton CLI.

import fs from 'node:fs/promises';
import path from 'node:path';

import { planChanges } from './tree.js';

const STATE_VERSION = 1;

async function readJson(file, fallback) {
    try {
        return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return fallback;
        throw new Error(`Can't read ${file}: ${error.message}`);
    }
}

async function writeJson(file, data) {
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, file);
}

function formatBytes(n) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

async function withLock(lockPath, fn) {
    try {
        await fs.mkdir(lockPath);
    } catch (error) {
        if (error.code === 'EEXIST') {
            throw new Error(`Another run seems to be active. If not, delete ${lockPath}`);
        }
        throw error;
    }
    try {
        return await fn();
    } finally {
        await fs.rm(lockPath, { recursive: true, force: true });
    }
}

/**
 * @param cfg     from loadConfig()
 * @param google  { listEntries(), download(entry, dest) }
 * @param proton  { check(), upload(localFolder) }
 * @param dryRun  list what would be copied; touch nothing
 * @returns       number of files that failed to download (0 means success)
 */
export async function run({ cfg, google, proton, dryRun, log = console.log }) {
    await fs.mkdir(cfg.home, { recursive: true, mode: 0o700 });

    return withLock(cfg.lockPath, async () => {
        const state = await readJson(cfg.statePath, { version: STATE_VERSION, copied: {} });
        const batchFile = path.join(cfg.stagingDir, 'batch.json');
        const uploadRoot = path.join(cfg.stagingDir, cfg.protonFolder);

        const uploadBatch = async (batch) => {
            await writeJson(batchFile, batch);
            log(`\nUploading ${batch.length} file(s) to ${cfg.protonParent}/${cfg.protonFolder} ...`);
            await proton.upload(uploadRoot);
            for (const entry of batch) {
                state.copied[entry.id] = { path: entry.path, md5: entry.md5, modifiedTime: entry.modifiedTime };
            }
            await writeJson(cfg.statePath, state);
            await fs.rm(cfg.stagingDir, { recursive: true, force: true });
        };

        if (!dryRun) {
            await proton.check();
            // A batch left over from a failed run is uploaded as-is, byte for byte,
            // so re-exported Google Docs don't create needless extra copies.
            const leftover = await readJson(batchFile, null);
            if (leftover) {
                log(`Retrying ${leftover.length} file(s) left over from an unfinished run`);
                await uploadBatch(leftover);
            } else {
                await fs.rm(cfg.stagingDir, { recursive: true, force: true });
            }
        }

        log('Listing Google Drive ...');
        const { entries, skipped } = await google.listEntries();
        const todo = planChanges(entries, state.copied);
        const knownBytes = todo.reduce((sum, e) => sum + (e.size || 0), 0);

        log(`Google Drive: ${entries.length} file(s); ${todo.length} new or changed (${formatBytes(knownBytes)} plus Google Docs exports).`);
        for (const s of skipped) log(`  skipped (${s.reason}): ${s.path}`);

        if (dryRun) {
            for (const e of todo.slice(0, 50)) log(`  would copy: ${e.path}`);
            if (todo.length > 50) log(`  ... and ${todo.length - 50} more`);
            log('\nDRY RUN: nothing was downloaded or uploaded. Add --run to do it.');
            return 0;
        }

        const failures = [];
        let batch = [];
        let batchBytes = 0;

        for (const entry of todo) {
            const dest = path.join(uploadRoot, ...entry.path.split('/'));
            try {
                batchBytes += await google.download(entry, dest);
                batch.push(entry);
            } catch (error) {
                failures.push(entry);
                log(`  download failed: ${entry.path}: ${error.message}`);
                await fs.rm(`${dest}.partial`, { force: true });
                continue;
            }
            if (batchBytes >= cfg.batchBytes) {
                await uploadBatch(batch);
                batch = [];
                batchBytes = 0;
            }
        }
        if (batch.length > 0) await uploadBatch(batch);

        log(`\nDone. ${todo.length - failures.length} file(s) copied, ${failures.length} failed.`);
        if (failures.length > 0) log('Failed files will be tried again on the next run.');
        return failures.length;
    });
}
