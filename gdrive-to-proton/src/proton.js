// Proton side: runs the official Proton Drive CLI.
// Only `version` and `filesystem upload` are ever called. No trash, delete or move.

import { spawn } from 'node:child_process';

import { ON_CHANGE } from './config.js';

const ALLOWED_FILE_STRATEGIES = new Set(Object.values(ON_CHANGE));

export function uploadArgs(cfg, localFolder) {
    if (!ALLOWED_FILE_STRATEGIES.has(cfg.fileStrategy)) {
        throw new Error(`Refusing file conflict strategy "${cfg.fileStrategy}"`);
    }
    return [
        'filesystem',
        'upload',
        localFolder,
        cfg.protonParent,
        // Existing folders are merged into, never trashed or renamed.
        '--folder-conflict-strategy',
        'merge',
        '--file-conflict-strategy',
        cfg.fileStrategy,
    ];
}

function runCli(bin, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(bin, args, { stdio: 'inherit' });
        child.on('error', (error) =>
            reject(
                error.code === 'ENOENT'
                    ? new Error(`Can't find the Proton Drive CLI ("${bin}"). See README, "Proton setup".`)
                    : error,
            ),
        );
        child.on('close', (code) => resolve(code));
    });
}

export function createProtonTarget(cfg) {
    return {
        async check() {
            const code = await runCli(cfg.protonBin, ['version']);
            if (code !== 0) throw new Error(`"${cfg.protonBin} version" failed (exit code ${code})`);
        },
        async upload(localFolder) {
            const code = await runCli(cfg.protonBin, uploadArgs(cfg, localFolder));
            if (code !== 0) {
                throw new Error(
                    `Proton upload failed (exit code ${code}). If you're signed out, run: ${cfg.protonBin} auth login`,
                );
            }
        },
    };
}
