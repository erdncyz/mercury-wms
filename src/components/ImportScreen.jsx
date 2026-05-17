import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { importProductsBulk } from "../services/stockService";

GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

const HEADER_ALIASES = {
  name: ["name", "product", "productname", "urun", "urunadi", "urun adi", "urun adı", "aciklama", "description"],
  barcode: ["barcode", "barkod", "code", "sku"],
  productCode: ["urunkodu", "urun kodu", "productcode", "product code", "stokkodu", "stok kodu"],
  category: ["category", "kategori", "group", "grup"],
  quantity: ["quantity", "qty", "stock", "stok", "adet", "miktar"],
  price: ["price", "fiyat", "unitprice", "birimfiyat", "birim fiyat"],
  imageRef: ["urungorseli", "urun gorseli", "image", "gorsel"],
  features: ["urunozellikleri", "urun ozellikleri", "features", "ozellik"],
  containerNumber: ["containernumarasi", "container numarasi", "container no", "konteyner"],
  qtyPerBox: ["adetkolimiktari", "adet koli miktari", "qtyperbox", "koliiciadet", "koli ici adet"],
  totalBox: ["toplamkackoli", "toplam kac koli", "totalbox", "toplam koli"],
  unitKg: ["adetkg", "unitkg", "kgadet", "kg"],
  totalKg: ["toplamkg", "totalkg"],
  widthCm: ["encm", "en", "width", "widthcm"],
  lengthCm: ["boycm", "boy", "length", "lengthcm"],
  heightCm: ["yukseklikcm", "yukseklik", "height", "heightcm"],
  unitM3: ["adetm3", "unitm3", "m3adet", "m3"],
  totalM3: ["toplamadetm3", "toplam m3", "totalm3"]
};

const OPTIONAL_FIELDS = [
  "productCode",
  "imageRef",
  "features",
  "containerNumber",
  "qtyPerBox",
  "totalBox",
  "unitKg",
  "totalKg",
  "widthCm",
  "lengthCm",
  "heightCm",
  "unitM3",
  "totalM3"
];

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function compactDetails(details) {
  const out = {};
  Object.entries(details).forEach(([k, v]) => {
    if (v === null || v === undefined) return;
    if (typeof v === "string" && !v.trim()) return;
    out[k] = v;
  });
  return out;
}

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[ıİ]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .replace(/[çÇ]/g, "c")
    .replace(/[^a-z0-9]/g, "");
}

function mapHeaderKeys(headers) {
  const map = {};

  headers.forEach((header, index) => {
    const h = normalizeHeader(header);
    Object.entries(HEADER_ALIASES).forEach(([field, aliases]) => {
      if (!map[field] && aliases.some((alias) => normalizeHeader(alias) === h)) {
        map[field] = index;
      }
    });
  });

  return map;
}

function normalizeRow(row) {
  const productCode = String(row.productCode || "").trim();
  const barcode = String(row.barcode || productCode).trim();
  const quantity = toNumberOrNull(row.quantity);
  const price = toNumberOrNull(row.price);

  const details = compactDetails({
    productCode,
    imageRef: String(row.imageRef || "").trim(),
    features: String(row.features || "").trim(),
    containerNumber: String(row.containerNumber || "").trim(),
    qtyPerBox: toNumberOrNull(row.qtyPerBox),
    totalBox: toNumberOrNull(row.totalBox),
    unitKg: toNumberOrNull(row.unitKg),
    totalKg: toNumberOrNull(row.totalKg),
    widthCm: toNumberOrNull(row.widthCm),
    lengthCm: toNumberOrNull(row.lengthCm),
    heightCm: toNumberOrNull(row.heightCm),
    unitM3: toNumberOrNull(row.unitM3),
    totalM3: toNumberOrNull(row.totalM3)
  });

  return {
    name: String(row.name || "").trim(),
    barcode,
    category: String(row.category || "Genel").trim() || "Genel",
    quantity: quantity ?? 0,
    price: price ?? 0,
    details
  };
}

