#!/usr/bin/env node
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { simpleParser } from "mailparser";
import { selectBody } from "./body.js";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
function loadConfig() {
  let username = process.env.PROTON_BRIDGE_USERNAME;
  let password = process.env.PROTON_BRIDGE_PASSWORD;
  if (!username || !password) {
    const configPath = join(homedir(), ".proton-bridge-credentials");
    try {
      const raw = readFileSync(configPath, "utf-8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (val.startsWith('"') && val.endsWith('"') || val.startsWith("'") && val.endsWith("'")) {
          val = val.slice(1, -1);
        }
        if (key === "PROTON_BRIDGE_USERNAME" && !username) username = val;
        if (key === "PROTON_BRIDGE_PASSWORD" && !password) password = val;
        if (key === "PROTON_BRIDGE_HOST") process.env.PROTON_BRIDGE_HOST = val;
        if (key === "PROTON_BRIDGE_IMAP_PORT") process.env.PROTON_BRIDGE_IMAP_PORT = val;
        if (key === "PROTON_BRIDGE_SMTP_PORT") process.env.PROTON_BRIDGE_SMTP_PORT = val;
        if (key === "PROTON_BRIDGE_SMTP_SECURE") process.env.PROTON_BRIDGE_SMTP_SECURE = val;
        if (key === "PROTON_BRIDGE_ALLOW_SEND") process.env.PROTON_BRIDGE_ALLOW_SEND = val;
      }
    } catch {
    }
  }
  return { username, password };
}
var creds = loadConfig();
var CONFIG = {
  host: process.env.PROTON_BRIDGE_HOST || "127.0.0.1",
  imapPort: parseInt(process.env.PROTON_BRIDGE_IMAP_PORT || "1143", 10),
  smtpPort: parseInt(process.env.PROTON_BRIDGE_SMTP_PORT || "1025", 10),
  smtpSecure: /^(1|true|yes)$/i.test(process.env.PROTON_BRIDGE_SMTP_SECURE || ""),
  username: creds.username,
  password: creds.password
};
if (!CONFIG.username || !CONFIG.password) {
  console.error(
    "Error: Proton Bridge credentials not found.\nEither set PROTON_BRIDGE_USERNAME and PROTON_BRIDGE_PASSWORD environment variables,\nor create ~/.proton-bridge-credentials with:\n\n  PROTON_BRIDGE_USERNAME=your-email@proton.me\n  PROTON_BRIDGE_PASSWORD=your-bridge-password\n"
  );
  process.exit(1);
}
var ALLOW_SEND = /^(1|true|yes)$/i.test(process.env.PROTON_BRIDGE_ALLOW_SEND || "");
var IMAP_IDLE_TIMEOUT_MS = parseInt(process.env.PROTON_BRIDGE_IDLE_TIMEOUT_MS || "300000", 10);
var SMTP_IDLE_TIMEOUT_MS = parseInt(process.env.PROTON_BRIDGE_SMTP_IDLE_TIMEOUT_MS || "120000", 10);
var imapClient = null;
var imapClientPromise = null;
var imapIdleTimer = null;
var smtpTransport = null;
var smtpIdleTimer = null;
function clearIdleTimer(timer) {
  if (timer) {
    clearTimeout(timer);
  }
}
function unrefTimer(timer) {
  if (timer && typeof timer.unref === "function") {
    timer.unref();
  }
}
function isLoopbackHost(host) {
  const h = (host || "").toLowerCase();
  return h === "localhost" || h === "::1" || h.startsWith("127.");
}
function createImapClient() {
  const client = new ImapFlow({
    host: CONFIG.host,
    port: CONFIG.imapPort,
    secure: false,
    auth: {
      user: CONFIG.username,
      pass: CONFIG.password
    },
    tls: {
      // Bridge uses a self-signed cert; only skip validation for local Bridge
      rejectUnauthorized: !isLoopbackHost(CONFIG.host)
    },
    logger: false
  });
  client.on("close", () => {
    if (imapClient === client) {
      imapClient = null;
      imapClientPromise = null;
    }
  });
  return client;
}
function isRetryableImapError(error) {
  const message = `${error?.message || error || ""}`;
  return /not connected|connection.*closed|socket.*closed|socket.*destroyed|timed out|ECONNRESET|EPIPE|User is authenticated but not connected/i.test(message);
}
function scheduleImapDisconnect() {
  clearIdleTimer(imapIdleTimer);
  imapIdleTimer = null;
  if (!imapClient || !(IMAP_IDLE_TIMEOUT_MS > 0)) {
    return;
  }
  const client = imapClient;
  imapIdleTimer = setTimeout(async () => {
    if (imapClient !== client) {
      return;
    }
    imapClient = null;
    imapClientPromise = null;
    try {
      if (client.usable) {
        await client.logout();
      } else {
        client.close();
      }
    } catch {
      try {
        client.close();
      } catch {
      }
    }
  }, IMAP_IDLE_TIMEOUT_MS);
  unrefTimer(imapIdleTimer);
}
function resetImapClient(client = imapClient) {
  clearIdleTimer(imapIdleTimer);
  imapIdleTimer = null;
  if (client && imapClient === client) {
    imapClient = null;
  }
  imapClientPromise = null;
  if (!client) {
    return;
  }
  try {
    if (client.usable) {
      client.logout().catch(() => client.close());
    } else {
      client.close();
    }
  } catch {
  }
}
async function getImapClient() {
  clearIdleTimer(imapIdleTimer);
  imapIdleTimer = null;
  if (imapClient?.usable) {
    return imapClient;
  }
  if (!imapClientPromise) {
    imapClientPromise = (async () => {
      const client = createImapClient();
      try {
        await client.connect();
        imapClient = client;
        return client;
      } catch (error) {
        if (imapClient === client) {
          imapClient = null;
        }
        throw error;
      } finally {
        imapClientPromise = null;
      }
    })();
  }
  return await imapClientPromise;
}
async function withImapClient(operation) {
  const client = await getImapClient();
  try {
    const result = await operation(client);
    scheduleImapDisconnect();
    return result;
  } catch (error) {
    if (client.usable && !isRetryableImapError(error)) {
      scheduleImapDisconnect();
      throw error;
    }
    resetImapClient(client);
    const retryClient = await getImapClient();
    try {
      const result = await operation(retryClient);
      scheduleImapDisconnect();
      return result;
    } catch (retryError) {
      if (!retryClient.usable || isRetryableImapError(retryError)) {
        resetImapClient(retryClient);
      } else {
        scheduleImapDisconnect();
      }
      throw retryError;
    }
  }
}
function formatAddress(addr) {
  if (!addr) return "";
  if (typeof addr === "string") return addr;
  if (addr.text) return addr.text;
  if (Array.isArray(addr.value)) {
    return addr.value.map((a) => a.name ? `${a.name} <${a.address}>` : a.address).join(", ");
  }
  return addr.address || "";
}
function formatRecipient(addr) {
  if (!addr.name) return addr.address;
  const quotedName = `"${addr.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return `${quotedName} <${addr.address}>`;
}
function buildRawMessage(mailOptions) {
  return new Promise((resolve, reject) => {
    new MailComposer(mailOptions).compile().build((err, message) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}
async function fetchParsedMessage(uid, folder) {
  return await withImapClient(async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const rawMessage = await client.fetchOne(`${uid}`, {
        source: true,
        uid: true
      }, { uid: true });
      return await simpleParser(rawMessage.source);
    } finally {
      lock.release();
    }
  });
}
function buildReplyMailOptions(original, body, html, replyAll) {
  const fromAddresses = original.from?.value || [];
  const replyTo = fromAddresses.length > 0 ? fromAddresses.map(formatRecipient).join(", ") : formatAddress(original.from);
  let recipients = replyTo;
  if (replyAll) {
    const seen = new Set(fromAddresses.map((a) => (a.address || "").toLowerCase()));
    seen.add((CONFIG.username || "").toLowerCase());
    const allAddresses = [
      ...original.to?.value || [],
      ...original.cc?.value || []
    ].filter((a) => {
      const bare = (a.address || "").toLowerCase();
      if (!bare || seen.has(bare)) return false;
      seen.add(bare);
      return true;
    });
    if (allAddresses.length > 0) {
      recipients = [replyTo, ...allAddresses.map(formatRecipient)].join(", ");
    }
  }
  const subjectLine = original.subject?.startsWith("Re:") ? original.subject : `Re: ${original.subject || ""}`;
  const references = [
    original.references,
    original.messageId
  ].flat().filter(Boolean).join(" ");
  const mailOptions = {
    from: CONFIG.username,
    to: recipients,
    subject: subjectLine,
    text: body,
    inReplyTo: original.messageId,
    references: references || void 0
  };
  if (html) mailOptions.html = html;
  return mailOptions;
}
async function saveDraft(mailOptions) {
  const raw = await buildRawMessage(mailOptions);
  return await withImapClient(async (client) => {
    const draftsPath = await findSpecialUsePath(client, "\\Drafts", "Drafts");
    const appended = await client.append(draftsPath, raw, ["\\Draft", "\\Seen"]);
    return { folder: draftsPath, uid: appended?.uid ?? null };
  });
}
function createSmtpTransport() {
  return nodemailer.createTransport({
    host: CONFIG.host,
    port: CONFIG.smtpPort,
    // Proton Bridge defaults to STARTTLS on 1025; set PROTON_BRIDGE_SMTP_SECURE=true for implicit TLS
    secure: CONFIG.smtpSecure,
    requireTLS: !CONFIG.smtpSecure,
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
    auth: {
      user: CONFIG.username,
      pass: CONFIG.password
    },
    tls: {
      // Bridge uses a self-signed cert; only skip validation for local Bridge
      rejectUnauthorized: !isLoopbackHost(CONFIG.host)
    }
  });
}
function isRetryableSmtpError(error) {
  const message = `${error?.message || error || ""}`;
  return /connection.*closed|socket.*closed|timed out|ECONNRESET|EPIPE|greeting never received/i.test(message);
}
function scheduleSmtpClose() {
  clearIdleTimer(smtpIdleTimer);
  smtpIdleTimer = null;
  if (!smtpTransport || !(SMTP_IDLE_TIMEOUT_MS > 0)) {
    return;
  }
  const transport2 = smtpTransport;
  smtpIdleTimer = setTimeout(() => {
    if (smtpTransport !== transport2) {
      return;
    }
    smtpTransport = null;
    try {
      transport2.close();
    } catch {
    }
  }, SMTP_IDLE_TIMEOUT_MS);
  unrefTimer(smtpIdleTimer);
}
function resetSmtpTransport() {
  clearIdleTimer(smtpIdleTimer);
  smtpIdleTimer = null;
  if (!smtpTransport) {
    return;
  }
  const transport2 = smtpTransport;
  smtpTransport = null;
  try {
    transport2.close();
  } catch {
  }
}
function getSmtpTransport() {
  clearIdleTimer(smtpIdleTimer);
  smtpIdleTimer = null;
  if (!smtpTransport) {
    smtpTransport = createSmtpTransport();
  }
  return smtpTransport;
}
async function sendMail(mailOptions) {
  const transport2 = getSmtpTransport();
  try {
    const info = await transport2.sendMail(mailOptions);
    scheduleSmtpClose();
    return info;
  } catch (error) {
    if (!isRetryableSmtpError(error)) {
      scheduleSmtpClose();
      throw error;
    }
    resetSmtpTransport();
    const retryTransport = getSmtpTransport();
    try {
      const info = await retryTransport.sendMail(mailOptions);
      scheduleSmtpClose();
      return info;
    } catch (retryError) {
      if (isRetryableSmtpError(retryError)) {
        resetSmtpTransport();
      } else {
        scheduleSmtpClose();
      }
      throw retryError;
    }
  }
}
async function shutdownResources() {
  clearIdleTimer(imapIdleTimer);
  clearIdleTimer(smtpIdleTimer);
  imapIdleTimer = null;
  smtpIdleTimer = null;
  const pendingClientPromise = imapClientPromise;
  let client = imapClient;
  imapClient = null;
  imapClientPromise = null;
  if (!client && pendingClientPromise) {
    try {
      client = await pendingClientPromise;
    } catch {
    }
  }
  if (client) {
    try {
      if (client.usable) {
        await client.logout();
      } else {
        client.close();
      }
    } catch {
      try {
        client.close();
      } catch {
      }
    }
  }
  resetSmtpTransport();
}
var shutdownStarted = false;
async function shutdown(exitCode) {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;
  // Ensure we exit even if a close call hangs on a dead connection
  const forceExitTimer = setTimeout(() => process.exit(exitCode), 1500);
  unrefTimer(forceExitTimer);
  try {
    await shutdownResources();
    try {
      if (typeof server?.close === "function") {
        await server.close();
      }
    } catch {
    }
  } finally {
    clearIdleTimer(forceExitTimer);
  }
  process.exit(exitCode);
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void shutdown(0);
  });
}
process.stdin.once("end", () => {
  void shutdown(0);
});
process.stdin.once("close", () => {
  void shutdown(0);
});
process.once("uncaughtException", (error) => {
  console.error(error);
  void shutdown(1);
});
process.once("unhandledRejection", (error) => {
  console.error(error);
  void shutdown(1);
});
process.once("exit", () => {
  clearIdleTimer(imapIdleTimer);
  clearIdleTimer(smtpIdleTimer);
  try {
    imapClient?.close();
  } catch {
  }
  try {
    smtpTransport?.close();
  } catch {
  }
});
var server = new McpServer({
  name: "proton-mail",
  version: "0.1.0"
});
server.tool(
  "list_folders",
  "List all mailbox folders (INBOX, Sent, Drafts, Trash, etc.)",
  {},
  async () => withImapClient(async (client) => {
      let walk = function(items, prefix = "") {
        for (const item of items) {
          folders.push({
            name: item.name,
            path: item.path,
            specialUse: item.specialUse || null
          });
          if (item.folders && item.folders.length > 0) {
            walk(item.folders, item.path + "/");
          }
        }
      };
      const folders = [];
      const tree = await client.listTree();
      walk(tree.folders || []);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(folders, null, 2)
          }
        ]
      };
    })
);
server.tool(
  "list_emails",
  "List recent emails from a folder. Returns subject, from, date, and UID for each message.",
  {
    folder: z.string().default("INBOX").describe("Folder path (e.g. INBOX, Sent, Drafts)"),
    limit: z.number().default(20).describe("Maximum number of emails to return (default 20, max 50)")
  },
  async ({ folder, limit }) => withImapClient(async (client) => {
      const effectiveLimit = Math.min(limit || 20, 50);
      const lock = await client.getMailboxLock(folder);
      try {
        const messages = [];
        const status = client.mailbox;
        const total = status.exists || 0;
        if (total === 0) {
          return {
            content: [{ type: "text", text: `No emails in ${folder}.` }]
          };
        }
        const startSeq = Math.max(1, total - effectiveLimit + 1);
        const range = `${startSeq}:*`;
        for await (const msg of client.fetch(range, {
          envelope: true,
          uid: true,
          flags: true
        })) {
          messages.push({
            uid: msg.uid,
            subject: msg.envelope.subject || "(no subject)",
            from: formatAddress(msg.envelope.from?.[0]),
            date: msg.envelope.date?.toISOString() || null,
            flags: [...msg.flags || []]
          });
        }
        messages.reverse();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { folder, total, showing: messages.length, messages },
                null,
                2
              )
            }
          ]
        };
      } finally {
        lock.release();
      }
    })
);
server.tool(
  "read_email",
  "Read the full content of a specific email by its UID. Returns headers, the body as plain text, the raw HTML body when the message has one, and attachment names. The plain text comes from the message's text/plain part; when that part is missing or holds only invisible padding, it is derived from the text/html part instead. The bodySource field reports which was used ('plain', 'html', or 'none'), so an empty message is distinguishable from a parsing failure. The html field carries the raw HTML for clients that prefer to render it themselves, or null when the message has no HTML part. Inline images stay as cid: references that match the listed attachments rather than being expanded into the HTML, and any oversized base64 payload embedded by the sender is replaced by a marker naming what was dropped.",
  {
    uid: z.number().describe("The UID of the email to read"),
    folder: z.string().default("INBOX").describe("Folder the email is in (default: INBOX)")
  },
  async ({ uid, folder }) => withImapClient(async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const rawMessage = await client.fetchOne(`${uid}`, {
          source: true,
          uid: true
        }, { uid: true });
        // keepCidLinks stops mailparser from inlining every referenced
        // attachment into the HTML as a base64 data URI, which would bloat the
        // response. The cid: values line up with the attachments listed below.
        const parsed = await simpleParser(rawMessage.source, { keepCidLinks: true });
        const body = selectBody(parsed);
        const result = {
          uid,
          subject: parsed.subject || "(no subject)",
          from: formatAddress(parsed.from),
          to: formatAddress(parsed.to),
          cc: formatAddress(parsed.cc),
          date: parsed.date?.toISOString() || null,
          messageId: parsed.messageId || null,
          inReplyTo: parsed.inReplyTo || null,
          text: body.text,
          html: body.html,
          bodySource: body.bodySource,
          attachments: (parsed.attachments || []).map((a) => ({
            filename: a.filename,
            contentType: a.contentType,
            size: a.size
          }))
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      } finally {
        lock.release();
      }
    })
);
server.tool(
  "search_emails",
  "Search emails by subject, sender, body text, date range, or flags. Returns matching message summaries.",
  {
    folder: z.string().default("INBOX").describe("Folder to search in"),
    from: z.string().optional().describe("Filter by sender address or name"),
    subject: z.string().optional().describe("Filter by subject text"),
    body: z.string().optional().describe("Filter by body text content"),
    since: z.string().optional().describe("Emails since this date (YYYY-MM-DD)"),
    before: z.string().optional().describe("Emails before this date (YYYY-MM-DD)"),
    unseen: z.boolean().optional().describe("Only return unread emails (default: false)"),
    limit: z.number().default(20).describe("Max results (default 20, max 50)")
  },
  async ({ folder, from, subject, body, since, before, unseen, limit }) => withImapClient(async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const searchCriteria = {};
        if (from) searchCriteria.from = from;
        if (subject) searchCriteria.subject = subject;
        if (body) searchCriteria.body = body;
        if (since) searchCriteria.since = new Date(since);
        if (before) searchCriteria.before = new Date(before);
        if (unseen) searchCriteria.seen = false;
        const uids = await client.search(searchCriteria, { uid: true });
        if (!uids || uids.length === 0) {
          return {
            content: [
              { type: "text", text: "No emails matched the search criteria." }
            ]
          };
        }
        const effectiveLimit = Math.min(limit || 20, 50);
        const targetUids = uids.slice(-effectiveLimit);
        const uidRange = targetUids.join(",");
        const messages = [];
        for await (const msg of client.fetch(uidRange, {
          envelope: true,
          uid: true,
          flags: true
        }, { uid: true })) {
          messages.push({
            uid: msg.uid,
            subject: msg.envelope.subject || "(no subject)",
            from: formatAddress(msg.envelope.from?.[0]),
            date: msg.envelope.date?.toISOString() || null,
            flags: [...msg.flags || []]
          });
        }
        messages.reverse();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { folder, totalMatches: uids.length, showing: messages.length, messages },
                null,
                2
              )
            }
          ]
        };
      } finally {
        lock.release();
      }
    })
);
server.tool(
  "create_draft",
  "Create a draft email in the Drafts folder. Nothing is sent; the user reviews and sends it from their own mail client.",
  {
    to: z.string().describe("Recipient email address(es), comma-separated"),
    subject: z.string().describe("Email subject line"),
    body: z.string().describe("Email body (plain text)"),
    html: z.string().optional().describe("Optional HTML version of the body"),
    cc: z.string().optional().describe("CC recipients, comma-separated"),
    bcc: z.string().optional().describe("BCC recipients, comma-separated")
  },
  async ({ to, subject, body, html, cc, bcc }) => {
    const mailOptions = {
      from: CONFIG.username,
      to,
      subject,
      text: body
    };
    if (html) mailOptions.html = html;
    if (cc) mailOptions.cc = cc;
    if (bcc) mailOptions.bcc = bcc;
    const draft = await saveDraft(mailOptions);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              draft: true,
              savedTo: draft.folder,
              uid: draft.uid,
              to,
              subject
            },
            null,
            2
          )
        }
      ]
    };
  }
);
server.tool(
  "create_reply_draft",
  "Create a reply to an existing email as a draft in the Drafts folder, with proper threading headers (In-Reply-To, References). Nothing is sent; the user reviews and sends it from their own mail client.",
  {
    uid: z.number().describe("UID of the email to reply to"),
    folder: z.string().default("INBOX").describe("Folder the original email is in"),
    body: z.string().describe("Reply body (plain text)"),
    html: z.string().optional().describe("Optional HTML version of the reply"),
    replyAll: z.boolean().default(false).describe("Reply to all recipients (default: false)")
  },
  async ({ uid, folder, body, html, replyAll }) => {
    const original = await fetchParsedMessage(uid, folder);
    const mailOptions = buildReplyMailOptions(original, body, html, replyAll);
    const draft = await saveDraft(mailOptions);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              draft: true,
              savedTo: draft.folder,
              uid: draft.uid,
              to: mailOptions.to,
              subject: mailOptions.subject,
              inReplyTo: original.messageId
            },
            null,
            2
          )
        }
      ]
    };
  }
);
if (ALLOW_SEND) {
  server.tool(
    "send_email",
    "Compose and send a new email. Supports plain text and HTML body, CC, BCC.",
    {
      to: z.string().describe("Recipient email address(es), comma-separated"),
      subject: z.string().describe("Email subject line"),
      body: z.string().describe("Email body (plain text)"),
      html: z.string().optional().describe("Optional HTML version of the body"),
      cc: z.string().optional().describe("CC recipients, comma-separated"),
      bcc: z.string().optional().describe("BCC recipients, comma-separated")
    },
    async ({ to, subject, body, html, cc, bcc }) => {
      const mailOptions = {
        from: CONFIG.username,
        to,
        subject,
        text: body
      };
      if (html) mailOptions.html = html;
      if (cc) mailOptions.cc = cc;
      if (bcc) mailOptions.bcc = bcc;
      const info = await sendMail(mailOptions);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                messageId: info.messageId,
                to,
                subject
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
  server.tool(
    "reply_to_email",
    "Reply to an existing email. Reads the original to set proper headers (In-Reply-To, References).",
    {
      uid: z.number().describe("UID of the email to reply to"),
      folder: z.string().default("INBOX").describe("Folder the original email is in"),
      body: z.string().describe("Reply body (plain text)"),
      html: z.string().optional().describe("Optional HTML version of the reply"),
      replyAll: z.boolean().default(false).describe("Reply to all recipients (default: false)")
    },
    async ({ uid, folder, body, html, replyAll }) => {
      const original = await fetchParsedMessage(uid, folder);
      const mailOptions = buildReplyMailOptions(original, body, html, replyAll);
      const info = await sendMail(mailOptions);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                messageId: info.messageId,
                to: mailOptions.to,
                subject: mailOptions.subject,
                inReplyTo: original.messageId
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}
server.tool(
  "move_email",
  "Move an email to a different folder (e.g., move to Trash, Archive).",
  {
    uid: z.number().describe("UID of the email to move"),
    sourceFolder: z.string().default("INBOX").describe("Current folder of the email"),
    destinationFolder: z.string().describe("Target folder (e.g. Trash, Archive, Folders/MyLabel)")
  },
  async ({ uid, sourceFolder, destinationFolder }) => withImapClient(async (client) => {
      const lock = await client.getMailboxLock(sourceFolder);
      try {
        await client.messageMove(`${uid}`, destinationFolder, { uid: true });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  uid,
                  from: sourceFolder,
                  to: destinationFolder
                },
                null,
                2
              )
            }
          ]
        };
      } finally {
        lock.release();
      }
    })
);
server.tool(
  "mark_email",
  "Mark an email as read/unread or flagged/unflagged.",
  {
    uid: z.number().describe("UID of the email"),
    folder: z.string().default("INBOX").describe("Folder the email is in"),
    action: z.enum(["read", "unread", "flag", "unflag"]).describe("Action to perform")
  },
  async ({ uid, folder, action }) => withImapClient(async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const flagMap = {
          read: { add: ["\\Seen"] },
          unread: { remove: ["\\Seen"] },
          flag: { add: ["\\Flagged"] },
          unflag: { remove: ["\\Flagged"] }
        };
        const { add, remove } = flagMap[action];
        if (add) {
          await client.messageFlagsAdd(`${uid}`, add, { uid: true });
        }
        if (remove) {
          await client.messageFlagsRemove(`${uid}`, remove, { uid: true });
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, uid, action }, null, 2)
            }
          ]
        };
      } finally {
        lock.release();
      }
    })
);
async function findSpecialUsePath(client, specialUse, fallback) {
  const tree = await client.listTree();
  const stack = [...tree.folders || []];
  while (stack.length > 0) {
    const item = stack.pop();
    if (item.specialUse === specialUse) {
      return item.path;
    }
    if (item.folders) {
      stack.push(...item.folders);
    }
  }
  return fallback;
}
server.tool(
  "delete_email",
  "Delete an email by moving it to the Trash folder.",
  {
    uid: z.number().describe("UID of the email to delete"),
    folder: z.string().default("INBOX").describe("Folder the email is in")
  },
  async ({ uid, folder }) => withImapClient(async (client) => {
      const trashPath = await findSpecialUsePath(client, "\\Trash", "Trash");
      const lock = await client.getMailboxLock(folder);
      try {
        await client.messageMove(`${uid}`, trashPath, { uid: true });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { success: true, uid, movedTo: trashPath },
                null,
                2
              )
            }
          ]
        };
      } finally {
        lock.release();
      }
    })
);
var transport = new StdioServerTransport();
await server.connect(transport);
server.server.onclose = () => {
  void shutdown(0);
};
