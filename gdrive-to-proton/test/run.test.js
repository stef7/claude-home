import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../src/config.js';
import { createProtonTarget, uploadArgs } from '../src/proton.js';
import { run } from '../src/run.js';
import { buildTree } from '../src/tree.js';

const fakeBin = fileURLToPath(new URL('./fake-proton-drive.js', import.meta.url));

// In-memory Google Drive: { name: content } at the root, plus folder "sub".
function fakeGoogle(drive) {
    return {
        async listEntries() {
            const files = [{ id: 'sub', name: 'sub', parents: ['root'], mimeType: 'application/vnd.google-apps.folder' }];
            for (const [p, content] of Object.entries(drive)) {
                const [parent, name] = p.includes('/') ? p.split('/') : ['root', p];
                files.push({ id: `id-${p}`, name, parents: [parent], mimeType: 'text/plain', md5Checksum: content, size: String(content.length), modifiedTime: '2026-01-01T00:00:00Z' });
            }
            return buildTree(files, 'root');
        },
        async download(entry, dest) {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, drive[entry.id.slice(3)]);
            return drive[entry.id.slice(3)].length;
        },
    };
}

function setup(onChange) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g2p-'));
    const protonRoot = path.join(tmp, 'proton');
    fs.mkdirSync(protonRoot);
    process.env.FAKE_PROTON_ROOT = protonRoot;
    delete process.env.FAKE_PROTON_FAIL;
    const cfg = loadConfig({ GDRIVE_TO_PROTON_HOME: path.join(tmp, 'home'), PROTON_DRIVE_BIN: fakeBin, ON_CHANGE: onChange });
    const read = (p) => fs.readFileSync(path.join(protonRoot, 'Google Drive', p), 'utf8');
    const exists = (p) => fs.existsSync(path.join(protonRoot, 'Google Drive', p));
    const calls = () => fs.readFileSync(path.join(tmp, 'calls.log'), 'utf8').trim().split('\n').map(JSON.parse);
    return { tmp, protonRoot, cfg, read, exists, calls, log: () => {} };
}

test('dry run touches neither Proton nor state', async () => {
    const t = setup('keep-both');
    await run({ cfg: t.cfg, google: fakeGoogle({ 'a.txt': 'one' }), proton: createProtonTarget(t.cfg), dryRun: true, log: t.log });
    assert.equal(fs.existsSync(path.join(t.tmp, 'calls.log')), false);
    assert.equal(fs.existsSync(t.cfg.statePath), false);
});

test('copies, ignores Google deletions, keeps both versions on change', async () => {
    const t = setup('keep-both');
    fs.mkdirSync(path.join(t.protonRoot, 'Google Drive'));
    fs.writeFileSync(path.join(t.protonRoot, 'Google Drive', 'mine.txt'), 'only in proton');
    const drive = { 'a.txt': 'one', 'sub/b.txt': 'two' };
    const go = () => run({ cfg: t.cfg, google: fakeGoogle(drive), proton: createProtonTarget(t.cfg), dryRun: false, log: t.log });

    assert.equal(await go(), 0);
    assert.equal(t.read('a.txt'), 'one');
    assert.equal(t.read('sub/b.txt'), 'two');

    delete drive['sub/b.txt'];
    drive['a.txt'] = 'one, edited';
    assert.equal(await go(), 0);
    assert.equal(t.read('sub/b.txt'), 'two', 'deleted in Google, still in Proton');
    assert.equal(t.read('a.txt'), 'one', 'old version untouched');
    assert.equal(t.read('a (1).txt'), 'one, edited', 'new version alongside');
    assert.equal(t.read('mine.txt'), 'only in proton');

    // Nothing changed: no upload at all on the third run.
    const before = t.calls().length;
    assert.equal(await go(), 0);
    assert.deepEqual(t.calls().slice(before).map((c) => c[0]), ['version']);
});

test('revision mode keeps the old version in history', async () => {
    const t = setup('revision');
    const drive = { 'a.txt': 'one' };
    const go = () => run({ cfg: t.cfg, google: fakeGoogle(drive), proton: createProtonTarget(t.cfg), dryRun: false, log: t.log });
    await go();
    drive['a.txt'] = 'two';
    await go();
    assert.equal(t.read('a.txt'), 'two');
    const revs = fs.readdirSync(path.join(t.tmp, 'revisions'));
    assert.equal(fs.readFileSync(path.join(t.tmp, 'revisions', revs[0]), 'utf8'), 'one');
});

test('a failed upload is retried from the same staged files next time', async () => {
    const t = setup('keep-both');
    const drive = { 'a.txt': 'one' };
    process.env.FAKE_PROTON_FAIL = '1';
    await assert.rejects(run({ cfg: t.cfg, google: fakeGoogle(drive), proton: createProtonTarget(t.cfg), dryRun: false, log: t.log }));
    assert.ok(fs.existsSync(path.join(t.cfg.stagingDir, 'batch.json')));
    assert.ok(!fs.existsSync(t.cfg.lockPath), 'lock released');

    delete process.env.FAKE_PROTON_FAIL;
    drive['a.txt'] = 'changed meanwhile';
    assert.equal(await run({ cfg: t.cfg, google: fakeGoogle(drive), proton: createProtonTarget(t.cfg), dryRun: false, log: t.log }), 0);
    assert.equal(t.read('a.txt'), 'one', 'leftover batch uploaded as staged');
    assert.equal(t.read('a (1).txt'), 'changed meanwhile');
});

test('never passes a trash/replace strategy to Proton', () => {
    for (const onChange of ['keep-both', 'revision', 'skip']) {
        const args = uploadArgs(loadConfig({ ON_CHANGE: onChange }), '/x');
        assert.ok(!args.includes('replace'));
        assert.equal(args[args.indexOf('--folder-conflict-strategy') + 1], 'merge');
    }
    assert.throws(() => loadConfig({ ON_CHANGE: 'replace' }));
    assert.throws(() => uploadArgs({ fileStrategy: 'replace', protonParent: '/my-files' }, '/x'));
    assert.throws(() => loadConfig({ PROTON_FOLDER: 'a/b' }));
});
