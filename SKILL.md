---
name: whatsapp-to-jira
description: Read the recent messages of a WhatsApp chat in WhatsApp Web, with voice notes and screenshots. Find the bugs to fix and the features to build, and propose Jira tickets for approval before you create them. Use when the user asks to turn a WhatsApp chat, a client conversation, or "the messages from <person>" into Jira tickets.
---

# WhatsApp to Jira

Nothing goes to Jira before the user approves the preview.

## Settings

Change these values to match your team.

- Ticket language: Italian
- Voice note language: `it` (an ISO code for `transcribe.py`, or leave it empty to auto-detect)

## Requirements

- The Claude in Chrome extension is connected, and `web.whatsapp.com` is linked to the phone.
- In Chrome, "Ask where to save each file" is off. Chrome allows multiple downloads for `web.whatsapp.com`.
- `uv` is on the PATH. `scripts/transcribe.py` installs its own dependencies on the first run.
- The Atlassian MCP server is connected.

## Design

`scripts/wa.js` reads the in-memory message store of WhatsApp Web (`window.require('WAWebCollections')`). The page DOM is unreliable:

- WhatsApp virtualizes the message list. Rows outside the viewport stay in the DOM without content.
- Chrome marks a tab as hidden when its window is not on screen. A hidden tab renders nothing, and Chrome slows its timers to about one tick per minute.

The store works in a hidden tab, and it gives the decrypted media files directly.

Limits of the browser tool:

- `javascript_tool` cuts return values at about 1,500 characters. It also blocks strings that look like base64, raw HTML, or URLs with query strings. For this reason the script saves bulk data as Chrome downloads and returns only short summaries.
- Each call stops after 45 seconds.

## Workflow

### 1. Open WhatsApp Web

1. Call `tabs_context_mcp`. If no tab of this session shows `web.whatsapp.com`, open a new tab on it.
2. If the page shows a QR code, stop. Ask the user to scan it with the phone.
3. Wait until `window.require` exists and `#pane-side` is on the page.

### 2. Inject the reader

1. Read `scripts/wa.js` and pass its full content to `javascript_tool`. The script defines `window.__wa` and returns `__wa.probe()`.
2. If `probe().broken` is not empty, go to the Maintenance section before you continue.
3. After each page reload, inject the script again. `window.__wa` does not survive a reload.

### 3. Choose the chat and the range

1. Run `__wa.findChats('<name>')`. If more than one title matches, ask the user which chat to use.
2. Agree on a start date with the user. The default is the last 7 days. The user can describe the range by topic, for example "the messages before the talk about project X". In that case, extract a wider range first and cut it after you read it.
3. Run `await __wa.loadSince('<exact title>', 'YYYY-MM-DD')`. If `reached` is false, the linked device has no older history. Tell the user the oldest date that is available.

### 4. Extract

1. Make a run prefix: `wa_<YYYYMMDD-HHmmss>`. Use it for every file of the run. Chrome renames a file that already exists to `name (1).ext`, so a fixed name can make you read an old file.
2. Run `__wa.saveMessages('<exact title>', '<prefix>', { from: 'YYYY-MM-DD' })`. The file goes to `~/Downloads/<prefix>_messages.json`.
3. Make a run folder in the scratchpad directory. Move every `~/Downloads/<prefix>_*` file into it.

Each message has these fields: `id`, `date`, `time`, `author` (`Me` for the user), `kind` (`chat`, `image`, `audio`, `ptt`, `document`, and others), `forwarded`, `quoted`, and `text`. Media messages also have `media`, the file name that `saveMedia` gives the file.

### 5. Get the media

1. Read `messages.json`. Find where each topic starts and ends, and cut the range that the user asked for.
2. Collect the `id` of each `image`, `audio`, and `ptt` message in that range.
3. Run `await __wa.saveMedia('<exact title>', '<prefix>', [ids])`. Move the new `<prefix>_*` files into the run folder. Ask for 15 files or fewer per call, because each call stops after 45 seconds.
4. Transcribe the voice notes. The script writes `transcripts.json` into the run folder.
   ```
   uv run --script ~/.claude/skills/whatsapp-to-jira/scripts/transcribe.py "<run folder>" --language <code>
   ```
5. Read each image with the Read tool. Screenshots usually show the error text, the record number, or the screen that the client talks about.

### 6. Find the tickets

Read the conversation in order. Put each transcript and image at the position of its message. Then do these steps for each candidate:

