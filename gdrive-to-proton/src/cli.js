#!/usr/bin/env node
// gdrive-to-proton: additive copy from Google Drive to Proton Drive.

import { loadConfig } from './config.js';
import { createGoogleSource, loginGoogle } from './google.js';
import { createProtonTarget } from './proton.js';
import { run } from './run.js';

const HELP = `Usage:
  gdrive-to-proton login-google   sign in to Google (once)
  gdrive-to-proton                dry run: list what would be copied
  gdrive-to-proton --run          copy new and changed files to Proton

Nothing in Proton Drive is ever deleted, trashed or moved.
Settings are environment variables; see README.md.`;

async function main(args) {
    if (args.includes('-h') || args.includes('--help')) {
        console.log(HELP);
        return 0;
    }
    const cfg = loadConfig();

    if (args[0] === 'login-google') {
        await loginGoogle(cfg);
        return 0;
    }

    const unknown = args.filter((a) => a !== '--run' && a !== '--dry-run');
    if (unknown.length > 0) {
        console.error(`Unknown option: ${unknown[0]}\n\n${HELP}`);
        return 2;
    }

    const failures = await run({
        cfg,
        google: await createGoogleSource(cfg),
        proton: createProtonTarget(cfg),
        dryRun: !args.includes('--run'),
    });
    return failures > 0 ? 1 : 0;
}

main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
        console.error(`ERROR: ${error.message}`);
        process.exit(1);
    },
);
