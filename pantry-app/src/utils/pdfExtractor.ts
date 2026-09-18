import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure the worker URL
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export interface ExtractedPdf {
  text: string;
  numPages: number;
}

export async function extractTextFromPdf(file: File): Promise<ExtractedPdf> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useSystemFonts: true,
  });

  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;
  const pageTexts: string[] = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    
    let lastY: number | null = null;
    let pageStr = '';

    for (const item of textContent.items as any[]) {
      if (!('str' in item)) continue;
      const text = item.str;
      if (!text) continue;

      if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
        pageStr += '\n';
      } else if (pageStr.length > 0 && !pageStr.endsWith(' ') && !pageStr.endsWith('\n')) {
        pageStr += ' ';
      }
      pageStr += text;
      lastY = item.transform[5];
    }

    const trimmedPage = pageStr.trim();
    if (trimmedPage) {
      if (numPages > 1) {
        pageTexts.push(`--- Page ${pageNum} of ${numPages} ---\n${trimmedPage}`);
      } else {
        pageTexts.push(trimmedPage);
      }
    }
  }

  const combinedText = pageTexts.join('\n\n').trim();

  return {
    text: combinedText || '[No text could be extracted from this PDF. It may be a scanned image.]',
    numPages,
  };
}
