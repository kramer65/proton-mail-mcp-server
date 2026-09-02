// Fixed MIME fixtures. These never touch a live mailbox: every test parses
// these strings directly. Addresses and content are synthetic.
const CRLF = "\r\n";
const join = (lines) => lines.join(CRLF);

// Written as escapes on purpose: as literal characters these are invisible in
// a diff and an editor stripping them would silently gut the test.
export const PREHEADER_PADDING =
  "\u034F\u034F\u034F \u00AD\u00AD \u200B \uFEFF  ";

const ONE_PX_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// A well-behaved newsletter: both a plain and an HTML alternative.
export const MULTIPART_ALTERNATIVE = join([
  "From: Afzender <afzender@example.org>",
  "To: Ontvanger <ontvanger@example.net>",
  "Subject: Bestelbevestiging",
  "MIME-Version: 1.0",
  'Content-Type: multipart/alternative; boundary="ALT"',
  "",
  "--ALT",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Je bestelling is bevestigd.",
  "",
  "--ALT",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<html><body><p>Je bestelling is <b>bevestigd</b>.</p></body></html>",
  "",
  "--ALT--",
  ""
]);

// Plain text only, no HTML alternative at all.
export const PLAIN_ONLY = join([
  "From: Afzender <afzender@example.org>",
  "Subject: Korte notitie",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Alleen platte tekst.",
  ""
]);

// A single text/html part as the message root, no attachments.
export const HTML_ONLY = join([
  "From: Afzender <afzender@example.org>",
  "Subject: Alleen HTML",
  "MIME-Version: 1.0",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<html><body><p>Hallo <b>wereld</b></p><a href="https://example.org">meer lezen</a></body></html>',
  ""
]);

// HTML plus an inline logo. This is the shape that regressed: mailparser
// leaves `text` undefined once the HTML sits inside a multipart wrapper.
export const HTML_WITH_INLINE_IMAGE = join([
  "From: Afzender <afzender@example.org>",
  "Subject: Afspraakbevestiging",
  "MIME-Version: 1.0",
  'Content-Type: multipart/related; boundary="REL"',
  "",
  "--REL",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<html><body><p>Je afspraak staat gepland op dinsdag.</p><img src="cid:logo"></body></html>',
  "",
  "--REL",
  "Content-Type: image/png",
  "Content-Transfer-Encoding: base64",
  "Content-ID: <logo>",
  'Content-Disposition: inline; filename="logo.png"',
  "",
  ONE_PX_PNG,
  "",
  "--REL--",
  ""
]);

// HTML plus a PDF attachment -- the invoice case.
export const HTML_WITH_PDF_ATTACHMENT = join([
  "From: Boekhouder <boekhouder@example.org>",
  "Subject: Factuur",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="MIX"',
  "",
  "--MIX",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<html><body><p>Bijgaand de factuur van deze maand.</p></body></html>",
  "",
  "--MIX",
  "Content-Type: application/pdf",
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="factuur.pdf"',
  "",
  "JVBERi0xLjQK",
  "",
  "--MIX--",
  ""
]);

// A text/plain part holding only preheader padding: combining grapheme
// joiners, soft hyphens, a zero-width space and a BOM. Visually empty.
export const PADDED_PLAIN_PART = join([
  "From: Marketing <marketing@example.org>",
  "Subject: Nieuwsbrief",
  "MIME-Version: 1.0",
  'Content-Type: multipart/alternative; boundary="ALT"',
  "",
  "--ALT",
  "Content-Type: text/plain; charset=utf-8",
  "",
  PREHEADER_PADDING,
  "",
  "--ALT",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<html><body><p>De echte inhoud staat alleen in de HTML.</p></body></html>",
  "",
  "--ALT--",
  ""
]);

// HTML that carries no text at all -- an image-only mail wrapped in
// multipart/related, so mailparser performs no conversion of its own.
export const HTML_WITHOUT_TEXT = join([
  "From: Afzender <afzender@example.org>",
  "Subject: Alleen een plaatje",
  "MIME-Version: 1.0",
  'Content-Type: multipart/related; boundary="REL"',
  "",
  "--REL",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<html><body><img src="cid:banner"></body></html>',
  "",
  "--REL",
  "Content-Type: image/png",
  "Content-Transfer-Encoding: base64",
  "Content-ID: <banner>",
  'Content-Disposition: inline; filename="banner.png"',
  "",
  ONE_PX_PNG,
  "",
  "--REL--",
  ""
]);

// A logo of realistic size, referenced with cid:. Parsed without
// keepCidLinks this whole payload ends up inside the HTML body.
const LARGE_PNG = "A".repeat(40 * 1024);

export const LARGE_INLINE_LOGO = join([
  "From: Nieuwsbrief <nieuws@example.org>",
  "Subject: Nieuwsbrief met logo",
  "MIME-Version: 1.0",
  'Content-Type: multipart/related; boundary="REL"',
  "",
  "--REL",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<html><body><img src="cid:logo"><p>Nieuws van deze maand.</p></body></html>',
  "",
  "--REL",
  "Content-Type: image/png",
  "Content-Transfer-Encoding: base64",
  "Content-ID: <logo>",
  'Content-Disposition: inline; filename="logo.png"',
  "",
  LARGE_PNG,
  "",
  "--REL--",
  ""
]);

// A sender that pasted the image straight into the HTML as a data URI, plus a
// tiny one that is not worth rewriting. keepCidLinks does not help here.
export const HTML_WITH_EMBEDDED_DATA_URI = join([
  "From: Afzender <afzender@example.org>",
  "Subject: Ingesloten afbeelding",
  "MIME-Version: 1.0",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<html><body><p>Bekijk de bijgevoegde grafiek.</p>" +
    '<img src="data:image/png;base64,' + "B".repeat(8 * 1024) + '">' +
    '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">' +
    "</body></html>",
  ""
]);

// No body parts whatsoever.
export const NO_BODY_AT_ALL = join([
  "From: Afzender <afzender@example.org>",
  "Subject: Leeg",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "",
  ""
]);
