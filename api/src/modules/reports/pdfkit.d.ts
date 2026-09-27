// pdfkit ships no bundled types and @types/pdfkit is not a dependency of this API (per module
// ownership rules, we avoid adding new npm packages). This local ambient shim just lets us use it
// as `any` without a compile error, matching how it's actually used below (chainable, dynamic API).
declare module 'pdfkit' {
  const PDFDocument: any;
  export = PDFDocument;
}
