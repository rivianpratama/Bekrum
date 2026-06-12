import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const SPLAT_ROW_BYTES = 32;
const argumentsList = process.argv.slice(2);
const maxIndex = argumentsList.indexOf("--max-splats");
if (maxIndex < 0 || !argumentsList[maxIndex + 1]) {
  throw new Error("Usage: node scripts/downsample-splat.mjs --max-splats N <file-or-directory>");
}

const maxSplats = Number(argumentsList[maxIndex + 1]);
if (!Number.isInteger(maxSplats) || maxSplats <= 0) {
  throw new Error("--max-splats must be a positive integer.");
}

const targetArgument = argumentsList.find(
  (argument, index) =>
    index !== maxIndex &&
    index !== maxIndex + 1 &&
    !argument.startsWith("--"),
);
if (!targetArgument) throw new Error("A .splat file or directory is required.");

const targetPath = resolve(targetArgument);
const targetStat = await stat(targetPath);
const paths = targetStat.isDirectory()
  ? (await readdir(targetPath))
      .filter((name) => name.endsWith(".splat"))
      .sort()
      .map((name) => resolve(targetPath, name))
  : [targetPath];

for (const path of paths) {
  const input = await readFile(path);
  if (input.length % SPLAT_ROW_BYTES !== 0) {
    throw new Error(`${path} is not a valid row-aligned .splat file.`);
  }
  const currentSplats = input.length / SPLAT_ROW_BYTES;
  const keptSplats = Math.min(currentSplats, maxSplats);
  if (keptSplats < currentSplats) {
    await writeFile(path, input.subarray(0, keptSplats * SPLAT_ROW_BYTES));
  }
  console.log(`${path}: ${currentSplats.toLocaleString()} -> ${keptSplats.toLocaleString()} splats`);
}