function convertRowsFromSheet(rawRows) {
  if (!rawRows.length) return [];

  const headers = rawRows[0] || [];
  const keyMap = mapHeaderKeys(headers);
  const hasMappedHeader = ["name", "quantity"].every((k) => keyMap[k] !== undefined) && (keyMap.barcode !== undefined || keyMap.productCode !== undefined);

  const startIndex = hasMappedHeader ? 1 : 0;

  return rawRows.slice(startIndex).map((row) => {
    if (hasMappedHeader) {
      const mappedRow = {
        name: row[keyMap.name],
        barcode: keyMap.barcode !== undefined ? row[keyMap.barcode] : undefined,
        productCode: keyMap.productCode !== undefined ? row[keyMap.productCode] : undefined,
        category: row[keyMap.category],
        quantity: row[keyMap.quantity],
        price: row[keyMap.price]
      };

      OPTIONAL_FIELDS.forEach((field) => {
        if (keyMap[field] !== undefined) {
          mappedRow[field] = row[keyMap[field]];
        }
      });

      return normalizeRow(mappedRow);
    }

    return normalizeRow({
      name: row[0],
      barcode: row[1],
      category: row[2],
      quantity: row[3],
      price: row[4]
    });
  });
}

function parseDelimitedLine(line) {
  if (line.includes(";")) return line.split(";");
  if (line.includes("\t")) return line.split("\t");
  if (line.includes(",")) return line.split(",");
  return null;
}

function normalizeTr(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[ıİ]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .replace(/[çÇ]/g, "c")
    .replace(/\s+/g, " ")
    .trim();
}

function groupPdfItemsByRow(items) {
  const rows = [];
  const tolerance = 2.5;

  items.forEach((item) => {
    const text = String(item.str || "").trim();
    if (!text) return;

    const transform = item.transform || [];
    const x = Number(transform[4] || 0);
    const y = Number(transform[5] || 0);

    let row = rows.find((r) => Math.abs(r.y - y) <= tolerance);
    if (!row) {
      row = { y, cells: [] };
      rows.push(row);
    }

    row.cells.push({ x, text });
  });

  rows.forEach((row) => {
    row.cells.sort((a, b) => a.x - b.x);
  });

  rows.sort((a, b) => b.y - a.y);
  return rows;
}

function getPdfHeaderPositions(rows) {
  let codeX = null;
  let descriptionX = null;
  let qtyX = null;

  rows.forEach((row) => {
    row.cells.forEach((cell) => {
      const t = normalizeTr(cell.text).replace(/\s/g, "");
      if (codeX === null && (t.includes("urunkodu") || t === "barcode" || t === "sku")) codeX = cell.x;
      if (descriptionX === null && (t.includes("aciklama") || t.includes("description"))) descriptionX = cell.x;
      if (qtyX === null && (t === "adet" || t.includes("quantity") || t === "qty")) qtyX = cell.x;
    });
  });

  return { codeX, descriptionX, qtyX };
}

