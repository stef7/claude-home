import os from 'node:os';
import path from 'node:path';

// What to do when a file already in Proton has changed in Google Drive.
// Maps our option names to the official Proton Drive CLI's conflict strategies.
// The CLI's 'replace' strategy (trash the Proton file) is deliberately absent.
export const ON_CHANGE = {
    // New version of the same file; old one goes to Proton's version history,
    // which keeps 10 versions / 7 days on the free plan and 200 versions / 10 years on paid plans.
    revision: 'create-new-revision',
    'keep-both': 'rename', // upload the new version next to the old one, as "name (1).ext"
    skip: 'skip', // leave the Proton copy untouched
};

export function loadConfig(env = process.env) {
    const home = env.GDRIVE_TO_PROTON_HOME || path.join(os.homedir(), '.gdrive-to-proton');

    const onChange = env.ON_CHANGE || 'revision';
    if (!Object.hasOwn(ON_CHANGE, onChange)) {
        throw new Error(`ON_CHANGE must be one of: ${Object.keys(ON_CHANGE).join(', ')} (got "${onChange}")`);
    }

    const protonFolder = env.PROTON_FOLDER || 'Google Drive';
    if (/[/\\]/.test(protonFolder) || protonFolder.trim() !== protonFolder || !protonFolder) {
        throw new Error('PROTON_FOLDER must be a single folder name, without slashes or leading/trailing spaces');
    }

    const protonParent = env.PROTON_PARENT || '/my-files';
    if (!protonParent.startsWith('/my-files')) {
        throw new Error('PROTON_PARENT must be inside /my-files');
    }

    const batchMb = Number(env.BATCH_MB || 2048);
    if (!(batchMb > 0)) {
        throw new Error('BATCH_MB must be a positive number');
    }

    return {
        home,
        googleRoot: env.GDRIVE_ROOT || 'root',
        protonParent,
        protonFolder,
        onChange,
        fileStrategy: ON_CHANGE[onChange],
        batchBytes: batchMb * 1024 * 1024,
        protonBin: env.PROTON_DRIVE_BIN || 'proton-drive',
        googleClientPath: env.GOOGLE_CLIENT_FILE || path.join(home, 'google-client.json'),
        googleTokenPath: path.join(home, 'google-token.json'),
        statePath: path.join(home, 'state.json'),
        stagingDir: path.join(home, 'staging'),
        lockPath: path.join(home, 'lock'),
    };
}
