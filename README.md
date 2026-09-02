# Proton Mail MCP Server

An MCP server that exposes a Proton Mail account to MCP clients such as
Claude Desktop and Claude Code. It connects to a locally running
[Proton Mail Bridge](https://proton.me/mail/bridge) over IMAP and SMTP and
serves the MCP protocol over `stdio`. Within each server process it reuses
Bridge connections and idles them out automatically, so repeated tool calls
do not reconnect on every request.

## About this fork

This is a fork of
[tamlut-modnys/proton-mail-mcp-server](https://github.com/tamlut-modnys/proton-mail-mcp-server)
(as of upstream commit `a849adf`). Upstream ships only `server.mjs`, an
esbuild bundle of ~97,500 lines with all dependencies vendored in and no
separate source. This fork reconstructs readable source: the application code
was extracted verbatim from the tail of the upstream bundle into `server.js`,
the bundler shims were translated back to regular ESM imports, and the
dependencies are installed from npm with exact-pinned versions instead of
being vendored.

Upstream does not declare a license; attribution for the original code lies
with the original author (tamlut-modnys). Upstream `main` has not moved since
March 2026, so these changes are not offered back and live only here.

### Changes in this fork

Packaging:

- Readable source extracted from the upstream bundle into `server.js`, with
  the bundler shims rewritten as regular ESM imports
- Dependencies installed from npm at exact-pinned versions rather than vendored
- A test suite (`npm test`) running against fixed MIME fixtures, requiring no
  Bridge connection and no credentials

Security and safety:

- TLS certificates are validated for non-loopback hosts; validation is skipped
  only for a local Bridge with its self-signed certificate
- SMTP connection security is configurable (`PROTON_BRIDGE_SMTP_SECURE`)
  instead of being hard-wired
- Sending is off by default: the server creates drafts for review, and
  `send_email` and `reply_to_email` are exposed only with
  `PROTON_BRIDGE_ALLOW_SEND`
- Deleting moves a message to Trash rather than expunging it irreversibly

Correctness:

- `read_email` falls back to the HTML part when a message has no usable
  text/plain part, and reports which part it used (see below). Upstream
  returns an empty body for these messages
- `read_email` no longer expands inline images into base64 inside the returned
  HTML, which kept a message's body needlessly large
- Reply-all no longer duplicates recipients, and no longer addresses the reply
  back to your own account
- The server shuts down promptly when the MCP client disconnects, instead of
  leaving the process and its Bridge connections behind

## Features

- List mailbox folders
- List recent emails in a folder
- Read full email content
- Search emails by sender, subject, body, date, and unread status
- Create draft emails (and reply drafts with proper threading headers) in the
  Drafts folder for you to review and send yourself
- Optionally (off by default) send or reply directly via SMTP
- Move messages between folders
- Mark messages read, unread, flagged, or unflagged
- Delete emails (move to Trash)

## Prerequisites

- Node.js 18+
- Proton Mail Bridge installed and logged in
- An MCP client (e.g. Claude Desktop or Claude Code)

## Installation

```bash
git clone <this repo>
cd proton-mail-mcp-server
npm ci
```

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
ports. The password is the Bridge password shown in the Proton Mail Bridge
app, not your Proton account password.

By default the server connects to SMTP with STARTTLS (and requires the
upgrade to succeed), which matches Proton Bridge's default security setting.
If you switched Bridge's SMTP connection mode to SSL (implicit TLS), set
`PROTON_BRIDGE_SMTP_SECURE="true"` (in the environment or in the credentials
file).

## Sending is disabled by default

Out of the box this server cannot send email. The `send_email` and
`reply_to_email` tools are only registered when you explicitly set
`PROTON_BRIDGE_ALLOW_SEND="true"` (in the environment or in the credentials
file); without it, the MCP client does not even see them. Instead, the
`create_draft` and `create_reply_draft` tools save a message to your Drafts
folder over IMAP. Bridge syncs it to Proton, so it shows up in your regular
mail clients where you can review, edit, and send it yourself.

## Connect it to an MCP client

For Claude Desktop, add this entry to `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/`, Linux: `~/.config/Claude/`):

```json
{
  "mcpServers": {
    "proton-mail": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/server.js"
      ]
    }
  }
}
```

If `node` is not on the client's PATH, use the absolute path from
`which node`. Then fully restart the client; it should discover the Proton
Mail tools on launch.

## Available tools

- `list_folders()`
- `list_emails(folder="INBOX", limit=20)`
- `read_email(uid, folder="INBOX")` — see [Reading message bodies](#reading-message-bodies)
- `search_emails(folder="INBOX", from, subject, body, since, before, unseen, limit=20)`
- `create_draft(to, subject, body, html, cc, bcc)`
- `create_reply_draft(uid, folder="INBOX", body, html, replyAll=false)`
- `send_email(to, subject, body, html, cc, bcc)` — only with `PROTON_BRIDGE_ALLOW_SEND`
- `reply_to_email(uid, folder="INBOX", body, html, replyAll=false)` — only with `PROTON_BRIDGE_ALLOW_SEND`
- `move_email(uid, sourceFolder="INBOX", destinationFolder)`
- `mark_email(uid, folder="INBOX", action)`
- `delete_email(uid, folder="INBOX")`

## Reading message bodies

`read_email` returns the body as three fields:

| Field | Meaning |
| --- | --- |
| `text` | The body as plain text |
| `html` | The raw HTML body, or `null` if the message has none |
| `bodySource` | `"plain"`, `"html"` or `"none"` — where `text` came from |

`text` is taken from the message's `text/plain` part when it has one. When
that part is missing, or contains only whitespace and invisible padding
(bulk mail often fills it with combining grapheme joiners and soft hyphens to
blank out the preview line), the text is derived from the `text/html` part
instead and `bodySource` reports `"html"`.

This matters for any message whose HTML sits inside a `multipart/related` or
`multipart/mixed` wrapper — that is, any message with inline images or
attachments. `mailparser` performs no HTML-to-text conversion of its own in
that case, which is why such messages previously came back with an empty body.

If nothing readable can be found, `text` holds an explicit notice and
`bodySource` is `"none"`, so a genuinely empty message is distinguishable from
a parsing failure.

`html` is the raw HTML, for clients that prefer to render it themselves. It is
kept small enough to be worth reading:

- Inline images stay as `cid:` references instead of being expanded into base64
  `data:` URIs. `mailparser` inlines them by default, which turns a newsletter
  with a 40 kB logo into 55 kB of HTML that is almost entirely base64; passing
  `keepCidLinks` leaves the reference in place, and the `cid:` value matches an
  entry in the `attachments` list, so the image is still reachable.
- Base64 `data:` URIs that the sender embedded in the HTML source are replaced
  by a `[inline data removed: image/png, 40960 bytes]` marker once the payload
  exceeds 1 kB. Smaller ones, typically icons, are left alone. The surrounding
  markup is untouched.

Neither affects `text`, which is always derived from the full HTML.

## Local smoke test

You can sanity check that the server starts:

```bash
node server.js
```

It will wait for MCP messages on standard input. An MCP client is the normal
consumer, so this is mainly useful to catch obvious config or credential
errors.

## How it works

- Reads Bridge credentials from environment variables or `~/.proton-bridge-credentials`
- Uses IMAP via `imapflow` for listing, searching, reading, moving, flagging,
  and deleting mail
- Saves drafts over IMAP (composed with `nodemailer`'s MailComposer) so they
  sync to Proton via Bridge
- Uses SMTP via `nodemailer` for sending and replying (only when
  `PROTON_BRIDGE_ALLOW_SEND` is enabled)
- Reuses IMAP and SMTP connections inside each MCP process, with automatic idle
  cleanup and reconnect-once behavior for stale Bridge connections
- Uses `mailparser` when reading or replying so the client gets structured
  message content

## Troubleshooting

If your MCP client does not show the tools:

- Verify the `command` and `args` paths in the client's MCP configuration
- Restart the client completely
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