function parsePdfRowsFromStructuredText(rows) {
  const { codeX, descriptionX, qtyX } = getPdfHeaderPositions(rows);
  const parsed = [];

  const columnX = {};
  function isHeaderRow(normalizedLine) {
    return (
      normalizedLine.includes("urun kodu") ||
      normalizedLine.includes("urun gorseli") ||
      normalizedLine.includes("urun ozellikleri") ||
      normalizedLine.includes("container numarasi") ||
      normalizedLine.includes("toplam kg") ||
      normalizedLine.includes("adet m3")
    );
  }

  const headerRows = rows.filter((row) => isHeaderRow(normalizeTr(row.cells.map((c) => c.text).join(" "))));

  headerRows.forEach((row) => {
    row.cells.forEach((cell) => {
      const normalized = normalizeHeader(cell.text);
      Object.entries(HEADER_ALIASES).forEach(([field, aliases]) => {
        if (columnX[field] !== undefined) return;
        if (aliases.some((a) => normalizeHeader(a) === normalized)) {
          columnX[field] = cell.x;
        }
      });
    });
  });

  function setColumnByPhrase(field, tokens) {
    if (columnX[field] !== undefined) return;
    for (const row of headerRows) {
      const cells = [...row.cells].sort((a, b) => a.x - b.x);
      const normalizedCells = cells.map((c) => normalizeHeader(c.text));

      for (let i = 0; i <= normalizedCells.length - tokens.length; i += 1) {
        const ok = tokens.every((token, idx) => normalizedCells[i + idx] === token);
        if (ok) {
          columnX[field] = cells[i].x;
          return;
        }
      }
    }
      if (result.created + result.updated === 0 && result.failed > 0) {
        const reasons = result.errors
          .slice(0, 3)
          .map((item) => `#${item.row} ${item.reason}`)
          .join(" | ");
        setError(`${t.importSaveError}: ${reasons}`);
      }
  }

  setColumnByPhrase("productCode", ["urunkodu"]);
  setColumnByPhrase("name", ["aciklama"]);
  setColumnByPhrase("features", ["urunozellikleri"]);
  setColumnByPhrase("quantity", ["adet"]);
  setColumnByPhrase("containerNumber", ["container", "numarasi"]);
  setColumnByPhrase("qtyPerBox", ["adet", "koli", "miktari"]);
  setColumnByPhrase("totalBox", ["toplam", "kac", "koli"]);
  setColumnByPhrase("totalBox", ["toplam", "koli"]);
  setColumnByPhrase("unitKg", ["adet", "kg"]);
  setColumnByPhrase("totalKg", ["toplam", "kg"]);
  setColumnByPhrase("widthCm", ["encm"]);
  setColumnByPhrase("lengthCm", ["boycm"]);
  setColumnByPhrase("heightCm", ["yuksekli", "kcm"]);
  setColumnByPhrase("heightCm", ["yukseklik", "cm"]);
  setColumnByPhrase("unitM3", ["adet", "m3"]);
  setColumnByPhrase("totalM3", ["toplam", "adet", "m3"]);

  if (columnX.productCode === undefined && codeX !== null) {
    columnX.productCode = codeX;
  }
  if (columnX.name === undefined && descriptionX !== null) {
    columnX.name = descriptionX;
  }
  if (columnX.quantity === undefined && qtyX !== null) {
    columnX.quantity = qtyX;
  }

  // Fallback column layout for Sit & Seats style table when header is split across many cells.
  if (columnX.quantity !== undefined) {
    const qx = columnX.quantity;
    if (columnX.containerNumber === undefined) columnX.containerNumber = qx + 14;
    if (columnX.qtyPerBox === undefined) columnX.qtyPerBox = qx + 44;
    if (columnX.totalBox === undefined) columnX.totalBox = qx + 60;
    if (columnX.unitKg === undefined) columnX.unitKg = qx + 76;
    if (columnX.totalKg === undefined) columnX.totalKg = qx + 92;
    if (columnX.widthCm === undefined) columnX.widthCm = qx + 112;
    if (columnX.lengthCm === undefined) columnX.lengthCm = qx + 128;
    if (columnX.heightCm === undefined) columnX.heightCm = qx + 144;
    if (columnX.unitM3 === undefined) columnX.unitM3 = qx + 166;
    if (columnX.totalM3 === undefined) columnX.totalM3 = qx + 190;
  }

  if (columnX.features === undefined && descriptionX !== null && qtyX !== null) {
    columnX.features = descriptionX + (qtyX - descriptionX) * 0.55;
  }

  function getCodeFromRow(row) {
    const firstColumnMax = codeX !== null ? codeX + 22 : 60;
    const codeCandidate = row.cells.find((c) => c.x <= firstColumnMax && /[A-Za-z]/.test(c.text));
    if (!codeCandidate) return null;

    const value = String(codeCandidate.text || "").trim();
    if (!value) return null;
    if (/^(urun|product|kod|code|adet|toplam)$/i.test(normalizeHeader(value))) return null;
    if (value.length < 2) return null;
    return value;
  }

  const sortedColumns = Object.entries(columnX)
    .filter(([, x]) => x !== undefined && x !== null)
    .map(([field, x]) => ({ field, x }))
    .sort((a, b) => a.x - b.x);

  function getColumnBounds(field) {
    const idx = sortedColumns.findIndex((c) => c.field === field);
    if (idx === -1) return null;

    const current = sortedColumns[idx];
    const left = idx === 0 ? current.x - 10 : (sortedColumns[idx - 1].x + current.x) / 2;
    const right = idx === sortedColumns.length - 1 ? current.x + 160 : (current.x + sortedColumns[idx + 1].x) / 2;

    return { left, right };
  }

  function getTextsFromColumn(blockRows, field) {
    const bounds = getColumnBounds(field);
    if (!bounds) return [];

    const rowsByY = [...blockRows].sort((a, b) => b.y - a.y);
    const out = [];

    rowsByY.forEach((row) => {
      const line = row.cells
        .filter((cell) => cell.x >= bounds.left && cell.x < bounds.right)
        .map((cell) => String(cell.text || "").trim())
        .filter(Boolean)
        .join(" ")
        .trim();
      if (!line) return;
      out.push(line);
    });

    return out;
  }

  function getNumberFromColumn(blockRows, field) {
    const texts = getTextsFromColumn(blockRows, field);
    for (const text of texts) {
      const m = text.match(/\d+(?:[.,]\d+)?/);
      if (!m) continue;
      const n = Number(String(m[0]).replace(",", "."));
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  const blocks = [];
  let currentBlock = null;

  rows.forEach((row) => {
    const normalizedLine = normalizeTr(row.cells.map((c) => c.text).join(" "));
    if (!normalizedLine || isHeaderRow(normalizedLine)) return;

    const detectedCode = getCodeFromRow(row);

    if (detectedCode) {
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      currentBlock = { code: detectedCode, rows: [row] };
      return;
    }

    if (currentBlock) {
      currentBlock.rows.push(row);
    }
  });

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  blocks.forEach((block) => {
    const allCells = block.rows.flatMap((r) => r.cells);
    const textCells = allCells.map((c) => c.text);

    const descLines = getTextsFromColumn(block.rows, "name");
    const featureLines = getTextsFromColumn(block.rows, "features");

    const primaryName = String(descLines[0] || "").trim();
    const extraDesc = descLines.slice(1).join(" ").trim();
    const name = primaryName || textCells.find((text) => text !== block.code && /[A-Za-zçğıöşüÇĞİÖŞÜ]/.test(text)) || "";

    let qty = getNumberFromColumn(block.rows, "quantity");
    if (!Number.isFinite(qty) && qtyX !== null) {
      const nearestQty = [...allCells]
        .filter((c) => /^\d+(?:[.,]\d+)?$/.test(String(c.text).trim()))
        .sort((a, b) => Math.abs(a.x - qtyX) - Math.abs(b.x - qtyX))[0];
      qty = nearestQty ? Number(String(nearestQty.text).replace(",", ".")) : null;
    }

    if (!name || !Number.isFinite(qty)) return;

    const combinedFeatures = [featureLines.join(" "), extraDesc].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    const combinedText = [name, combinedFeatures].join(" ");

    const details = compactDetails({
      productCode: getTextsFromColumn(block.rows, "productCode").join(" ").trim() || block.code,
      imageRef: getTextsFromColumn(block.rows, "imageRef").join(" ").trim(),
      features: combinedFeatures,
      containerNumber: getTextsFromColumn(block.rows, "containerNumber").join(" ").trim(),
      qtyPerBox: getNumberFromColumn(block.rows, "qtyPerBox"),
      totalBox: getNumberFromColumn(block.rows, "totalBox"),
      unitKg: getNumberFromColumn(block.rows, "unitKg"),
      totalKg: getNumberFromColumn(block.rows, "totalKg"),
      widthCm: getNumberFromColumn(block.rows, "widthCm"),
      lengthCm: getNumberFromColumn(block.rows, "lengthCm"),
      heightCm: getNumberFromColumn(block.rows, "heightCm"),
      unitM3: getNumberFromColumn(block.rows, "unitM3"),
      totalM3: getNumberFromColumn(block.rows, "totalM3")
    });

    parsed.push(
      normalizeRow({
        name,
        barcode: block.code,
        category: /koltuk|chair/i.test(combinedText) ? "Koltuk" : "Genel",
        quantity: qty,
        price: 0,
        ...details
      })
    );
  });

  const deduped = new Map();
  parsed.forEach((row) => {
    if (!deduped.has(row.barcode)) {
      deduped.set(row.barcode, row);
      return;
    }

    const prev = deduped.get(row.barcode);
    if (Number(row.quantity) > Number(prev.quantity || 0)) {
      deduped.set(row.barcode, row);
    }
  });

  return [...deduped.values()];
}

function parsePdfRowsLegacy(rows) {
  const { codeX, descriptionX, qtyX } = getPdfHeaderPositions(rows);
  const parsed = [];

  function isHeaderRow(normalizedLine) {
    return (
      normalizedLine.includes("urun kodu") ||
      normalizedLine.includes("urun gorseli") ||
      normalizedLine.includes("urun ozellikleri") ||
      normalizedLine.includes("container numarasi") ||
      normalizedLine.includes("toplam kg")
    );
  }

  function getCodeFromRow(row) {
    const firstColumnMax = codeX !== null ? codeX + 22 : 60;
    const codeCandidate = row.cells.find((c) => c.x <= firstColumnMax && /[A-Za-z]/.test(c.text));
    if (!codeCandidate) return null;

    const value = String(codeCandidate.text || "").trim();
    if (!value) return null;
    if (/^(urun|product|kod|code|adet|toplam)$/i.test(normalizeHeader(value))) return null;
    if (value.length < 2) return null;
    return value;
  }

  function getNearestInBlock(blockRows, x, tolerance = 24) {
    if (x === undefined || x === null) return null;
    const all = blockRows.flatMap((r) => r.cells);
    if (!all.length) return null;
    const sorted = [...all].sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x));
    if (Math.abs(sorted[0].x - x) > tolerance) return null;
    return sorted[0].text;
  }

  const blocks = [];
  let currentBlock = null;

  rows.forEach((row) => {
    const normalizedLine = normalizeTr(row.cells.map((c) => c.text).join(" "));
    if (!normalizedLine || isHeaderRow(normalizedLine)) return;

    const detectedCode = getCodeFromRow(row);

    if (detectedCode) {
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      currentBlock = { code: detectedCode, rows: [row] };
      return;
    }

    if (currentBlock) {
      currentBlock.rows.push(row);
    }
  });

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  blocks.forEach((block) => {
    const allCells = block.rows.flatMap((r) => r.cells);
    const textCells = allCells.map((c) => c.text);
    const combinedText = textCells.join(" ");

    let nameParts = allCells
      .filter((c) => {
        if (String(c.text).trim() === block.code) return false;
        if (descriptionX !== null && qtyX !== null) return c.x >= descriptionX && c.x < qtyX;
        return /[A-Za-zçğıöşüÇĞİÖŞÜ]/.test(c.text);
      })
      .map((c) => c.text)
      .filter((text) => /[A-Za-zçğıöşüÇĞİÖŞÜ]/.test(text));

    if (!nameParts.length) {
      nameParts = textCells.filter((text) => text !== block.code && /[A-Za-zçğıöşüÇĞİÖŞÜ]/.test(text));
    }

    const name = nameParts.join(" ").replace(/\s+/g, " ").trim();

    let qty = null;
    const numericCells = allCells.filter((c) => /^\d+(?:[.,]\d+)?$/.test(String(c.text).trim()));

    if (qtyX !== null && numericCells.length) {
      const nearest = [...numericCells].sort((a, b) => Math.abs(a.x - qtyX) - Math.abs(b.x - qtyX))[0];
      qty = Number(String(nearest.text).replace(",", "."));
    }

    if ((qty === null || Number.isNaN(qty)) && numericCells.length) {
      qty = Number(String(numericCells[0].text).replace(",", "."));
    }

    if (!name || !Number.isFinite(qty)) return;

    parsed.push(
      normalizeRow({
        name,
        barcode: block.code,
        category: /koltuk|chair/i.test(combinedText) ? "Koltuk" : "Genel",
        quantity: qty,
        price: 0,
        productCode: block.code
      })
    );
  });

  const deduped = new Map();
  parsed.forEach((row) => {
    if (!deduped.has(row.barcode)) {
      deduped.set(row.barcode, row);
      return;
    }

    const prev = deduped.get(row.barcode);
    if (Number(row.quantity) > Number(prev.quantity || 0)) {
      deduped.set(row.barcode, row);
    }
  });

  return [...deduped.values()];
}

