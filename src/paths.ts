import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Compiled src files live in dist/src, with resources at the package root.
export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const charterPath = resolve(packageRoot, "prompts/research-charter.md");
export const skillsPath = resolve(packageRoot, "skills");
export const extensionPath = resolve(packageRoot, "dist/extensions/research.js");
