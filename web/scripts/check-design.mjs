import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const source = resolve(import.meta.dirname, "../src");
const tokenFile = join(source, "design-tokens.css");
const styleFile = join(source, "styles.css");
const files = readdirSync(source)
  .filter((name) => /\.(css|tsx)$/.test(name))
  .map((name) => join(source, name));
const definitions = new Set();
const uses = new Set();
const violations = [];

for (const file of files) {
  const content = readFileSync(file, "utf8");
  for (const match of content.matchAll(/(^|\n)\s*(--[\w-]+)\s*:/g)) definitions.add(match[2]);
  for (const match of content.matchAll(/var\(\s*(--[\w-]+)/g)) uses.add(match[1]);
  if (file !== tokenFile) {
    const rawColors = [...content.matchAll(/#[\da-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\s*\(/g)];
    if (rawColors.length) violations.push(`${file}: ${rawColors.length} direct color values`);
  }
}

const missing = [...uses].filter((name) => !definitions.has(name)).sort();
if (missing.length) violations.push(`Undefined design tokens: ${missing.join(", ")}`);
const unused = [...definitions].filter((name) => !uses.has(name)).sort();
if (unused.length) violations.push(`Unused design tokens: ${unused.join(", ")}`);

// Screen styles use semantic roles; keep direct palette coupling at zero.
const legacyPaletteBudget = 0;
const legacyPaletteDefinitions = [...readFileSync(tokenFile, "utf8").matchAll(/(^|\n)\s*--palette-[\w-]+\s*:/g)].length;
const legacyPaletteUses = [...readFileSync(styleFile, "utf8").matchAll(/var\(--palette-/g)].length;
const composedShadowTokens = [...readFileSync(styleFile, "utf8").matchAll(/box-shadow\s*:\s*([^;]*var\(--shadow-[\w-]+[^;]*);/g)]
  .map((match) => match[1].trim())
  .filter((value) => !/^var\(--shadow-[\w-]+\)$/.test(value));
if (legacyPaletteDefinitions) {
  violations.push(`Legacy palette definitions: ${legacyPaletteDefinitions} > 0`);
}
if (legacyPaletteUses > legacyPaletteBudget) {
  violations.push(`Legacy palette uses: ${legacyPaletteUses} > ${legacyPaletteBudget}`);
}
if (composedShadowTokens.length) {
  violations.push(`Full shadow tokens cannot be composed with extra lengths: ${composedShadowTokens.join(", ")}`);
}

if (violations.length) {
  for (const violation of violations) console.error(violation);
  process.exitCode = 1;
} else {
  console.log(`Design contract: ${uses.size} tokens resolved; ${legacyPaletteDefinitions} palette definitions; ${legacyPaletteUses} legacy palette uses (budget ${legacyPaletteBudget}).`);
}
