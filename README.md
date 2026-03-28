# Proton Mail MCP Server for Claude Cowork

This project exposes a Proton Mail account to Claude Cowork through MCP. It
connects to Proton Mail Bridge over IMAP and SMTP, then serves a local MCP
server over `stdio` so Claude Desktop and Cowork can launch it on demand.
Within each MCP process, it reuses Bridge connections and idles them out
automatically so repeated tool calls do not reconnect on every request.

The checked-in `server.mjs` is the bundled working server that is currently
being used locally. That keeps the repo self-contained and avoids requiring a
separate build step before connecting it to Claude.

## Features

- List mailbox folders
- List recent emails in a folder
- Read full email content
- Search emails by sender, subject, body, date, and unread status
- Send new emails
- Reply to emails with proper threading headers
- Move messages between folders
- Mark messages read, unread, flagged, or unflagged
- Delete emails

## Files

- `server.mjs`: the bundled MCP server used by Claude

## Prerequisites

- Node.js 18+
- Proton Mail Bridge installed and logged in
- Claude Desktop / Claude Cowork with local MCP enabled

## Configure Proton Bridge credentials

The server reads credentials from environment variables or from:

`~/.proton-bridge-credentials`

Example:

```bash
PROTON_BRIDGE_USERNAME="your-email@proton.me"
PROTON_BRIDGE_PASSWORD="your-bridge-password"
PROTON_BRIDGE_HOST="127.0.0.1"
PROTON_BRIDGE_IMAP_PORT="1143"
PROTON_BRIDGE_SMTP_PORT="1025"
```

Only the username and password are required if you use Bridge's default local
ports.

## Connect it to Claude Cowork

Add this entry to:

`~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "proton-mail": {
      "command": "/opt/homebrew/bin/node",
      "args": [
        "/ABSOLUTE/PATH/TO/server.mjs"
      ]
    }
  }
}
```

If your Node binary is somewhere else, use the output of:

```bash
which node
```

Then fully restart Claude Desktop. Claude Cowork should discover the Proton
Mail tools on launch.

## Available tools

- `list_folders()`
- `list_emails(folder="INBOX", limit=20)`
- `read_email(uid, folder="INBOX")`
- `search_emails(folder="INBOX", from, subject, body, since, before, unseen, limit=20)`
- `send_email(to, subject, body, html, cc, bcc)`
- `reply_to_email(uid, folder="INBOX", body, html, replyAll=false)`
- `move_email(uid, sourceFolder="INBOX", destinationFolder)`
- `mark_email(uid, folder="INBOX", action)`
- `delete_email(uid, folder="INBOX")`

## Local smoke test

You can sanity check that the server starts:

```bash
node server.mjs
```

It will wait for MCP messages on standard input. Claude is the normal client,
so this is mainly useful to catch obvious config or credential errors.

## How it works

- Reads Bridge credentials from environment variables or `~/.proton-bridge-credentials`
- Uses IMAP via `imapflow` for listing, searching, reading, moving, flagging,
  and deleting mail
- Uses SMTP via `nodemailer` for sending and replying
- Reuses IMAP and SMTP connections inside each MCP process, with automatic idle
  cleanup and reconnect-once behavior for stale Bridge connections
- Uses `mailparser` when reading or replying so Claude gets structured message
  content

## Troubleshooting

If Claude does not show the tools:

- Verify the `command` and `args` paths in `claude_desktop_config.json`
- Restart Claude Desktop completely
- Make sure Proton Mail Bridge is running
- Make sure your Bridge credentials file exists and contains the Bridge password,
  not your main Proton account password

If email actions fail:

- Confirm Bridge is listening on IMAP `1143` and SMTP `1025`, or update the
  port variables in `~/.proton-bridge-credentials`
- Re-open Proton Mail Bridge if it was recently restarted
- Optionally tune `PROTON_BRIDGE_IDLE_TIMEOUT_MS` and
  `PROTON_BRIDGE_SMTP_IDLE_TIMEOUT_MS` if you want shorter or longer connection
  reuse windows

## Security notes

Do not commit:

- `~/.proton-bridge-credentials`
- exported logs with email contents
- any screenshots or dumps containing message bodies
