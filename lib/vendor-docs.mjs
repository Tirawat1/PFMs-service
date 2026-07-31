// Appends the currently-configured vendor-registration documents to a request's
// existing docs array, skipping any name already present so re-answering the vendor
// question never duplicates checklist entries. Pure — returns a new array, never
// mutates `existingDocs`.
export function addVendorDocs(existingDocs, vendorDocNames) {
  const present = new Set(existingDocs.map((d) => d.name));
  const additions = vendorDocNames
    .filter((name) => !present.has(name))
    .map((name) => ({ name, submitted: false, link: null, fileName: null, disc: null, vendorDoc: true }));
  return [...existingDocs, ...additions];
}
