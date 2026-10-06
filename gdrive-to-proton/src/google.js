// Google side: sign-in, listing and downloading. Read-only access only.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { drive as makeDrive } from '@googleapis/drive';
import { OAuth2Client } from 'google-auth-library';

import { buildTree } from './tree.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

const LIST_FIELDS =
    'nextPageToken, files(id, name, mimeType, parents, modifiedTime, md5Checksum, size, exportLinks)';

async function readClient(clientPath) {
    let raw;
    try {
        raw = JSON.parse(await fs.readFile(clientPath, 'utf8'));
    } catch {
        throw new Error(`Can't read the Google OAuth client file at ${clientPath}. See README, "Google setup".`);
    }
    const client = raw.installed || raw.web;
    if (!client?.client_id) {
        throw new Error(`${clientPath} doesn't look like a Google OAuth "Desktop app" client file`);
    }
    return client;
}

async function saveToken(tokenPath, tokens) {
    await fs.mkdir(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
    const tmp = `${tokenPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    await fs.rename(tmp, tokenPath);
}

// One-off browser sign-in. Listens on 127.0.0.1 for Google's redirect.
export async function loginGoogle({ googleClientPath, googleTokenPath }, log = console.log) {
    const { client_id, client_secret } = await readClient(googleClientPath);

    const server = http.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const redirectUri = `http://127.0.0.1:${server.address().port}`;

    const oauth = new OAuth2Client({ clientId: client_id, clientSecret: client_secret, redirectUri });
    const { codeVerifier, codeChallenge } = await oauth.generateCodeVerifierAsync();
    const state = crypto.randomBytes(16).toString('hex');

    const url = oauth.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [SCOPE],
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
        state,
    });

    log('Open this link in your browser and sign in to Google:\n');
    log(url + '\n');

    const code = await new Promise((resolve, reject) => {
        server.on('request', (req, res) => {
            const params = new URL(req.url, redirectUri).searchParams;
            if (params.get('state') !== state) {
                res.writeHead(400).end('State mismatch. Close this tab and try again.');
                return;
            }
            const error = params.get('error');
            res.writeHead(200, { 'content-type': 'text/plain' }).end(
                error ? `Sign-in failed: ${error}` : 'Signed in. You can close this tab.',
            );
            error ? reject(new Error(`Google sign-in failed: ${error}`)) : resolve(params.get('code'));
        });
    }).finally(() => server.close());

    const { tokens } = await oauth.getToken({ code, codeVerifier, redirect_uri: redirectUri });
    if (!tokens.refresh_token) {
        throw new Error('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and try again.');
    }
    await saveToken(googleTokenPath, tokens);
    log(`Saved Google sign-in to ${googleTokenPath}`);
}

async function authClient({ googleClientPath, googleTokenPath }) {
    const { client_id, client_secret } = await readClient(googleClientPath);
    let tokens;
    try {
        tokens = JSON.parse(await fs.readFile(googleTokenPath, 'utf8'));
    } catch {
        throw new Error('Not signed in to Google yet. Run: gdrive-to-proton login-google');
    }
    const oauth = new OAuth2Client({ clientId: client_id, clientSecret: client_secret });
    oauth.setCredentials(tokens);
    // Keep the saved token current when Google refreshes it.
    oauth.on('tokens', (fresh) => {
        tokens = { ...tokens, ...fresh };
        saveToken(googleTokenPath, tokens).catch(() => {});
    });
    return oauth;
}

export async function createGoogleSource(cfg) {
    const auth = await authClient(cfg);
    const drive = makeDrive({ version: 'v3', auth });

    return {
        async listEntries() {
            const root = await drive.files.get({ fileId: cfg.googleRoot, fields: 'id' });
            const files = [];
            let pageToken;
            do {
                const res = await drive.files.list({
                    q: 'trashed = false',
                    fields: LIST_FIELDS,
                    pageSize: 1000,
                    spaces: 'drive',
                    pageToken,
                });
                files.push(...res.data.files);
                pageToken = res.data.nextPageToken;
            } while (pageToken);
            return buildTree(files, root.data.id);
        },

        // Downloads one entry to `dest`, stamps Google's edit time on it, returns its size.
        async download(entry, dest) {
            await fs.mkdir(path.dirname(dest), { recursive: true });
            const tmp = `${dest}.partial`;

            let res;
            if (entry.exportAs) {
                try {
                    res = await drive.files.export(
                        { fileId: entry.id, mimeType: entry.exportAs.mimeType },
                        { responseType: 'stream' },
                    );
                } catch (error) {
                    // files.export is capped at 10 MB; the export link has no such cap.
                    const link = entry.exportLinks?.[entry.exportAs.mimeType];
                    if (error.code !== 403 || !link) throw error;
                    res = await auth.request({ url: link, responseType: 'stream' });
                }
            } else {
                res = await drive.files.get({ fileId: entry.id, alt: 'media' }, { responseType: 'stream' });
            }

            await pipeline(res.data, createWriteStream(tmp));
            await fs.rename(tmp, dest);
            const when = new Date(entry.modifiedTime);
            await fs.utimes(dest, when, when);
            return (await fs.stat(dest)).size;
        },
    };
}
