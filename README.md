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
- `read_email` inlines text attachments, parses calendar invites and extracts
  the text of PDF attachments, and `read_attachment` fetches images and other
  files, so the date of an appointment or the amount on an invoice are
  reachable instead of being hidden behind a filename (see
  [Attachments](#attachments))
- Reply-all no longer duplicates recipients, and no longer addresses the reply
  back to your own account
- Drafts keep their Bcc recipients. MailComposer drops the Bcc header by
  default, so a draft created with `bcc` used to arrive in Proton without it
- Messages can be referenced by `messageId` instead of `uid`, because UIDs in
  Bridge's All Mail folder are not stable across sessions (see
  [Referring to messages](#referring-to-messages))
- The server shuts down promptly when the MCP client disconnects, instead of
  leaving the process and its Bridge connections behind

## Features

- List mailbox folders
- List recent emails in a folder
- Read full email content
- Search emails by sender, subject, body, date, and unread status
- Create draft emails and reply drafts in the Drafts folder, with file
  attachments, for you to review and send yourself
- Update an existing draft in place of creating another one
- Optionally (off by default) send or reply directly via SMTP
- Move messages between folders
- Mark messages read, unread, flagged, or unflagged
- Delete emails (move to Trash)

## Prerequisites

- Node.js 22.13+ (pdf.js requires it)
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
- `list_emails(folder="INBOX", limit=20)` — each message with `uid`, `messageId` and `hasAttachments`
- `read_email(uid | messageId, folder="INBOX")` — see [Reading message bodies](#reading-message-bodies)
- `read_attachment(uid | messageId, folder="INBOX", index, filename)` — see [Attachments](#attachments)
- `search_emails(folder="INBOX", from, subject, body, since, before, unseen, limit=20)` — same fields as `list_emails`
- `create_draft(to, subject, body, html, cc, bcc, attachments)`
- `create_reply_draft(uid | messageId, folder="INBOX", body, html, replyAll=false, attachments)`
- `update_draft(uid | messageId, folder="Drafts", to, cc, bcc, subject, body, html, attachments, keepAttachments=true)` — see [Updating a draft](#updating-a-draft)
- `send_email(to, subject, body, html, cc, bcc, attachments)` — only with `PROTON_BRIDGE_ALLOW_SEND`
- `reply_to_email(uid | messageId, folder="INBOX", body, html, replyAll=false, attachments)` — only with `PROTON_BRIDGE_ALLOW_SEND`
- `move_email(uid | messageId, sourceFolder="INBOX", destinationFolder)`
- `mark_email(uid | messageId, folder="INBOX", action)`
- `delete_email(uid | messageId, folder="INBOX")`

`uid | messageId` means either one identifies the message; see
[Referring to messages](#referring-to-messages).

## Referring to messages

Every tool that acts on one message takes a `uid`, a `messageId`, or both.
`messageId` is the message's `Message-ID` header including the angle
brackets, as returned by `list_emails`, `search_emails` and `read_email`.

Prefer `messageId` in Bridge's `All Mail` folder. That folder is virtual, and
its UIDs are not stable across sessions: a UID remembered from an earlier
search can later point at a different message, and a reply draft then ends up
answering the wrong mail. A `messageId` is looked up in the given folder on
every call (an IMAP header search, confirmed against the exact value), so it
always reaches the same message. When both are given they must refer to the
same message, or the call is refused. When one `Message-ID` occurs more than
once in a folder, pass the `uid` as well to pick one.

## Attachments on drafts and outgoing mail

`create_draft`, `create_reply_draft`, `update_draft`, `send_email` and
`reply_to_email` take an optional `attachments` array:

```json
[
  { "path": "/home/me/Documents/invoice.pdf" },
  { "path": "~/export.csv", "filename": "transactions.csv", "contentType": "text/csv" }
]
```

- `path` is an absolute path on the machine running the server; `~` is
  expanded. `filename` defaults to the file's own name, `contentType` to the
  type matching its extension.
- Every path must be an existing regular file. If any one is not, the call
  fails with that path in the error and nothing is created.
- The total may not exceed 25 MB, about what Proton accepts per message. Above
  that the call fails and the error names the largest files. For
  `update_draft` the attachments the draft keeps count towards the total.
- Set `PROTON_BRIDGE_ATTACHMENT_ROOT` (in the environment or the credentials
  file) to only allow files below that directory. Symlinks are resolved before
  the check, so a link inside the root cannot reach a file outside it.
- The result lists what was attached as `attachments: [{ filename, size }]`.

Attaching to drafts always works; `send_email` and `reply_to_email`, and so
their attachments, exist only with `PROTON_BRIDGE_ALLOW_SEND`.

## Updating a draft

`update_draft` changes a draft instead of leaving a stale copy next to a new
one. Only the fields passed change; pass an empty string to clear `to`, `cc`
or `bcc`. Existing attachments are kept unless `keepAttachments` is `false`,
and new ones are added. Inline images stay as long as the HTML still refers
to them.

The two body parts are kept in step, since Proton keeps only one of them (the
HTML when there is one): a new `html` without a new `body` also rewrites the
plain-text part from it, and a new `body` without a new `html` turns the draft
into plain text rather than leave the old HTML in place.

IMAP has no way to edit a message, so the draft is stored anew and the old one
is removed afterwards; the result reports `oldUid` and `newUid`. If storing the
new draft fails, the old one is untouched. If removing the old one fails, the
call still succeeds and says so in `warning`, so a retry does not create yet
another copy. Only messages carrying the `\Draft` flag are replaced; received
mail is refused. Work in `Drafts` (the default) rather than `All Mail`, where a
freshly stored draft may not be visible yet.

### Threading of reply drafts

`create_reply_draft` writes `In-Reply-To` and `References` into the draft, and
`update_draft` carries them over. Whether Proton links the draft to the
message it answers depends on Proton Bridge. A stock Bridge creates a draft in
Proton from the subject, body, recipients, attachments and `Message-ID` only:
the threading headers are gone when the draft is read back, and Proton does
not link the draft to the original message. Bridge's own SMTP path does resolve the parent message; the
IMAP draft path does not.
[proton-bridge PR #526](https://github.com/ProtonMail/proton-bridge/pull/526)
fixes this by resolving the parent for IMAP drafts too. With a Bridge built
from that change, reply drafts keep both headers and appear in the original
conversation.

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

## Attachments

Appointment confirmations and invoices routinely carry their real content in
an attachment while the body holds boilerplate: a meeting invite's date lives
in a `text/calendar` part, a scanned invoice is an inline JPEG. `mailparser`
files everything that is not the text or HTML body under `attachments`,
including calendar parts, which it lists without a filename.

`read_email` describes every attachment with `index`, `filename`,
`contentType`, `size`, `disposition` and `cid`. Three kinds carry more:

- Text attachments (`text/*` and `application/ics`) up to 64 kB include
  their decoded `content`, using the part's own charset. Larger ones list a
  `note` pointing at `read_attachment` instead.
- Calendar parts (`text/calendar`, `application/ics`) also include a parsed
  `calendar` object: the `method` (`REQUEST`, `CANCEL`, ...) and one entry
  per event with `summary`, `start`, `end`, `timezone`, `allDay`,
  `location`, `organizer`, `attendees`, `status`, `recurrence`,
  `description` and `uid`. Times are reported as written in the invite with
  their `TZID`, or with a trailing `Z` and timezone `UTC`; nothing is
  converted. Folded lines, escaped text and quoted parameters are handled;
  `VTIMEZONE` and `VALARM` are skipped.
- PDF attachments up to 8 MB include the text of their text layer in
  `content` (up to 64 kB, page by page, table rows kept on one line), plus
  `pages` and `pdfInfo` (title, author, producer, dates when present). A
  scanned PDF has no text layer; it is listed with a `note` saying so rather
  than with empty content. A PDF that cannot be parsed, or is password
  protected, likewise gets a `note` and never fails the whole call.

`read_attachment` fetches one attachment by `index` (as listed by
`read_email`) or `filename` (case-insensitive). What comes back depends on
the type:

| Type | Returned as | Limit |
| --- | --- | --- |
| `text/*`, `.ics` | decoded text, plus `calendar` for invites | 1 MB, truncated beyond that |
| `application/pdf` | the text layer, page by page, with `pages` and `pdfInfo` | 8 MB file, 1 MB of text, first 50 pages |
| `image/*` | an MCP image content block the model can look at | 4 MB |
| anything else | base64 in `contentBase64` | 1 MB |

Above the limit the response carries the metadata and a `note` instead. A
PDF's own bytes are never returned, since base64 of a PDF is of no use to a
model; the text layer is what it needs.

PDF text comes from [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`),
loaded on first use. Only the text layer is read. Rendering pages to images,
which is what reading a scanned PDF would take, needs pdf.js's optional native
canvas package; that is a 30 MB platform-specific binary and is deliberately
left out via `omit=optional` in `.npmrc`. pdf.js 6 requires Node 22.13 or
newer, which is why `engines` says so.

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
  sync to Proton via Bridge; updating a draft stores a new one and then
  removes the old one
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
