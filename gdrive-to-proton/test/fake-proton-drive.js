#!/usr/bin/env node
// Stand-in for the official `proton-drive` CLI, backed by a local folder.
// Mimics `filesystem upload` conflict handling from the real CLI
// (cli/src/commands/fileSystem/commandFileSystemUpload.ts): identical content
// is skipped; otherwise the --file-conflict-strategy decides.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.FAKE_PROTON_ROOT;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(root, '..', 'calls.log'), JSON.stringify(args) + '\n');

if (args[0] === 'version') process.exit(0);
if (args[0] !== 'filesystem' || args[1] !== 'upload') process.exit(9);
if (process.env.FAKE_PROTON_FAIL) process.exit(1);

const opt = (name) => args[args.indexOf(name) + 1];
const [local, parent] = args.slice(2, 4);
const fileStrategy = opt('--file-conflict-strategy');
if (opt('--folder-conflict-strategy') !== 'merge') process.exit(8);

const sha1 = (p) => crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
const remoteDir = (p) => path.join(root, p.replace(/^\/my-files/, ''));

function upload(src, destDir) {
    const name = path.basename(src);
    let dest = path.join(destDir, name);
    if (fs.statSync(src).isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        for (const child of fs.readdirSync(src)) upload(path.join(src, child), dest);
        return;
    }
    if (fs.existsSync(dest)) {
        if (sha1(dest) === sha1(src)) return;
        if (fileStrategy === 'skip') return;
        if (fileStrategy === 'rename') {
            const ext = path.extname(name), base = path.basename(name, ext);
            for (let i = 1; fs.existsSync(dest); i++) dest = path.join(destDir, `${base} (${i})${ext}`);
        } else if (fileStrategy === 'create-new-revision') {
            const revs = path.join(root, '..', 'revisions');
            fs.mkdirSync(revs, { recursive: true });
            fs.copyFileSync(dest, path.join(revs, `${name}.${Date.now()}.${Math.random()}`));
        } else {
            process.exit(7); // 'replace' would trash the Proton file
        }
    }
    fs.copyFileSync(src, dest);
}

upload(local, remoteDir(parent));
