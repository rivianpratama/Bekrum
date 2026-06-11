import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const SH_C0 = 0.28209479177387814;
const SPLAT_ROW_BYTES = 32;
const MINIMUM_ALPHA = 5;

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.floor(value)));
}

function parseHeader(buffer) {
  const marker = Buffer.from("end_header\n");
  const markerIndex = buffer.indexOf(marker);
  if (markerIndex === -1) throw new Error("PLY end_header marker was not found.");

  const headerSize = markerIndex + marker.length;
  const lines = buffer.subarray(0, headerSize).toString("ascii").trim().split(/\r?\n/);
  if (lines[0] !== "ply" || !lines.includes("format binary_little_endian 1.0")) {
    throw new Error("Only binary_little_endian PLY files are supported.");
  }

  const vertexLine = lines.find((line) => line.startsWith("element vertex "));
  if (!vertexLine) throw new Error("PLY vertex count is missing.");
  const vertexCount = Number(vertexLine.split(/\s+/)[2]);
  const properties = lines
    .filter((line) => line.startsWith("property "))
    .map((line) => line.split(/\s+/)[2]);
  const required = [
    "x",
    "y",
    "z",
    "f_dc_0",
    "f_dc_1",
    "f_dc_2",
    "opacity",
    "scale_0",
    "scale_1",
    "scale_2",
    "rot_0",
    "rot_1",
    "rot_2",
    "rot_3",
  ];
  for (const property of required) {
    if (!properties.includes(property)) throw new Error(`PLY property ${property} is missing.`);
  }

  return { headerSize, vertexCount, properties };
}

function convert(input, header) {
  const bytesPerVertex = header.properties.length * 4;
  const expectedSize = header.headerSize + header.vertexCount * bytesPerVertex;
  if (input.length < expectedSize) throw new Error("PLY vertex data is truncated.");

  const offsets = Object.fromEntries(
    header.properties.map((property, index) => [property, index * 4]),
  );
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const splats = [];

  for (let index = 0; index < header.vertexCount; index += 1) {
    const base = header.headerSize + index * bytesPerVertex;
    const read = (property) => view.getFloat32(base + offsets[property], true);
    const alpha = clampByte((1 / (1 + Math.exp(-read("opacity")))) * 255);
    if (alpha < MINIMUM_ALPHA) continue;

    const scale = [
      Math.exp(read("scale_0")),
      Math.exp(read("scale_1")),
      Math.exp(read("scale_2")),
    ];
    const rotation = [
      read("rot_0"),
      read("rot_1"),
      read("rot_2"),
      read("rot_3"),
    ];
    const rotationLength = Math.hypot(...rotation) || 1;
    for (let component = 0; component < rotation.length; component += 1) {
      rotation[component] /= rotationLength;
    }

    splats.push({
      position: [read("x"), read("y"), read("z")],
      scale,
      color: [
        clampByte((0.5 + SH_C0 * read("f_dc_0")) * 255),
        clampByte((0.5 + SH_C0 * read("f_dc_1")) * 255),
        clampByte((0.5 + SH_C0 * read("f_dc_2")) * 255),
        alpha,
      ],
      rotation,
      importance: scale[0] * scale[1] * scale[2] * alpha,
    });
  }

  splats.sort((left, right) => right.importance - left.importance);
  const output = Buffer.allocUnsafe(splats.length * SPLAT_ROW_BYTES);
  const outputView = new DataView(output.buffer, output.byteOffset, output.byteLength);

  splats.forEach((splat, index) => {
    const base = index * SPLAT_ROW_BYTES;
    splat.position.forEach((value, component) => {
      outputView.setFloat32(base + component * 4, value, true);
    });
    splat.scale.forEach((value, component) => {
      outputView.setFloat32(base + 12 + component * 4, value, true);
    });
    splat.color.forEach((value, component) => {
      output[base + 24 + component] = value;
    });
    const [x, y, z, w] = splat.rotation;
    [w, x, y, z].forEach((value, component) => {
      output[base + 28 + component] = clampByte(value * 128 + 128);
    });
  });

  return { output, splatCount: splats.length };
}

const inputPath = resolve(process.argv[2] ?? "src/assets/enemy.ply");
const outputPath = resolve(process.argv[3] ?? "public/assets/enemy.splat");
const input = await readFile(inputPath);
const header = parseHeader(input);
const { output, splatCount } = convert(input, header);
await writeFile(outputPath, output);

console.log(
  `Converted ${header.vertexCount.toLocaleString()} PLY vertices to ${splatCount.toLocaleString()} splats.`,
);
console.log(`${inputPath}: ${(input.length / 1_048_576).toFixed(2)} MiB`);
console.log(`${outputPath}: ${(output.length / 1_048_576).toFixed(2)} MiB`);
