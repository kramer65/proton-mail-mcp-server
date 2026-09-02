import { convert } from "html-to-text";

// Characters that occupy no visual space but survive String.prototype.trim().
// Marketing mail routinely pads the text/plain part with these (combining
// grapheme joiners, soft hyphens, zero-width spaces) so that preview panes
// show a blank preheader. Such a part carries no content and must be treated
// as absent, otherwise the HTML fallback below never triggers.
const INVISIBLE_CHARS = new RegExp(
  "[" +
  "\\u00AD" +         // soft hyphen
  "\\u034F" +         // combining grapheme joiner
  "\\u061C" +         // arabic letter mark
  "\\u115F\\u1160" +  // hangul choseong/jungseong filler
  "\\u17B4\\u17B5" +  // khmer inherent vowels
  "\\u180B-\\u180E" + // mongolian variation selectors and vowel separator
  "\\u200B-\\u200F" + // zero width space .. right-to-left mark
  "\\u202A-\\u202E" + // bidi embedding and override controls
  "\\u2060-\\u2064" + // word joiner .. invisible plus
  "\\u206A-\\u206F" + // deprecated formatting controls
  "\\u3164" +         // hangul filler
  "\\uFEFF" +         // zero width no-break space / BOM
  "\\uFFA0" +         // halfwidth hangul filler
  "]",
  "gu"
);

// Some senders embed images directly in the HTML source as base64 payloads,
// which bloats the reported body without adding anything readable. (Inline
// images referenced with cid: are a separate matter: those are kept as cid:
// links by passing keepCidLinks to simpleParser, so they never become base64
// in the first place.) Payloads below this size are left alone -- they are
// typically small icons, and rewriting them costs more than it saves.
export const MIN_STRIPPED_DATA_URI_CHARS = 1024;

const BASE64_DATA_URI = /data:([a-z0-9.+-]+\/[a-z0-9.+-]+)?((?:;[a-z0-9-]+=[^;,]*)*);base64,([A-Za-z0-9+/=\s]+)/gi;

export const NO_BODY_NOTICE = "[no readable body: this message has neither a text/plain nor a text/html part]";
export const UNREADABLE_HTML_NOTICE = "[no readable body: the HTML part contained no extractable text (likely images only)]";

// True when `value` holds nothing a human could read.
export function isBlank(value) {
  if (typeof value !== "string" || value.length === 0) return true;
  return value.replace(INVISIBLE_CHARS, "").trim() === "";
}

// Replace oversized base64 payloads with a marker naming what was dropped.
// The surrounding markup is left untouched, so the HTML stays readable.
export function stripDataUris(html, { minChars = MIN_STRIPPED_DATA_URI_CHARS } = {}) {
  if (typeof html !== "string" || html.length === 0) return html;
  return html.replace(BASE64_DATA_URI, (match, mediaType, _params, payload) => {
    if (payload.length < minChars) return match;
    const bytes = Math.floor(payload.replace(/\s/g, "").length * 3 / 4);
    return `[inline data removed: ${mediaType || "unknown type"}, ${bytes} bytes]`;
  });
}

export function htmlToPlainText(html) {
  if (typeof html !== "string" || html.length === 0) return "";
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "a", options: { hideLinkHrefIfSameAsText: true } }
    ]
  }).trim();
}

// Pick the body to report for a message parsed by mailparser's simpleParser.
//
// mailparser derives `text` from the HTML itself, but only when the HTML part
// is the message root or has a text/plain sibling. Inside a multipart/related
// or multipart/mixed wrapper -- i.e. as soon as the message carries inline
// images or attachments -- it leaves `text` undefined and fills only `html`.
//
// Returns { text, html, bodySource } where bodySource is "plain", "html" or
// "none", so a caller can tell a genuinely empty message from a parse failure.
// The reported HTML is always the full document, with only oversized base64
// payloads replaced by a marker.
export function selectBody(parsed, options = {}) {
  const plain = typeof parsed?.text === "string" ? parsed.text : "";
  const rawHtml = typeof parsed?.html === "string" && parsed.html.length > 0 ? parsed.html : null;
  const html = rawHtml === null ? null : stripDataUris(rawHtml, options);

  if (!isBlank(plain)) {
    return { text: plain, html, bodySource: "plain" };
  }
  if (rawHtml !== null) {
    const converted = htmlToPlainText(rawHtml);
    if (!isBlank(converted)) {
      return { text: converted, html, bodySource: "html" };
    }
    return { text: UNREADABLE_HTML_NOTICE, html, bodySource: "none" };
  }
  return { text: NO_BODY_NOTICE, html: null, bodySource: "none" };
}
