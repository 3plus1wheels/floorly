import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const path = "/Users/vova_nguyen/Downloads/FY2025 KPI and Sales Tracker.xlsx";
const input = await FileBlob.load(path);
const workbook = await SpreadsheetFile.importXlsx(input);

const overview = await workbook.inspect({
  kind: "workbook,sheet,table,drawing,definedName",
  maxChars: 30000,
  tableMaxRows: 8,
  tableMaxCols: 12,
  tableMaxCellChars: 100,
});
console.log("OVERVIEW");
console.log(overview.ndjson);

const sheets = workbook.worksheets.items;
for (const sheet of sheets) {
  const used = sheet.getUsedRange();
  console.log(`SHEET_META ${JSON.stringify({
    name: sheet.name,
    usedRange: used?.address ?? null,
    rows: used?.rowCount ?? null,
    cols: used?.columnCount ?? null,
    tables: sheet.tables.items.map(t => ({ name: t.name, range: t.getRange?.().address ?? null })),
    charts: sheet.charts.items.map(c => ({ name: c.name, type: c.type, title: c.title?.text ?? null })),
  })}`);

  if (used) {
    const region = await workbook.inspect({
      kind: "region",
      sheetId: sheet.name,
      range: used.address,
      maxChars: 18000,
      tableMaxRows: 30,
      tableMaxCols: 18,
      tableMaxCellChars: 120,
    });
    console.log(`REGION ${sheet.name}`);
    console.log(region.ndjson);

    const formulas = await workbook.inspect({
      kind: "formula",
      sheetId: sheet.name,
      range: used.address,
      maxChars: 14000,
      options: { maxResults: 250 },
    });
    console.log(`FORMULAS ${sheet.name}`);
    console.log(formulas.ndjson);
  }
}
