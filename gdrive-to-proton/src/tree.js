// Turns a flat Google Drive file listing into a list of files with paths.
// Pure functions only, so they can be tested without Google.

export const FOLDER = 'application/vnd.google-apps.folder';
export const SHORTCUT = 'application/vnd.google-apps.shortcut';

// Google-native files have no bytes of their own; they are exported to these formats.
export const EXPORTS = {
    'application/vnd.google-apps.document': {
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ext: '.docx',
    },
    'application/vnd.google-apps.spreadsheet': {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ext: '.xlsx',
    },
    'application/vnd.google-apps.presentation': {
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ext: '.pptx',
    },
    'application/vnd.google-apps.drawing': { mimeType: 'image/svg+xml', ext: '.svg' },
    'application/vnd.google-apps.script': { mimeType: 'application/vnd.google-apps.script+json', ext: '.json' },
};

// Makes a Google name safe as a single path segment on Proton and on the local disk.
export function sanitiseName(name) {
    let clean = String(name)
        .replace(/[/\\]/g, '_')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]/g, '_')
        .trim();
    if (clean === '' || clean === '.' || clean === '..') {
        clean = '_' + clean;
    }
    return clean;
}

function withExt(name, ext) {
    return name.toLowerCase().endsWith(ext) ? name : name + ext;
}

function addSuffix(name, suffix) {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)} ${suffix}${name.slice(dot)}` : `${name} ${suffix}`;
}

/**
 * @param files  Google Drive file resources (id, name, mimeType, parents, modifiedTime, md5Checksum, size, exportLinks)
 * @param rootId ID of the Google folder to copy
 * @returns {{ entries: object[], skipped: object[] }}
 *   entries: files to copy, each with a POSIX `path` relative to the root
 *   skipped: files that can't be copied, with a reason
 */
export function buildTree(files, rootId) {
    const children = new Map();
    for (const file of files) {
        for (const parent of file.parents || []) {
            if (!children.has(parent)) children.set(parent, []);
            children.get(parent).push(file);
        }
    }

    const entries = [];
    const skipped = [];
    const visited = new Set([rootId]);
    const queue = [{ id: rootId, path: '' }];

    while (queue.length > 0) {
        const folder = queue.shift();
        // Sort by ID so that duplicate-name suffixes are the same on every run.
        const kids = (children.get(folder.id) || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
        const usedNames = new Set();

        for (const file of kids) {
            if (visited.has(file.id)) continue;
            visited.add(file.id);

            const where = folder.path ? `${folder.path}/${file.name}` : file.name;

            if (file.mimeType === SHORTCUT) {
                skipped.push({ id: file.id, path: where, reason: 'shortcut' });
                continue;
            }

            let exportAs;
            let name = sanitiseName(file.name);
            if (file.mimeType !== FOLDER && file.mimeType.startsWith('application/vnd.google-apps.')) {
                exportAs = EXPORTS[file.mimeType];
                if (!exportAs) {
                    skipped.push({ id: file.id, path: where, reason: `can't export ${file.mimeType}` });
                    continue;
                }
                name = withExt(name, exportAs.ext);
            }

            // Google allows duplicate names in a folder; Proton doesn't, and macOS
            // disks ignore case, so make names unique without regard to case.
            if (usedNames.has(name.toLowerCase())) {
                name = addSuffix(name, `(${file.id.slice(0, 8)})`);
            }
            usedNames.add(name.toLowerCase());

            const path = folder.path ? `${folder.path}/${name}` : name;

            if (file.mimeType === FOLDER) {
                queue.push({ id: file.id, path });
                continue;
            }

            entries.push({
                id: file.id,
                path,
                mimeType: file.mimeType,
                modifiedTime: file.modifiedTime,
                md5: file.md5Checksum,
                size: file.size === undefined ? undefined : Number(file.size),
                exportAs,
                exportLinks: file.exportLinks,
            });
        }
    }

    return { entries, skipped };
}

// Which entries need copying, given what earlier runs already copied.
export function planChanges(entries, copied) {
    return entries.filter((entry) => {
        const prev = copied[entry.id];
        if (!prev) return true;
        if (prev.path !== entry.path) return true;
        // Ordinary files: compare content. Google Docs have no checksum, so use the edit time.
        if (entry.md5) return prev.md5 !== entry.md5;
        return prev.modifiedTime !== entry.modifiedTime;
    });
}
