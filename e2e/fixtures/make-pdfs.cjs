// Regenerates the PDF fixtures (plain one-page text PDFs, no dependencies).
// The .wav/.png fixtures were made with Windows' System.Speech / System.Drawing.
const fs = require("node:fs");
const path = require("node:path");

function pdf(lines) {
  const esc = (s) => s.replace(/[()\\]/g, (c) => "\\" + c);
  const content = "BT /F1 18 Tf 50 750 Td 24 TL " + lines.map((l) => `(${esc(l)}) Tj T*`).join(" ") + " ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

const dir = __dirname;
fs.writeFileSync(
  path.join(dir, "receipt.pdf"),
  pdf([
    "PAYMENT RECEIPT",
    "Kopi Corner Sdn Bhd",
    "Receipt no: R-7781",
    "Date: 14 Oct 2026",
    "1 x Nasi Lemak Special   RM 15.00",
    "2 x Teh Tarik           RM 9.00",
    "Total paid: RM 24.00",
    "Customer note: please refund, food was cold",
  ]),
);
fs.writeFileSync(path.join(dir, "menu.pdf"), pdf(["KOPI CORNER MENU", "Latte RM 9.50", "Teh Tarik RM 4.50", "Nasi Lemak Special RM 15.00", "Kaya Toast Set RM 7.90"]));
console.log("wrote receipt.pdf, menu.pdf");
