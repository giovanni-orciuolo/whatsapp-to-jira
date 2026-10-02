# whatsapp-to-jira

A [Claude Code](https://claude.com/claude-code) skill that turns a WhatsApp conversation into Jira tickets.

Clients often report bugs and ask for features in WhatsApp chats, with voice notes and screenshots mixed in. This skill turns those chats into Jira tickets, and you approve each ticket first.

## Steps

1. It opens WhatsApp Web in your Chrome browser and reads the chat that you name, for the date range that you give.
2. It downloads the voice notes and images of that range.
3. It transcribes the voice notes locally with [faster-whisper](https://github.com/SYSTRAN/faster-whisper). The audio does not leave your machine for transcription.
4. It finds the bugs and the feature requests, marks the ones that the chat says are already solved, and searches Jira for duplicates.
5. It proposes labels from the set that your Jira project already uses. If your source code is on the machine, it finds the code of each problem to choose the labels.
6. It shows you a preview of each ticket. You choose the tickets and the project, and you can edit the text.
7. It creates the approved tickets and gives you the links.

## Before you use it

- The skill uses internal modules of WhatsApp Web. These modules are not a public API. WhatsApp can change them at any time, and the skill then stops working until you update one block of configuration (see Maintenance). Automated access can also conflict with the WhatsApp Terms of Service. You decide if this risk is acceptable for your account.
- The skill only reads. It does not send messages or change chats.
- Chat content goes into your Claude session, so Claude can analyze it. Use the skill only on conversations that you are allowed to process in this way.
- The skill tells Claude to keep the personal data of end customers out of tickets, and to delete the downloaded files after the run.

## Requirements

- [Claude Code](https://claude.com/claude-code).
- The [Claude in Chrome](https://claude.ai/chrome) extension, connected to Claude Code with the same account.
- WhatsApp Web open in that Chrome profile and linked to your phone.
- These Chrome download settings: "Ask where to save each file" is off. When Chrome asks if `web.whatsapp.com` can download multiple files, allow it.
- [uv](https://docs.astral.sh/uv/). The transcription script installs its own Python dependencies on the first run.
- The Atlassian MCP connector in Claude Code, with access to your Jira site.
- For fast transcription, an NVIDIA GPU. The script installs the CUDA libraries that it needs. Without a GPU, it uses the CPU, which is slower but works.

## Install

Clone the repository into your Claude Code skills folder:

```
git clone https://github.com/giovanni-orciuolo/whatsapp-to-jira.git ~/.claude/skills/whatsapp-to-jira
```

Open `SKILL.md` and set the values in the Settings section:

- Ticket language: the language of the tickets that Claude writes.
- Voice note language: an ISO code such as `it` or `en`. Leave it empty to let Whisper detect the language.

In Claude Code, run `/reload-skills` or start a new session.

The first transcription downloads the Whisper `large-v3-turbo` model (about 1.6 GB).

## Use it

Ask Claude in plain words, for example:

```
Read the messages from Anna Rossi since Monday and propose Jira tickets.
```

```
Check the "Acme support" group chat for the last two weeks. Skip the part about the invoices.
```

For better tickets, also install the `writing-whip`, `deslop` and `simple-english` skills. If they are installed, the skill applies their writing rules to the ticket text.

## Design

- `SKILL.md` contains the workflow that Claude follows.
- `scripts/wa.js` runs inside the WhatsApp Web page. Claude injects it. It reads the in-memory message store of the page and downloads files through Chrome.
- `scripts/transcribe.py` transcribes every audio file in a folder into `transcripts.json`.

The script reads the message store because the page is unreliable. WhatsApp Web only puts the messages near the visible area into the page, and Chrome stops drawing a tab when its window is behind other windows. The store has every loaded message and works when the tab is in the background. The browser tool returns only about 1,500 characters per call, so the script saves the messages and the media as files in your Downloads folder. Claude then reads them from the disk.

## Maintenance

When a WhatsApp update stops the skill, ask Claude to fix it. `scripts/wa.js` has a `probe()` function that reports the part that stopped working. All internal names are in the `CONFIG` block at the top of the file. The Maintenance section of `SKILL.md` gives Claude the steps to find the new names.

## Limits

- The skill sees only the history that WhatsApp Web has on the linked device. For older messages, scroll up in the chat on WhatsApp Web, or open the chat on the phone.
- The Jira connector cannot attach files to tickets. Claude gives you the local path of an important screenshot, so that you can attach it yourself.
- Whisper can make mistakes with names and product codes. Check the transcripts in the preview.

## License

[MIT](LICENSE)
