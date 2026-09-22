// Exporters: binary STL (one per color) and a multi-part 3MF with
// basematerial colors so slicers (Bambu Studio, PrusaSlicer, Cura)
// can assign a filament per color part.

import JSZip from "jszip";
import { rgbToHex, type RGB } from "./quantize";

export interface ExportPart {
  name: string;
  color: RGB;
  /** Flat triangle soup: 9 numbers per triangle. */
  positions: number[];
}

function fmt(n: number): string {
  return String(Number(n.toFixed(4)));
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeFileName(s: string): string {
  return s.replace(/[^a-z0-9\-_()#]+/gi, "_");
}

// ---------------------------------------------------------------- STL

export function buildSTL(positions: number[]): ArrayBuffer {
  const triCount = Math.floor(positions.length / 9);
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buffer);
  dv.setUint32(80, triCount, true);
  let off = 84;

  for (let t = 0; t < triCount; t++) {
    const i = t * 9;
    const ax = positions[i],
      ay = positions[i + 1],
      az = positions[i + 2];
    const bx = positions[i + 3],
      by = positions[i + 4],
      bz = positions[i + 5];
    const cx = positions[i + 6],
      cy = positions[i + 7],
      cz = positions[i + 8];

    const ux = bx - ax,
      uy = by - ay,
      uz = bz - az;
    const vx = cx - ax,
      vy = cy - ay,
      vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    dv.setFloat32(off, nx, true);
    dv.setFloat32(off + 4, ny, true);
    dv.setFloat32(off + 8, nz, true);
    dv.setFloat32(off + 12, ax, true);
    dv.setFloat32(off + 16, ay, true);
    dv.setFloat32(off + 20, az, true);
    dv.setFloat32(off + 24, bx, true);
    dv.setFloat32(off + 28, by, true);
    dv.setFloat32(off + 32, bz, true);
    dv.setFloat32(off + 36, cx, true);
    dv.setFloat32(off + 40, cy, true);
    dv.setFloat32(off + 44, cz, true);
    dv.setUint16(off + 48, 0, true);
    off += 50;
  }
  return buffer;
}

export async function buildSTLZip(parts: ExportPart[]): Promise<Blob> {
  const zip = new JSZip();
  let n = 0;
  for (const p of parts) {
    if (p.positions.length === 0) continue;
    n++;
    zip.file(`${sanitizeFileName(p.name)}.stl`, buildSTL(p.positions));
  }
  if (n === 0) throw new Error("Nothing to export");
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}

// ---------------------------------------------------------------- 3MF

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

/** Build <mesh> XML with vertex de-duplication to keep the file small. */
function meshXml(positions: number[]): string {
  const index = new Map<string, number>();
  const verts: string[] = [];
  const tris: string[] = [];

  const vid = (x: number, y: number, z: number): number => {
    const key = x.toFixed(3) + "," + y.toFixed(3) + "," + z.toFixed(3);
    let i = index.get(key);
    if (i === undefined) {
      i = index.size;
      index.set(key, i);
      verts.push(`<vertex x="${fmt(x)}" y="${fmt(y)}" z="${fmt(z)}"/>`);
    }
    return i;
  };

  for (let t = 0; t + 8 < positions.length; t += 9) {
    const a = vid(positions[t], positions[t + 1], positions[t + 2]);
    const b = vid(positions[t + 3], positions[t + 4], positions[t + 5]);
    const c = vid(positions[t + 6], positions[t + 7], positions[t + 8]);
    tris.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  }

  return `<mesh><vertices>${verts.join("")}</vertices><triangles>${tris.join(
    ""
  )}</triangles></mesh>`;
}

export function build3MFModelXml(parts: ExportPart[]): string {
  // m:colorgroup (3MF materials extension): Bambu Studio parses these and
  // auto-assigns each unique color to its own extruder. PrusaSlicer/Cura
  // read colorgroups too.
  const colors = parts
    .map((p) => `      <m:color color="${rgbToHex(p.color).toUpperCase()}FF"/>`)
    .join("\n");

  const objects = parts
    .map(
      (p, i) => `    <object id="${i + 2}" type="model" name="${escapeXml(
        p.name
      )}" pid="1" pindex="${i}">
      ${meshXml(p.positions)}
    </object>`
    )
    .join("\n");

  const items = parts
    .map((_, i) => `    <item objectid="${i + 2}"/>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
  <metadata name="Title">4-color image print</metadata>
  <metadata name="Application">image-to-4color-3dprint</metadata>
  <resources>
    <m:colorgroup id="1">
${colors}
    </m:colorgroup>
${objects}
  </resources>
  <build>
${items}
  </build>
</model>`;
}

/**
 * Bambu-Studio-style Metadata/model_settings.config: assigns each object
 * (and its single part) an extruder, 1-based, in part order.
 */
export function buildModelSettingsXml(parts: ExportPart[]): string {
  const objects = parts
    .map((p, i) => {
      const id = i + 2;
      const extruder = i + 1;
      const name = escapeXml(p.name);
      return `  <object id="${id}">
    <metadata key="name" value="${name}"/>
    <metadata key="extruder" value="${extruder}"/>
    <part id="${id}" subtype="normal_part">
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="name" value="${name}"/>
      <metadata key="extruder" value="${extruder}"/>
    </part>
  </object>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
${objects}
</config>
`;
}

/**
 * Minimal Bambu-Studio-style Metadata/project_settings.config.
 *
 * Bambu Studio's project-config validity check (check_project_config in
 * Plater.cpp) requires a nozzle_diameter entry per extruder and, for
 * multi-extruder configs, an extruder_type array of the same size —
 * otherwise it shows "The 3mf file has invalid config" and refuses to load
 * the config (including the filament colors). filament_colour is also
 * mandatory when the config is applied (load_config_file_config throws
 * without it). Unknown/absent keys safely fall back to defaults.
 */
export function buildProjectSettingsJson(parts: ExportPart[]): string {
  const n = parts.length;
  return JSON.stringify(
    {
      name: "project_settings",
      from: "project",
      version: "2.0.0.0",
      nozzle_diameter: Array(n).fill("0.4"),
      extruder_type: Array(n).fill("Bowden"),
      filament_colour: parts.map((p) => rgbToHex(p.color).toUpperCase()),
      filament_type: parts.map(() => "PLA"),
    },
    null,
    4
  );
}

export async function build3MF(parts: ExportPart[]): Promise<Blob> {
  const usable = parts.filter((p) => p.positions.length > 0);
  if (usable.length === 0) throw new Error("Nothing to export");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES_XML);
  zip.folder("_rels")!.file(".rels", RELS_XML);
  zip.folder("3D")!.file("3dmodel.model", build3MFModelXml(usable));
  // Bambu Studio metadata: extruder assignment per part + filament colors.
  // Ignored by other slicers; non-fatal in Bambu if anything is off.
  zip.folder("Metadata")!.file("model_settings.config", buildModelSettingsXml(usable));
  zip.folder("Metadata")!.file("project_settings.config", buildProjectSettingsJson(usable));
  return zip.generateAsync({
    type: "blob",
    mimeType: "model/3mf",
    compression: "DEFLATE",
  });
}
