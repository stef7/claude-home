import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTree, planChanges, sanitiseName } from '../src/tree.js';

const F = 'application/vnd.google-apps.folder';
const file = (id, name, parent, extra = {}) => ({ id, name, parents: [parent], mimeType: 'text/plain', modifiedTime: 't1', md5Checksum: `md5-${id}`, size: '3', ...extra });

test('builds paths, exports Google Docs, skips shortcuts, forms and unreachable files', () => {
    const { entries, skipped } = buildTree(
        [
            { id: 'f1', name: 'Work', parents: ['root'], mimeType: F },
            file('a', 'notes.txt', 'f1'),
            { id: 'd', name: 'Plan', parents: ['f1'], mimeType: 'application/vnd.google-apps.document', modifiedTime: 't1' },
            { id: 's', name: 'Link', parents: ['root'], mimeType: 'application/vnd.google-apps.shortcut' },
            { id: 'q', name: 'Survey', parents: ['root'], mimeType: 'application/vnd.google-apps.form' },
            file('x', 'shared-with-me.txt', 'someone-elses-folder'),
        ],
        'root',
    );
    assert.deepEqual(entries.map((e) => e.path).sort(), ['Work/Plan.docx', 'Work/notes.txt']);
    assert.deepEqual(skipped.map((s) => s.reason).sort(), ["can't export application/vnd.google-apps.form", 'shortcut']);
});

test('gives duplicate names (ignoring case) a stable suffix', () => {
    const { entries } = buildTree([file('bbbbbbbbbb', 'a.txt', 'root'), file('aaaaaaaaaa', 'A.txt', 'root')], 'root');
    assert.deepEqual(entries.map((e) => e.path), ['A.txt', 'a (bbbbbbbb).txt']);
});

test('sanitises names', () => {
    assert.equal(sanitiseName(' a/b\\c\n '), 'a_b_c_');
    assert.equal(sanitiseName('..'), '_..');
});

test('plans only new, moved or changed files', () => {
    const entries = [
        { id: 'same', path: 'a', md5: 'm' },
        { id: 'new', path: 'b', md5: 'm' },
        { id: 'edited', path: 'c', md5: 'm2' },
        { id: 'moved', path: 'd2', md5: 'm' },
        { id: 'doc', path: 'e.docx', modifiedTime: 't2' },
        { id: 'touched', path: 'f', md5: 'm', modifiedTime: 't2' },
    ];
    const copied = {
        same: { path: 'a', md5: 'm' },
        edited: { path: 'c', md5: 'm' },
        moved: { path: 'd', md5: 'm' },
        doc: { path: 'e.docx', modifiedTime: 't1' },
        touched: { path: 'f', md5: 'm', modifiedTime: 't1' },
    };
    assert.deepEqual(planChanges(entries, copied).map((e) => e.id), ['new', 'edited', 'moved', 'doc']);
});
