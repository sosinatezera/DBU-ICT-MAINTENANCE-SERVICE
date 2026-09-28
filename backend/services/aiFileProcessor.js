const AdmZip = require("adm-zip");
const ExcelJS = require("exceljs");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const { XMLParser } = require("fast-xml-parser");

const MAX_FILE_COUNT = 5;
const MAX_EXTRACTED_CHARS = 120000;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 30 * 1024 * 1024;
const MAX_XML_TEXT = 120000;

const EXTENSION_TYPES = Object.freeze({
  pdf: ["application/pdf"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  txt: ["text/plain", "application/octet-stream"],
  md: ["text/markdown", "text/plain", "application/octet-stream"],
  csv: ["text/csv", "text/plain", "application/octet-stream"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  pptx: [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  webp: ["image/webp"],
  json: ["application/json", "text/plain", "application/octet-stream"],
  xml: [
    "application/xml",
    "text/xml",
    "text/plain",
    "application/octet-stream",
  ],
  yaml: [
    "application/yaml",
    "text/yaml",
    "text/plain",
    "application/octet-stream",
  ],
  yml: [
    "application/yaml",
    "text/yaml",
    "text/plain",
    "application/octet-stream",
  ],
  html: ["text/html", "text/plain", "application/octet-stream"],
  htm: ["text/html", "text/plain", "application/octet-stream"],
  css: ["text/css", "text/plain", "application/octet-stream"],
  js: [
    "text/javascript",
    "application/javascript",
    "text/plain",
    "application/octet-stream",
  ],
  mjs: [
    "text/javascript",
    "application/javascript",
    "text/plain",
    "application/octet-stream",
  ],
  cjs: [
    "text/javascript",
    "application/javascript",
    "text/plain",
    "application/octet-stream",
  ],
  ts: [
    "text/typescript",
    "application/typescript",
    "text/plain",
    "application/octet-stream",
  ],
  tsx: [
    "text/typescript",
    "application/typescript",
    "text/plain",
    "application/octet-stream",
  ],
  jsx: [
    "text/javascript",
    "application/javascript",
    "text/plain",
    "application/octet-stream",
  ],
  py: ["text/x-python", "text/plain", "application/octet-stream"],
  java: ["text/x-java-source", "text/plain", "application/octet-stream"],
  c: ["text/plain", "application/octet-stream"],
  h: ["text/plain", "application/octet-stream"],
  cpp: ["text/plain", "application/octet-stream"],
  hpp: ["text/plain", "application/octet-stream"],
  cs: ["text/plain", "application/octet-stream"],
  go: ["text/plain", "application/octet-stream"],
  rs: ["text/plain", "application/octet-stream"],
  php: ["text/plain", "application/octet-stream"],
  rb: ["text/plain", "application/octet-stream"],
  sh: ["text/plain", "application/octet-stream"],
  bat: ["text/plain", "application/octet-stream"],
  sql: [
    "application/sql",
    "text/sql",
    "text/plain",
    "application/octet-stream",
  ],
  toml: ["application/toml", "text/plain", "application/octet-stream"],
  ini: ["text/plain", "application/octet-stream"],
  log: ["text/plain", "application/octet-stream"],
});

const ZIP_EXTENSIONS = new Set(["docx", "xlsx", "pptx"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const SOURCE_EXTENSIONS = new Set([
  "txt",
  "md",
  "json",
  "xml",
  "yaml",
  "yml",
  "html",
  "htm",
  "css",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "py",
  "java",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "go",
  "rs",
  "php",
  "rb",
  "sh",
  "bat",
  "sql",
  "toml",
  "ini",
  "log",
]);

function attachmentError(
  message = "Unable to read this file. Please try another supported file.",
) {
  const error = new Error(message);
  error.status = 422;
  return error;
}

function validateAttachments(input, maxBytes) {
  const attachments = Array.isArray(input) ? input : input ? [input] : [];
  if (attachments.length > MAX_FILE_COUNT) {
    throw attachmentError(
      `Please upload no more than ${MAX_FILE_COUNT} files at once.`,
    );
  }

  let totalBytes = 0;
  return attachments.map((attachment) => {
    const filename =
      typeof attachment?.name === "string" ? attachment.name : "";
    const extension = filename.split(".").pop()?.toLowerCase() || "";
    const type =
      typeof attachment?.type === "string" ? attachment.type.toLowerCase() : "";
    const data = typeof attachment?.data === "string" ? attachment.data : "";
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(data);
    if (
      !filename ||
      filename.length > 180 ||
      !Object.hasOwn(EXTENSION_TYPES, extension) ||
      (!EXTENSION_TYPES[extension].includes(type) &&
        !(
          SOURCE_EXTENSIONS.has(extension) &&
          (/^text\//.test(type) || type === "application/octet-stream")
        )) ||
      !match ||
      match[1].toLowerCase() !== type
    ) {
      throw attachmentError();
    }

    const base64 = match[2];
    const buffer = Buffer.from(base64, "base64");
    if (
      !buffer.length ||
      buffer.toString("base64").replace(/=+$/, "") !== base64.replace(/=+$/, "")
    ) {
      throw attachmentError();
    }
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw attachmentError(
        `Attachments exceed the ${Math.floor(maxBytes / (1024 * 1024))} MB total size limit.`,
      );
    }

    const isPng =
      extension === "png" &&
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg =
      ["jpg", "jpeg"].includes(extension) &&
      buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
    const isWebp =
      extension === "webp" &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP";
    const isPdf =
      extension === "pdf" &&
      buffer.subarray(0, 5).toString("ascii") === "%PDF-";
    const isZip =
      ZIP_EXTENSIONS.has(extension) &&
      buffer.subarray(0, 4).toString("ascii") === "PK\x03\x04";
    if (
      (IMAGE_EXTENSIONS.has(extension) && !(isPng || isJpeg || isWebp)) ||
      (extension === "pdf" && !isPdf) ||
      (ZIP_EXTENSIONS.has(extension) && !isZip)
    ) {
      throw attachmentError();
    }
    if (SOURCE_EXTENSIONS.has(extension) && buffer.includes(0)) {
      throw attachmentError(
        "This file does not appear to contain readable text.",
      );
    }

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
    return {
      filename: safeName,
      extension,
      type,
      base64,
      buffer,
      size: buffer.length,
    };
  });
}

function assertArchiveBudget(buffer) {
  let archive;
  try {
    archive = new AdmZip(buffer);
  } catch (_) {
    throw attachmentError();
  }
  const entries = archive.getEntries();
  const totalSize = entries.reduce(
    (sum, entry) => sum + Number(entry.header?.size || 0),
    0,
  );
  if (totalSize > MAX_ARCHIVE_UNCOMPRESSED_BYTES || entries.length > 2000) {
    throw attachmentError(
      "This compressed file is too large to safely analyze.",
    );
  }
  return archive;
}

function collectXmlText(value, key, out) {
  if (typeof value === "string") {
    if (/(^|:)t$/.test(key)) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectXmlText(item, key, out));
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      collectXmlText(childValue, childKey, out);
    }
  }
}

async function extractText(attachment) {
  const { extension, buffer } = attachment;
  if (extension === "pdf") {
    const parsed = await pdfParse(buffer, { max: 100 });
    return String(parsed.text || "").slice(0, MAX_EXTRACTED_CHARS);
  }
  if (extension === "docx") {
    assertArchiveBudget(buffer);
    const parsed = await mammoth.extractRawText({ buffer });
    return String(parsed.value || "").slice(0, MAX_EXTRACTED_CHARS);
  }
  if (extension === "xlsx") {
    assertArchiveBudget(buffer);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sections = [];
    for (const sheet of workbook.worksheets) {
      const rows = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        rows.push(
          row.values
            .slice(1)
            .map((cell) => {
              if (cell && typeof cell === "object")
                return String(cell.text || cell.result || "");
              return String(cell ?? "");
            })
            .join(" | "),
        );
      });
      sections.push(`Sheet: ${sheet.name}\n${rows.join("\n")}`);
    }
    return sections.join("\n\n").slice(0, MAX_EXTRACTED_CHARS);
  }
  if (extension === "csv") {
    const workbook = new ExcelJS.Workbook();
    await workbook.csv.read(require("stream").Readable.from([buffer]));
    const sheet = workbook.worksheets[0];
    const rows = [];
    sheet?.eachRow({ includeEmpty: false }, (row) => {
      rows.push(
        row.values
          .slice(1)
          .map((cell) => String(cell ?? ""))
          .join(" | "),
      );
    });
    return rows.join("\n").slice(0, MAX_EXTRACTED_CHARS);
  }
  if (extension === "pptx") {
    const archive = assertArchiveBudget(buffer);
    const parser = new XMLParser({
      ignoreAttributes: true,
      parseTagValue: false,
    });
    const slides = archive
      .getEntries()
      .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName))
      .sort(
        (a, b) =>
          Number(a.entryName.match(/slide(\d+)/)?.[1]) -
          Number(b.entryName.match(/slide(\d+)/)?.[1]),
      );
    const text = slides.map((entry, index) => {
      const xml = archive.readAsText(entry);
      if (xml.length > MAX_XML_TEXT)
        return `Slide ${index + 1}: [slide text exceeds processing limit]`;
      const parsed = parser.parse(xml);
      const words = [];
      collectXmlText(parsed, "", words);
      return `Slide ${index + 1}: ${words.join(" ")}`;
    });
    return text.join("\n\n").slice(0, MAX_EXTRACTED_CHARS);
  }
  if (SOURCE_EXTENSIONS.has(extension)) {
    const text = new TextDecoder("utf-8", { fatal: true })
      .decode(buffer)
      .replace(/^\uFEFF/, "");
    return text.slice(0, MAX_EXTRACTED_CHARS);
  }
  if (IMAGE_EXTENSIONS.has(extension)) return "";
  throw attachmentError();
}