async function parseFile(file) {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "csv") {
    const text = await file.text();
    const rows = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => parseDelimitedLine(line) || [line]);

    return convertRowsFromSheet(rows);
  }

  if (ext === "xlsx" || ext === "xls") {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheet = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheet];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    return convertRowsFromSheet(rows);
  }

  if (ext === "pdf") {
    const buffer = await file.arrayBuffer();
    const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
    const allRows = [];

    for (let i = 1; i <= pdf.numPages; i += 1) {
      try {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const groupedRows = groupPdfItemsByRow(content.items || []);
        allRows.push(...groupedRows);
      } catch (error) {
        console.error("PDF page parse failed", i, error);
      }
    }

    if (!allRows.length) {
      throw new Error("PDF_EMPTY");
    }

    try {
      const parsed = parsePdfRowsFromStructuredText(allRows);
      if (parsed.length) return parsed;
    } catch (error) {
      console.error("Structured PDF parse failed, fallback to legacy parser", error);
    }

    const fallback = parsePdfRowsLegacy(allRows);
    if (fallback.length) return fallback;

    throw new Error("PDF_PARSE_EMPTY");
  }

  throw new Error("UNSUPPORTED_FILE");
}

export default function ImportScreen({ t }) {
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [enabledOptionalFields, setEnabledOptionalFields] = useState(() => {
    const init = {};
    OPTIONAL_FIELDS.forEach((key) => {
      init[key] = true;
    });
    return init;
  });

  const previewRows = useMemo(() => rows.slice(0, 10), [rows]);
  const optionalPresence = useMemo(() => {
    const presence = {};
    OPTIONAL_FIELDS.forEach((k) => {
      presence[k] = rows.some((r) => {
        const val = r.details?.[k];
        if (val === null || val === undefined) return false;
        if (typeof val === "string") return Boolean(val.trim());
        return true;
      });
    });
    return presence;
  }, [rows]);

  const onPickFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    setMessage("");
    setError("");

    try {
      const parsed = await parseFile(file);
      const cleaned = parsed.filter((row) => row.name && row.barcode && !Number.isNaN(row.quantity) && row.quantity >= 0);

      setRows(cleaned);
      setFileName(file.name);

      const nextEnabled = {};
      OPTIONAL_FIELDS.forEach((key) => {
        nextEnabled[key] = cleaned.some((r) => {
          const val = r.details?.[key];
          if (val === null || val === undefined) return false;
          if (typeof val === "string") return Boolean(val.trim());
          return true;
        });
      });
      setEnabledOptionalFields(nextEnabled);

      const optionalCount = cleaned.reduce((acc, row) => acc + Object.keys(row.details || {}).length, 0);
      setMessage(t.importParsed.replace("{count}", String(cleaned.length)).replace("{optional}", String(optionalCount)));
    } catch {
      setRows([]);
      setFileName("");
      setError(t.importParseError);
    } finally {
      setIsParsing(false);
    }
  };

  const onImport = async () => {
    if (!rows.length) {
      setError(t.importNoRows);
      return;
    }

    setIsImporting(true);
    setError("");
    setMessage("");

    const preparedRows = rows.map((row) => {
      const nextDetails = {};
      Object.entries(row.details || {}).forEach(([k, v]) => {
        if (enabledOptionalFields[k]) {
          nextDetails[k] = v;
        }
      });

      return {
        ...row,
        details: nextDetails
      };
    });

    try {
      const result = await importProductsBulk(preparedRows, ({ current, total }) => {
        setMessage(`${t.loading} ${current}/${total}`);
      });
        if (result.created + result.updated === 0 && result.failed > 0) {
          if (result.errors.some((item) => String(item.reason || "").toLowerCase().includes("permission-denied"))) {
            setError(t.permissionDeniedHint);
          }
          const reasons = result.errors
            .slice(0, 3)
            .map((item) => `#${item.row} ${item.reason}`)
            .join(" | ");
          setError(`${t.importSaveError}: ${reasons}`);
        } else {
          setMessage(
            t.importDone
              .replace("{created}", String(result.created))
              .replace("{updated}", String(result.updated))
              .replace("{skipped}", String(result.skipped))
              .replace("{failed}", String(result.failed))
          );
        }
    } catch {
      setError(t.importSaveError);
    } finally {
      setIsImporting(false);
    }
  };

  const busy = isParsing || isImporting;

  return (
    <section className="space-y-4">
      <div className="glass rounded-3xl p-4">
        <h2 className="font-display text-xl font-bold">{t.importTitle}</h2>
        <p className="mt-1 text-sm text-slate-400">{t.importHint}</p>
      </div>

      <div className="glass rounded-3xl p-4 space-y-3">
        <label className="block rounded-2xl border border-dashed border-cyan-300/35 bg-cyan-300/5 p-4 text-center text-sm text-cyan-200 cursor-pointer">
          <input type="file" accept=".xlsx,.xls,.csv,.pdf" className="hidden" onChange={onPickFile} />
          {isParsing ? t.loading : t.importPickFile}
        </label>

        <p className="text-xs text-slate-400">{t.importFormatHelp}</p>
        {fileName ? <p className="text-sm text-slate-300">{t.importSelectedFile}: {fileName}</p> : null}

        {rows.length > 0 ? (
          <div className="rounded-2xl border border-white/10 bg-slate-900/35 p-3">
            <p className="mb-2 text-xs font-semibold text-slate-300">{t.optionalFieldControls}</p>
            <div className="grid grid-cols-2 gap-2">
              {OPTIONAL_FIELDS.filter((k) => optionalPresence[k]).map((key) => (
                <label key={key} className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={Boolean(enabledOptionalFields[key])}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setEnabledOptionalFields((prev) => ({ ...prev, [key]: checked }));
                    }}
                  />
                  <span>{key}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={onImport}
          disabled={busy || rows.length === 0}
          className="w-full rounded-2xl bg-cyan-300 px-4 py-4 text-base font-extrabold text-slate-900 disabled:opacity-60"
        >
          {isImporting ? `${t.loading}...` : t.importAction}
        </button>
      </div>

      {previewRows.length > 0 ? (
        <div className="glass rounded-3xl p-4 overflow-auto">
          <p className="mb-3 text-sm text-slate-300">{t.importPreview}</p>
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-slate-300 border-b border-white/10">
                <th className="py-2">{t.productName}</th>
                <th className="py-2">{t.barcode}</th>
                <th className="py-2">{t.category}</th>
                <th className="py-2">{t.quantityLabel}</th>
                <th className="py-2">{t.price}</th>
                <th className="py-2">{t.optionalFields}</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, idx) => (
                <tr key={`${row.barcode}-${idx}`} className="border-b border-white/5 text-slate-200">
                  <td className="py-2">{row.name}</td>
                  <td className="py-2">{row.barcode}</td>
                  <td className="py-2">{row.category}</td>
                  <td className="py-2">{row.quantity}</td>
                  <td className="py-2">{row.price}</td>
                  <td className="py-2">{Object.keys(row.details || {}).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {error ? <p className="rounded-xl bg-rose-400/10 px-4 py-3 text-sm text-rose-300">{error}</p> : null}
      {message ? <p className="rounded-xl bg-emerald-400/10 px-4 py-3 text-sm text-emerald-300">{message}</p> : null}
    </section>
  );
}