1. Group the messages about the same problem, also when they are hours apart or arrive as quoted replies.
2. Give it a type. A Bug is something that works wrong. A Story is new behavior that the client asks for. A Task is technical work with no visible change.
3. If the chat says that the problem is solved ("fixed", "it works now", "deployed"), mark it as resolved. Propose resolved items only as optional records, and tell the user that they are resolved.
4. Drop questions, small talk, credentials, and scheduling.
5. Keep the evidence: record numbers, the exact error text, and the date and time of the source messages.
6. Search Jira for duplicates in the candidate project. Use JQL `text ~ "<keyword>"` with specific terms such as error codes, product codes, and feature names. If you find a match, show it next to the candidate. Do not propose a new ticket for it.

A message that the user forwards (`forwarded: true`) usually quotes the end client. Treat it as the requirement.

### 7. Choose the labels

1. Find the labels that the project uses. Run JQL `project = <KEY> AND labels is not EMPTY ORDER BY created DESC` and count the labels. Never invent a label that the project does not use.
2. If the user has the source code on this machine, find the code of each candidate. Search for the exact error text, the product code, or the endpoint. The code location tells you the area of the work, for example backend, frontend, or proxy.
3. Propose the labels that match those areas. If a field or a feature does not exist yet, include each area that the change must touch.
4. Show the labels and the evidence (file and line) in the preview.

### 8. Write the tickets

1. Invoke the `writing-whip`, `deslop` and `simple-english` skills if they are installed. Apply their rules to each summary and description: short sentences, active voice, no em dashes, no bold lead-ins, no filler words. A requirement uses "must" or its equivalent in the ticket language.
2. Write the final tickets in the ticket language from the Settings section.
3. Use this structure for the description. Translate the headings into the ticket language.
   - Context: who reported the problem and when, in one or two sentences.
   - Problem (Bug) or Request (Story): what happens or what the client needs. Put the exact error text in a code block.
   - Expected behavior (Bug) or Acceptance criteria (Story): statements that a tester can test.
   - References: record numbers, and the source as "WhatsApp, <chat>, <date> <time>".
4. Do not copy personal data of end customers into tickets, such as names, addresses, phone numbers, or tax codes. The record numbers are enough to find them.

### 9. Show the preview and get approval

Show each proposed ticket with its project, type, labels, summary, and full description. Also list the items that you dropped and the reason, and the duplicates that you found. Then ask the user:

- which tickets to create,
- which Jira project to use (propose one from the content and from the list that `getVisibleJiraProjects` returns),
- what to change in the type or the text.

Do not call `createJiraIssue` before the user answers. Apply the edits of the user. If the edits are large, show the changed tickets again.

### 10. Create the tickets

1. Get the `cloudId` from `getAccessibleAtlassianResources`. If the user has more than one site, ask which site to use.
2. Create the approved tickets with `createJiraIssue` and `contentFormat: "markdown"`. Set the labels in `additional_fields`, for example `{"labels": ["BACKEND"]}`.
3. Give the user the key and the link of each new ticket.
4. The MCP tool cannot attach files. If a screenshot is important, give the user its local path, so that the user can attach it.
5. Delete the run folder after the tickets exist. The folder holds client conversations.

## Maintenance

When WhatsApp releases an update, `probe()` reports what stopped working. All internal names are in `CONFIG` at the top of `scripts/wa.js`. Change only that block and the call shapes that it describes.

- If `require` is false, WhatsApp changed its module system. Look for a new global loader with `Object.keys(window).filter(k => /require|__d/.test(k))`.
- If `collections`, `downloads`, or `history` is false, a module has a new name. List the module names and search them:
  ```js
  Object.keys(window.require('__debug').modulesMap).filter(n => /Collection|DownloadManager|LoadMessages/.test(n))
  ```
- If `saveMedia` returns `Cannot read properties of undefined (reading 'x')`, then `downloadAndMaybeDecrypt` needs a new argument. Pass the arguments through a Proxy that records each missing key that the function reads. Then add those keys to `fetchMedia`:
  ```js
  const seen = new Set();
  const args = new Proxy(base, { get: (t, k) => (k in t ? t[k] : (seen.add(k), undefined)) });
  ```
- If `loadSince` fails, then `loadEarlierMsgs` has a new signature. Use the same Proxy method on its argument.
- If message fields come back empty, inspect a message model with `Object.keys(chat.msgs.getModelsArray().at(-1).attributes ?? {})`. Then update `toMessage`.

After each fix, inject the script again and run `probe()`. Test `extract()` on a known chat and `saveMedia()` on one image and one voice note.
