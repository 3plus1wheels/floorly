import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const path = "/Users/vova_nguyen/Downloads/FY2025 KPI and Sales Tracker.xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(path));
const result = [];

for (const sheet of workbook.worksheets.items) {
  const used = sheet.getUsedRange();
  const values = used?.values ?? [];
  const formulas = used?.formulas ?? [];
  let nonEmpty = 0;
  let formulaCount = 0;
  const errors = [];
  const formulaCells = [];
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < (values[r]?.length ?? 0); c++) {
      const v = values[r][c];
      const f = formulas[r]?.[c];
      if (v !== null && v !== "") nonEmpty++;
      if (typeof f === "string" && f.startsWith("=")) {
        formulaCount++;
        if (formulaCells.length < 40) formulaCells.push({ row: r + 1, col: c + 1, formula: f, value: v });
      }
      if (typeof v === "string" && /^#(REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!|SPILL!|CALC!)/.test(v)) {
        errors.push({ row: r + 1, col: c + 1, value: v, formula: f || null });
      }
    }
  }
  const tail = values.slice(Math.max(0, values.length - 8)).map((row, i) => ({ row: Math.max(1, values.length - 7) + i, cells: row.slice(0, 19) }));
  const weekly = [];
  for (let r = 0; r < values.length; r++) {
    if (values[r]?.[2] === "WTD") weekly.push({ row: r + 1, cells: values[r].slice(0, 19) });
    if (values[r]?.[2] === "Total") weekly.push({ row: r + 1, cells: values[r].slice(0, 7) });
  }
  result.push({
    name: sheet.name,
    usedRange: used?.address ?? null,
    nonEmpty,
    formulaCount,
    errors,
    tables: sheet.tables.items.map(t => t.name),
    charts: sheet.charts.items.map(c => ({ name: c.name, type: c.type, title: c.title?.text ?? null })),
    weekly,
    tail,
    formulaCells,
  });
}

await fs.writeFile("/tmp/fy2025_tracker_summary.json", JSON.stringify(result, null, 2));
console.log("/tmp/fy2025_tracker_summary.json");

for (const sheetName of ["December 2024", "Oct 2025", "Template"]) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(`/tmp/${sheetName.replaceAll(" ", "_")}.png`, new Uint8Array(await preview.arrayBuffer()));
}
