// Capture a DOM element as an A4 PDF and return the jsPDF object (multi-page aware)
async function buildPdf(element) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  // Documents are always captured in LIGHT theme, even when the app is dark
  const hadDark = document.documentElement.classList.contains('dark');
  if (hadDark) document.documentElement.classList.remove('dark');
  let canvas;
  try {
    canvas = await html2canvas(element, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  } finally {
    if (hadDark) document.documentElement.classList.add('dark');
  }
  const img = canvas.toDataURL('image/jpeg', 0.95);

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageW = 210;
  const pageH = 297;
  const imgH = (canvas.height * pageW) / canvas.width;

  // 8mm tolerance: content that is "A4 plus a hair" (rounding) must NOT
  // create an empty second page
  const TOLERANCE = 8;
  if (imgH <= pageH + TOLERANCE) {
    pdf.addImage(img, 'JPEG', 0, 0, pageW, Math.min(imgH, pageH));
  } else {
    let remaining = imgH;
    let offset = 0;
    while (remaining > TOLERANCE) {
      pdf.addImage(img, 'JPEG', 0, -offset, pageW, imgH);
      remaining -= pageH;
      offset += pageH;
      if (remaining > TOLERANCE) pdf.addPage();
    }
  }
  return pdf;
}

// Download the PDF as a file
export async function elementToPdf(element, filename) {
  const pdf = await buildPdf(element);
  pdf.save(filename);
}

// Return the PDF as a Blob (for sharing via WhatsApp / Web Share API)
export async function elementToPdfBlob(element) {
  const pdf = await buildPdf(element);
  return pdf.output('blob');
}
