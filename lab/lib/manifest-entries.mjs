// All byte-bearing entries participate in recovery and the aggregate Merkle root.
export const manifestEntries=manifest=>[...manifest.files,...(manifest.originalArchive?[manifest.originalArchive]:[])];