function selectRelevantText(text, question, maxChars) {
  const normalized = String(text || "").trim();
  if (normalized.length <= maxChars) return normalized;
  const broadRequest =
    /\b(summar(y|ize)|overview|explain (this|the) (file|document)|main points|key points)\b/i.test(
      question,
    );
  const paragraphs = normalized
    .split(/\n{1,2}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const terms =
    String(question || "")
      .toLowerCase()
      .match(/[a-z0-9_]{3,}/g) || [];
  const uniqueTerms = [...new Set(terms)].slice(0, 18);
  if (broadRequest || uniqueTerms.length === 0)
    return `${normalized.slice(0, Math.floor(maxChars * 0.65))}\n\n[Middle and later sections omitted due to context limits.]\n\n${normalized.slice(-Math.floor(maxChars * 0.3))}`;
  const ranked = paragraphs
    .map((paragraph, index) => ({
      paragraph,
      index,
      score: uniqueTerms.reduce(
        (score, term) =>
          score + (paragraph.toLowerCase().includes(term) ? 1 : 0),
        0,
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = [];
  let used = 0;
  for (const item of ranked) {
    if (used + item.paragraph.length > maxChars) continue;
    selected.push(item);
    used += item.paragraph.length;
  }
  if (!selected.length)
    return `${normalized.slice(0, Math.floor(maxChars * 0.7))}\n\n[Remaining content omitted due to context limits.]`;
  return selected
    .sort((a, b) => a.index - b.index)
    .map((item) => item.paragraph)
    .join("\n\n");
}

async function processAttachments(attachments, question) {
  const processed = [];
  for (const attachment of attachments) {
    const text = await extractText(attachment);
    processed.push({ ...attachment, text });
  }
  const textFiles = processed.filter((file) => file.text);
  const perFileBudget = Math.floor(24000 / Math.max(1, textFiles.length));
  const context = textFiles
    .map(
      (file) =>
        `FILE: ${file.filename} (${file.type})\n${selectRelevantText(file.text, question, perFileBudget)}`,
    )
    .join("\n\n")
    .slice(0, 26000);
  const images = processed
    .filter((file) => IMAGE_EXTENSIONS.has(file.extension))
    .map((file) => file.base64);
  const retained = textFiles.map((file) => ({
    filename: file.filename,
    type: file.type,
    text: file.text.slice(0, 30000),
  }));
  return {
    context,
    images,
    retained,
    processed: processed.map(({ buffer, base64, text, ...file }) => ({
      ...file,
      textLength: text.length,
    })),
  };
}

module.exports = {
  AI_MAX_ATTACHMENT_COUNT: MAX_FILE_COUNT,
  validateAttachments,
  processAttachments,
  attachmentError,
};
