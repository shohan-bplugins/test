export function isValidModelFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".glb") || lower.endsWith(".gltf");
}
