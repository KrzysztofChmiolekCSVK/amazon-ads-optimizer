const XLSX = require('xlsx');
const fs = require('fs');
const wb = XLSX.readFile('/Users/krzysztofchmiolek/.gemini/antigravity/scratch/amazon-ads-optimizer/raporty amazon/DE_Search_query_performance_Brand_view_Simple_Month_2026_02_28.csv');
const sheet = wb.Sheets[wb.SheetNames[0]];

// Amazon CSVs often have a weird first row, so if we parse it normally:
let data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
console.log("Row 0 length:", data[0].length, data[0].slice(0, 3));
console.log("Row 1 length:", data[1].length, data[1].slice(0, 3));
console.log("Row 2 length:", data[2].length, data[2].slice(0, 3));
