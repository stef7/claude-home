# gdrive-to-proton

Copies your Google Drive into Proton Drive, and keeps copying new and changed
files on later runs. **It never deletes, trashes or moves anything in Proton.**

- **Google side:** Google's official Node.js client (`@googleapis/drive`), with read-only access.
- **Proton side:** Proton's official [Proton Drive CLI](https://github.com/ProtonDriveApps/sdk/tree/main/cli),
  which handles sign-in and encryption. This tool only ever calls its `version` and
  `filesystem upload` commands.

## What happens on each run

1. It lists everything in your Google Drive (file details only, no content).
2. It compares that list with `~/.gdrive-to-proton/state.json` to find new, changed or moved files.
3. It downloads those files in batches (2 GB by default) into `~/.gdrive-to-proton/staging/`.
4. It uploads each batch into `/my-files/Google Drive` in Proton, merging into folders that already exist.
5. It records what was copied and empties the staging folder.

Rules it follows:

- **Deleted in Google:** the file stays in Proton.
- **Moved or renamed in Google:** the file is uploaded at its new path, and the old copy stays in Proton.
- **Changed in Google:** what happens depends on `ON_CHANGE` (see below). The Proton CLI's
  `replace` option, which trashes the Proton file, is blocked in the code.
- **Identical content already in Proton:** the Proton CLI skips it.
- **Upload failure:** the staged batch is kept and is uploaded byte for byte on the next run.
- **Without `--run`:** it's a dry run, which lists what would be copied and touches nothing.

## Setup (once)

You need Node.js 20 or later.

### 1. Install this tool

```sh
cd gdrive-to-proton
npm install
```

### 2. Proton Drive CLI

1. Download it from <https://proton.me/download/drive/cli/index.html>, and put
   `proton-drive` on your `PATH` (or set `PROTON_DRIVE_BIN` to its full path).
2. Run `proton-drive auth login`. It opens a browser to sign in, and stores the session in
   the macOS Keychain.
3. Check that it works: `proton-drive filesystem list /my-files`

### 3. Google: create your own sign-in client

Google requires every app that reads Drive to have its own OAuth client. It takes about 10 minutes:

1. Go to <https://console.cloud.google.com/> and create a project (any name).
2. Open **APIs & Services → Library**, search for **Google Drive API**, and click **Enable**.
3. Open **Google Auth Platform** (or **OAuth consent screen**). Choose **External**, fill in
   the required fields, and add your own Google address as a **test user**.
4. Open **Clients → Create client**, choose **Desktop app**, then **Download JSON**.
5. Save that file as `~/.gdrive-to-proton/google-client.json`.
6. Run `node src/cli.js login-google`, open the link it prints, and approve **read-only** access.

**Weekly expiry:** while the app is in **Testing** status, Google ends the sign-in after
7 days, and you'd need to repeat step 6. To stop that, set the publishing status to
**In production**. Google then shows an "unverified app" warning at sign-in, which is
expected for a personal app.

## Use

```sh
node src/cli.js            # dry run: what would be copied
node src/cli.js --run      # do it
```

The first run copies everything, so on a home connection it may take hours. It's
safe to stop (Ctrl-C) and start again.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `ON_CHANGE` | `keep-both` | What to do when a file already in Proton has changed in Google:<br>`keep-both`: upload the new version next to the old one as `name (1).ext`; nothing is ever lost.<br>`revision`: add a new version of the same Proton file; the old one stays in Proton's version history, which may only be kept for a limited time on your plan.<br>`skip`: never touch a file that's already in Proton. |
| `GDRIVE_ROOT` | `root` | The Google folder to copy (`root` = all of My Drive, or a folder ID from its URL) |
| `PROTON_PARENT` | `/my-files` | The Proton folder to copy into |
| `PROTON_FOLDER` | `Google Drive` | The folder created inside `PROTON_PARENT` |
| `BATCH_MB` | `2048` | The staging disk space used per batch |
| `PROTON_DRIVE_BIN` | `proton-drive` | The path to the Proton CLI |
| `GDRIVE_TO_PROTON_HOME` | `~/.gdrive-to-proton` | Where the state, sign-in and staging files live |

Example: `ON_CHANGE=revision node src/cli.js --run`

## Things to know

- **Google Docs, Sheets, Slides and Drawings** are exported as `.docx`, `.xlsx`, `.pptx`
  and `.svg`. Comments and suggestion history are lost. Forms, Sites and My Maps can't be
  exported, so they're listed as skipped.
- **Shortcuts** and **"Shared with me"** files that aren't in your My Drive aren't copied.
- **Duplicate names** in one Google folder (Google allows them, Proton doesn't) get an ID
  suffix, such as `report (1a2b3c4d).pdf`.
- **Empty Google folders** aren't created in Proton.
- **Don't delete `state.json`.** Without it, every file counts as new again. Ordinary files
  would be skipped as identical, but re-exported Google Docs can differ byte for byte and
  would be uploaded again.
- **Proton's terms:** the Proton SDK and CLI are allowed for personal, non-commercial
  use, but Proton says that they are not yet ready for third-party production use. Proton
  also asks clients not to poll heavily, so run this daily at most.
- **Privacy:** the computer running this sees your files unencrypted while they're staged,
  and holds both sign-ins. `~/.gdrive-to-proton` is created readable only by you.

## Tests

```sh
npm test
```

The tests use an in-memory Google Drive and `test/fake-proton-drive.js`, a stand-in for
the Proton CLI that follows the real CLI's upload rules (identical content is skipped;
otherwise the conflict strategy decides). They check that dry runs touch nothing,
deletions in Google are ignored, changed files are kept alongside or as revisions,
failed uploads are retried from the same staged bytes, and no trash or replace option
can reach Proton.
