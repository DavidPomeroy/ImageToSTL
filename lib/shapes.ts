// Shape masks and borders for the printed plate.
//
// Shapes are defined in unit space centered at the origin (roughly [-1, 1]),
// with +Y up. Pixel tests convert image pixel coordinates into unit space
// (image row 0 is the top, so world/unit Y is flipped).

export type ShapeType =
  | "rectangle"
  | "square"
  | "triangle"
  | "hexagon"
  | "circle"
  | "heart"
  | "star"
  | "diamond"
  | "cross"
  | "tree"
  | "snowflake"
  | "stocking"
  | "bell"
  | "gingerbread-man"
  | "gingerbread-woman"
  | "pumpkin"
  | "ghost"
  | "bat"
  | "leaf"
  | "maple"
  | "acorn"
  | "egg"
  | "bunny"
  | "flower"
  | "tulip"
  | "butterfly"
  | "sun"
  | "shell"
  | "starfish"
  | "shamrock"
  | "moon"
  | "custom";

export type ShapeCategory =
  | "standard"
  | "christmas"
  | "halloween"
  | "autumn"
  | "easter"
  | "spring"
  | "summer"
  | "occasions";

export const SHAPE_CATEGORIES: {
  id: ShapeCategory;
  label: string;
  shapes: { type: ShapeType; label: string }[];
}[] = [
  {
    id: "standard",
    label: "Standard",
    shapes: [
      { type: "square", label: "Square" },
      { type: "triangle", label: "Triangle" },
      { type: "hexagon", label: "Hexagon" },
      { type: "circle", label: "Circle" },
      { type: "heart", label: "Heart" },
      { type: "star", label: "Star" },
      { type: "diamond", label: "Diamond" },
      { type: "cross", label: "Cross" },
    ],
  },
  {
    id: "christmas",
    label: "Christmas",
    shapes: [
      { type: "tree", label: "Tree" },
      { type: "snowflake", label: "Snowflake" },
      { type: "stocking", label: "Stocking" },
      { type: "bell", label: "Bell" },
      { type: "gingerbread-man", label: "Gingerbread man" },
      { type: "gingerbread-woman", label: "Gingerbread woman" },
    ],
  },
  {
    id: "halloween",
    label: "Halloween",
    shapes: [
      { type: "pumpkin", label: "Pumpkin" },
      { type: "ghost", label: "Ghost" },
      { type: "bat", label: "Bat" },
    ],
  },
  {
    id: "autumn",
    label: "Autumn",
    shapes: [
      { type: "leaf", label: "Leaf" },
      { type: "maple", label: "Maple leaf" },
      { type: "acorn", label: "Acorn" },
    ],
  },
  {
    id: "easter",
    label: "Easter",
    shapes: [
      { type: "egg", label: "Egg" },
      { type: "bunny", label: "Bunny" },
    ],
  },
  {
    id: "spring",
    label: "Spring",
    shapes: [
      { type: "flower", label: "Flower" },
      { type: "tulip", label: "Tulip" },
      { type: "butterfly", label: "Butterfly" },
      { type: "shamrock", label: "Shamrock" },
    ],
  },
  {
    id: "summer",
    label: "Summer",
    shapes: [
      { type: "sun", label: "Sun" },
      { type: "shell", label: "Shell" },
      { type: "starfish", label: "Starfish" },
    ],
  },
  {
    id: "occasions",
    label: "Occasions",
    shapes: [{ type: "moon", label: "Moon" }],
  },
];

/** Category a shape belongs to (rectangle/custom return null — always shown). */
export function shapeCategoryOf(type: ShapeType): ShapeCategory | null {
  for (const cat of SHAPE_CATEGORIES) {
    if (cat.shapes.some((s) => s.type === type)) return cat.id;
  }
  return null;
}

export interface ShapeParams {
  type: ShapeType;
  /** Center x, normalized 0..1 across the image (0 = left). */
  cx: number;
  /** Center y, normalized 0..1 down the image (0 = top). */
  cy: number;
  /** Shape span as a fraction of the image's smaller dimension (0.05..1.5). */
  size: number;
  /**
   * Custom crop width as a fraction of the image width (0..1).
   * Only used when type === "custom".
   */
  w?: number;
  /**
   * Custom crop height as a fraction of the image height (0..1).
   * Only used when type === "custom".
   */
  h?: number;
}

/**
 * Explicit polygon vertices (unit space, +Y up, centered) or null for shapes
 * with cheap direct tests (rectangle, circle, square, custom).
 */
export function shapePolygon(
  type: Exclude<ShapeType, "custom">
): [number, number][] | null {
  const pts: [number, number][] = [];
  switch (type) {
    case "triangle": {
      // equilateral triangle, point up
      for (let k = 0; k < 3; k++) {
        const a = Math.PI / 2 + (k * 2 * Math.PI) / 3;
        pts.push([Math.cos(a), Math.sin(a)]);
      }
      return pts;
    }
    case "hexagon": {
      // regular hexagon, pointy left/right (flat top/bottom)
      for (let k = 0; k < 6; k++) {
        const a = k * (Math.PI / 3);
        pts.push([Math.cos(a), Math.sin(a)]);
      }
      return pts;
    }
    case "star": {
      // regular 5-point star, point up
      for (let k = 0; k < 10; k++) {
        const outer = k % 2 === 0;
        const a = Math.PI / 2 + (k * Math.PI) / 5;
        const r = outer ? 1 : 0.42;
        pts.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      return pts;
    }
    case "diamond": {
      // faceted gem: wide top edge, pointed bottom
      return [
        [-0.55, 0.55],
        [0.55, 0.55],
        [1, 0.1],
        [0, -1],
        [-1, 0.1],
      ] as [number, number][];
    }
    case "cross": {
      // plus sign, chunky arms
      const a = 0.28;
      return [
        [-a, 1],
        [a, 1],
        [a, a],
        [1, a],
        [1, -a],
        [a, -a],
        [a, -1],
        [-a, -1],
        [-a, -a],
        [-1, -a],
        [-1, a],
        [-a, a],
      ] as [number, number][];
    }
    case "tree":
      // layered christmas tree: three tiers of rounded base corners over a
      // flat-bottomed trunk
      return treeOutline();
    case "snowflake":
      // 6-armed coloring-page snowflake: solid silhouette measured from
      // Pictures/Shapes/snowflake.jpg. Each 60-degree sector holds 10 corners
      // (60 vertices total): a wide diamond main-arm tip, a stem notch, a
      // deep valley, a pointed side branch at +/-30 deg, and the next arm's
      // diamond edge. The polar radii/angles below are sector averages of
      // segmented RDP fits of the traced outer boundary (center (324.5,406),
      // tip radius 326.5 px); sector k is rotated by k*60 deg with the top
      // tip at +Y. Kept solid (the reference's small center star is omitted)
      // so the outline carves no holes.
      return snowflakeOutline();
    case "stocking": {
      // christmas stocking: ONE continuous outer silhouette — a wide folded
      // cuff, a gently tapering leg and a heel-to-toe foot pointing right.
      // The cuff is part of the same loop (there is no separate inner cuff
      // edge), so the outline never doubles back across the leg; only the
      // cuff's two overhangs sit on the cuff bottom line. All corners are
      // rounded and the toe / heel are true arcs.
      const pts: [number, number][] = [];
      const arc = (
        cx: number,
        cy: number,
        r: number,
        a0: number,
        a1: number,
        n: number
      ) => {
        for (let k = 0; k <= n; k++) {
          const a = a0 + ((a1 - a0) * k) / n;
          pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
      };
      const bez = (
        p0: [number, number],
        p1: [number, number],
        p2: [number, number],
        p3: [number, number],
        n: number
      ) => {
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          const u = 1 - t;
          pts.push([
            u * u * u * p0[0] +
              3 * u * u * t * p1[0] +
              3 * u * t * t * p2[0] +
              t * t * t * p3[0],
            u * u * u * p0[1] +
              3 * u * u * t * p1[1] +
              3 * u * t * t * p2[1] +
              t * t * t * p3[1],
          ]);
        }
      };
      // rounded corner: cut the corner at `p` with a quadratic bezier, so the
      // outline enters from `prev` and leaves towards `next` without a kink
      const corner = (
        prev: [number, number],
        p: [number, number],
        next: [number, number],
        d: number,
        n = 5
      ) => {
        const ua = Math.hypot(prev[0] - p[0], prev[1] - p[1]) || 1;
        const ub = Math.hypot(next[0] - p[0], next[1] - p[1]) || 1;
        const da = Math.min(d, ua * 0.45);
        const db = Math.min(d, ub * 0.45);
        const s: [number, number] = [
          p[0] + ((prev[0] - p[0]) / ua) * da,
          p[1] + ((prev[1] - p[1]) / ua) * da,
        ];
        const e: [number, number] = [
          p[0] + ((next[0] - p[0]) / ub) * db,
          p[1] + ((next[1] - p[1]) / ub) * db,
        ];
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          const u = 1 - t;
          pts.push([
            u * u * s[0] + 2 * u * t * p[0] + t * t * e[0],
            u * u * s[1] + 2 * u * t * p[1] + t * t * e[1],
          ]);
        }
      };
      // cuff (wider than the leg, top edge tipped a touch) and the leg it
      // sits on: the leg's top edge is hidden under the cuff, so it never
      // appears in the outline
      const cuffBL: [number, number] = [-0.68, 0.64];
      const cuffBR: [number, number] = [0.52, 0.64];
      const cuffTR: [number, number] = [0.52, 0.9];
      const cuffTL: [number, number] = [-0.68, 0.95];
      const legBackTop: [number, number] = [-0.46, 0.64];
      const legFrontTop: [number, number] = [0.32, 0.64];
      const ankle: [number, number] = [0.26, -0.08];
      const toeCx = 0.58;
      const toeCy = -0.6;
      const toeR = 0.26;
      const toeA = Math.PI / 2; // the instep joins the toe at its very top
      const toe: [number, number] = [
        toeCx + toeR * Math.cos(toeA),
        toeCy + toeR * Math.sin(toeA),
      ];
      const soleEnd: [number, number] = [toeCx, toeCy - toeR];
      const heelCx = -0.42;
      const heelCy = -0.6;
      const heelR = 0.26;
      const heel: [number, number] = [heelCx - heelR, heelCy];
      // start where the back of the leg meets the cuff, then walk the cuff
      // (left overhang, left edge, top, right edge, right overhang)
      corner(legBackTop, cuffBL, cuffTL, 0.1);
      corner(cuffBL, cuffTL, cuffTR, 0.1);
      corner(cuffTL, cuffTR, cuffBR, 0.1);
      corner(cuffTR, cuffBR, legFrontTop, 0.1);
      // --- leg front: gentle inward taper to the ankle ---
      bez(legFrontTop, [0.33, 0.4], [0.28, 0.14], ankle, 8);
      // --- ankle into instep: smooth S-curve out to the toe bulb ---
      bez(ankle, [0.26, -0.22], [0.45, -0.34], toe, 8);
      // --- toe: round the front and under to the sole ---
      arc(toeCx, toeCy, toeR, toeA, -Math.PI / 2, 8);
      // --- sole: soft wave back to the heel ---
      bez(soleEnd, [0.26, -0.9], [-0.04, -0.9], [heelCx, heelCy - heelR], 8);
      // --- heel: full round turn up the back of the leg ---
      arc(heelCx, heelCy, heelR, -Math.PI / 2, -Math.PI, 8);
      // --- back of leg: long smooth line back up to the cuff ---
      bez(heel, [-0.63, -0.15], [-0.55, 0.3], legBackTop, 8);
      return pts;
    }
    case "bell": {
      // Christmas bell: a domed body flaring out to a flat rim, a small arched
      // knob spliced into the dome on top (the dome is interrupted at the
      // knob's feet, so the outline never doubles back), and a semicircular
      // clapper hanging below the rim. Every vertex stays within [-1, 1] so
      // nothing is clipped: unit space maps exactly onto the plate.
      const pts: [number, number][] = [
        // knob: down its right side from the top
        [0, 0.95],
        [0.13, 0.91],
        [0.19, 0.84],
        [0.2, 0.77], // knob's right foot, meeting the dome
        // dome, then the right wall of the body flaring down to the rim
        [0.31, 0.74],
        [0.43, 0.66],
        [0.53, 0.54],
        [0.6, 0.36],
        [0.65, 0.14],
        [0.69, -0.1],
        [0.73, -0.34],
        [0.76, -0.52],
        [0.77, -0.6], // body meets the rim (right)
        // rim: right end, rounded
        [0.83, -0.61],
        [0.86, -0.66],
        [0.85, -0.71],
        [0.8, -0.73], // rim bottom-right
        // rim underside across to the clapper
        [0.24, -0.73],
        // clapper: a semicircle bulging below the rim
        [0.22, -0.8],
        [0.17, -0.9],
        [0.09, -0.97],
        [0, -1],
        [-0.09, -0.97],
        [-0.17, -0.9],
        [-0.22, -0.8],
        [-0.24, -0.73],
        // rim underside to its left end
        [-0.8, -0.73],
        [-0.85, -0.71],
        [-0.86, -0.66],
        [-0.83, -0.61],
        [-0.77, -0.6], // body meets the rim (left)
        // left wall of the body, rising and narrowing into the dome
        [-0.76, -0.52],
        [-0.73, -0.34],
        [-0.69, -0.1],
        [-0.65, 0.14],
        [-0.6, 0.36],
        [-0.53, 0.54],
        [-0.43, 0.66],
        [-0.31, 0.74],
        [-0.2, 0.77], // knob's left foot
        // knob: up its left side to the top
        [-0.19, 0.84],
        [-0.13, 0.91],
      ];
      return pts;
    }
    case "gingerbread-man": {
      // gingerbread man (template top-left): big round head, stubby arms
      // angled slightly upward, two rounded legs with a V crotch notch.
      return gingerbreadBody(false);
    }
    case "gingerbread-woman": {
      // gingerbread woman (template top-right): same head and arms as the
      // man, but a flared dress instead of legs, with two short rounded
      // legs peeking out below the hem.
      return gingerbreadBody(true);
    }
    case "pumpkin":
      // halloween pumpkin: ribbed body with a curling stem
      return pumpkinOutline();
    case "ghost":
      // halloween ghost: dome head, outstretched wavy arms, wavy tail
      return ghostOutline();
    case "bat": {
      // halloween bat: pointed ears, scalloped wings, notched tail
      const pts: [number, number][] = [];
      // head with ears (left to right over the top)
      pts.push(
        [-0.28, 0.15],
        [-0.3, 0.55],
        [-0.14, 0.35],
        [0, 0.42],
        [0.14, 0.35],
        [0.3, 0.55],
        [0.28, 0.15]
      );
      // right wing: out to tip, scalloped back to the body
      pts.push([0.6, 0.3], [1, 0.45], [0.85, 0.05], [0.95, -0.15], [0.6, -0.2], [0.55, -0.45], [0.3, -0.3]);
      // tail notch
      pts.push([0.12, -0.5], [0, -0.35], [-0.12, -0.5]);
      // left wing mirrored
      pts.push([-0.3, -0.3], [-0.55, -0.45], [-0.6, -0.2], [-0.95, -0.15], [-0.85, 0.05], [-1, 0.45], [-0.6, 0.3]);
      return pts;
    }
    case "leaf": {
      // Simple pointed (ovate) leaf with a short stem, traced from the
      // reference image leaf.png (repo root): a single smooth outline — the
      // central vein and side veins in the reference are interior lines and
      // are not part of the silhouette. RDP-simplified outer contour, 38
      // vertices, listed clockwise in unit space from the tip.
      return [
        [0.1288, 1.0],
        [0.1717, 0.9957],
        [0.2189, 0.9442],
        [0.2704, 0.8584],
        [0.412, 0.6652],
        [0.5322, 0.4506],
        [0.5794, 0.3391],
        [0.6223, 0.1803],
        [0.6395, 0.03],
        [0.6352, -0.1159],
        [0.6094, -0.2361],
        [0.5794, -0.3176],
        [0.5193, -0.4292],
        [0.4721, -0.4936],
        [0.382, -0.5837],
        [0.2833, -0.6524],
        [0.1288, -0.721],
        [-0.0558, -0.7682],
        [-0.0601, -0.9828],
        [-0.0773, -1.0],
        [-0.103, -1.0],
        [-0.1202, -0.9742],
        [-0.1159, -0.7597],
        [-0.2446, -0.6996],
        [-0.3863, -0.6052],
        [-0.4893, -0.5021],
        [-0.5536, -0.4077],
        [-0.5966, -0.3176],
        [-0.6309, -0.1931],
        [-0.6395, -0.133],
        [-0.6352, 0.0429],
        [-0.6137, 0.1373],
        [-0.5751, 0.2403],
        [-0.5107, 0.3562],
        [-0.4378, 0.4592],
        [-0.3691, 0.5408],
        [-0.2146, 0.6953],
        [-0.0215, 0.8584],
      ] as [number, number][];
    }
    case "maple": {
      // Classic 5-lobed maple leaf with a stem, traced from the reference
      // image maple.webp (repo root; the reference is already a flat silhouette
      // outline). RDP-simplified outer contour, 60 vertices: the central lobe
      // and tip, the two upper side lobes with their deep notches, the two
      // lower lobes, and the centre-bottom stem. Listed clockwise in unit
      // space from the tip.
      return [
        [-0.0035, 1.0],
        [0.0035, 1.0],
        [0.1809, 0.6661],
        [0.2157, 0.6557],
        [0.3513, 0.7217],
        [0.2922, 0.3043],
        [0.2957, 0.2487],
        [0.313, 0.2487],
        [0.3409, 0.2661],
        [0.5461, 0.44],
        [0.5635, 0.367],
        [0.5809, 0.3496],
        [0.6574, 0.3565],
        [0.8522, 0.3983],
        [0.7409, 0.0678],
        [0.7617, 0.033],
        [0.8383, -0.0087],
        [0.8417, -0.0191],
        [0.5148, -0.273],
        [0.5113, -0.2904],
        [0.5287, -0.3287],
        [0.64, -0.4609],
        [0.313, -0.4817],
        [0.2922, -0.5026],
        [0.2817, -0.5617],
        [0.0243, -0.4296],
        [0.0139, -0.7113],
        [-0.007, -0.8991],
        [-0.0278, -0.9896],
        [-0.0591, -1.0],
        [-0.087, -0.9826],
        [-0.087, -0.9617],
        [-0.0626, -0.8678],
        [-0.0313, -0.6661],
        [-0.0209, -0.4296],
        [-0.2748, -0.5583],
        [-0.2852, -0.5583],
        [-0.2957, -0.4957],
        [-0.313, -0.4817],
        [-0.6365, -0.4643],
        [-0.6365, -0.4504],
        [-0.5252, -0.3252],
        [-0.5113, -0.28],
        [-0.5357, -0.2522],
        [-0.8417, -0.0191],
        [-0.8313, -0.0052],
        [-0.7652, 0.0296],
        [-0.7409, 0.0643],
        [-0.8522, 0.3983],
        [-0.6226, 0.3496],
        [-0.5809, 0.3496],
        [-0.5635, 0.367],
        [-0.5461, 0.4435],
        [-0.3409, 0.2661],
        [-0.313, 0.2487],
        [-0.2957, 0.2487],
        [-0.2922, 0.3043],
        [-0.3478, 0.7217],
        [-0.2261, 0.6591],
        [-0.1809, 0.6661],
      ] as [number, number][];
    }
    case "acorn": {
      // Acorn: a tapering nut below a wide, overhanging cap, with a short
      // stalked stem on top leaning to the right. The cap's rim tucks back in
      // over the nut (the silhouette has a small undercut, exactly as the
      // reference does). Every vertex stays within [-1, 1].
      const pts: [number, number][] = [
        // stem: down its right side from the tip
        [0.02, 0.96],
        [0.09, 0.94],
        [0.12, 0.87],
        [0.11, 0.8],
        [0.1, 0.72], // stem's right foot, meeting the cap
        // cap: right of the stem, swelling out and down over the rim
        [0.2, 0.69],
        [0.34, 0.67],
        [0.47, 0.6],
        [0.58, 0.48],
        [0.67, 0.33],
        [0.72, 0.17],
        [0.74, 0.03], // cap's widest, at the right rim
        [0.72, -0.05], // cap rim's bottom-right
        // the cap overhangs the nut, so the outline tucks back in
        [0.55, -0.07],
        [0.49, -0.16], // nut's right shoulder
        // nut: tapering down to a rounded tip
        [0.48, -0.32],
        [0.44, -0.5],
        [0.37, -0.66],
        [0.27, -0.81],
        [0.15, -0.92],
        [0.05, -0.99],
        [0, -1], // nut tip
        [-0.05, -0.99],
        [-0.15, -0.92],
        [-0.27, -0.81],
        [-0.37, -0.66],
        [-0.44, -0.5],
        [-0.48, -0.32],
        [-0.49, -0.16], // nut's left shoulder
        [-0.55, -0.07],
        [-0.72, -0.05], // cap rim's bottom-left
        [-0.74, 0.03], // cap's widest, at the left rim
        [-0.72, 0.17],
        [-0.67, 0.33],
        [-0.58, 0.48],
        [-0.47, 0.6],
        [-0.34, 0.67],
        [-0.2, 0.69],
        // stem: up its left side to the tip
        [-0.06, 0.72], // stem's left foot
        [-0.07, 0.8],
        [-0.06, 0.87],
        [-0.01, 0.93],
      ];
      return pts;
    }
    case "egg": {
      // easter egg: narrower rounded top, wider rounded bottom
      const pts: [number, number][] = [];
      const N = 48;
      for (let k = 0; k < N; k++) {
        const t = (k * 2 * Math.PI) / N; // 0 = +x axis, pi/2 = top
        const s = Math.sin(t); // +1 at top, -1 at bottom
        const w = 0.72 - 0.18 * s; // slim top, full bottom
        pts.push([w * Math.cos(t), 0.95 * s]);
      }
      return pts;
    }
    case "bunny": {
      // easter bunny head: round face with two tall ears
      const pts: [number, number][] = [];
      const N = 40;
      for (let k = 0; k < N; k++) {
        const t = (k * 2 * Math.PI) / N; // 0 = +x axis
        const dx = Math.cos(t);
        const dy = Math.sin(t);
        let r: number;
        if (dy > 0.15 && Math.abs(dx) > 0.08 && Math.abs(dx) < 0.55) {
          // ears: tall rounded lobes on the upper-left / upper-right
          r = 1.35 - 0.5 * Math.abs(Math.abs(dx) - 0.3);
        } else {
          // face: slightly squashed circle
          r = 0.72;
        }
        pts.push([dx * r, dy > 0 ? dy * r * 0.85 + 0.1 : dy * r + 0.1]);
      }
      return pts;
    }
    case "flower": {
      // 6-petal rosette with a round center. cos^2 gives smooth valleys
      // between the petals (the old |cos|^0.7 profile left cusps that the
      // sampled outline turned into hairline slivers).
      const pts: [number, number][] = [];
      const N = 72;
      for (let k = 0; k < N; k++) {
        const t = (k * 2 * Math.PI) / N;
        const c = Math.cos(3 * t);
        const r = 0.55 + 0.45 * c * c;
        pts.push([r * Math.cos(t), r * Math.sin(t)]);
      }
      return pts;
    }
    case "tulip": {
      // Tulip: a domed centre petal over two flanking petals, a wide rounded
      // cup, and a single plain stem — matching the reference silhouette.
      // Deliberately NO leaves (the previous outline sprouted one each side),
      // and every vertex stays within [-1, 1] so nothing is clipped at the
      // plate edge: unit space maps exactly onto the plate.
      const pts: [number, number][] = [
        // left petal: outer tip, rounded top, then the notch by the centre petal
        [-0.72, 0.52],
        [-0.6, 0.64],
        [-0.28, 0.4], // left notch
        // centre petal, domed rather than a spike
        [-0.13, 0.78],
        [0, 0.86], // centre petal top
        [0.13, 0.78],
        // right notch and right petal
        [0.28, 0.4], // right notch
        [0.6, 0.64],
        [0.72, 0.52], // right petal outer tip
        // right wall of the cup: bulges out, then curves in to the base
        [0.75, 0.32],
        [0.76, 0.1],
        [0.73, -0.08],
        [0.65, -0.22],
        [0.49, -0.31],
        [0.29, -0.34],
        [0.16, -0.35], // base, right of the stem
        // stem, with a slight foot at the bottom
        [0.06, -0.37],
        [0.06, -0.92],
        [0.07, -0.98],
        [-0.07, -0.98],
        [-0.06, -0.92],
        [-0.06, -0.37],
        // left wall of the cup, mirroring the right, back up to the petal tip
        [-0.16, -0.35],
        [-0.29, -0.34],
        [-0.49, -0.31],
        [-0.65, -0.22],
        [-0.73, -0.08],
        [-0.76, 0.1],
        [-0.75, 0.32],
      ];
      return pts;
    }
    case "butterfly":
      // spring butterfly: raised forewings, round hindwings, slim body and
      // two thin antennae standing in the central notch
      return butterflyOutline();
    case "shamrock":
      // 3 heart-shaped lobes + curved stem: smooth outline modeled from
      // high-fidelity silhouette reference with rounded notches and clefts
      return shamrockOutline();
    case "sun": {
      // sun: round core with 8 triangular rays
      const pts: [number, number][] = [];
      const rays = 8;
      for (let k = 0; k < rays; k++) {
        const a = (k * 2 * Math.PI) / rays;
        const aW = Math.PI / rays / 2.2;
        pts.push(
          [0.5 * Math.cos(a - aW), 0.5 * Math.sin(a - aW)],
          [1 * Math.cos(a), 1 * Math.sin(a)],
          [0.5 * Math.cos(a + aW), 0.5 * Math.sin(a + aW)]
        );
      }
      return pts;
    }
    case "shell": {
      // scallop shell: fan with ridged top edge, hinge at the bottom
      const pts: [number, number][] = [];
      const N = 48;
      for (let k = 0; k <= N; k++) {
        const a = (k * Math.PI) / N; // 0 -> pi, right -> top -> left
        const r = 0.85 + 0.12 * Math.cos(7 * a);
        pts.push([r * Math.cos(a), r * Math.sin(a) * 0.9 - 0.05]);
      }
      pts.push([-0.25, -0.55], [0, -0.9], [0.25, -0.55]); // hinge
      return pts;
    }
    case "starfish": {
      // starfish: 5 fat rounded arms (chubby star)
      const pts: [number, number][] = [];
      for (let k = 0; k < 10; k++) {
        const outer = k % 2 === 0;
        const a = Math.PI / 2 + (k * Math.PI) / 5;
        const r = outer ? 1 : 0.55;
        pts.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      return pts;
    }
    case "moon": {
      // crescent moon: outer disc edge on the left, carved by an overlapping
      // disc on the right (crescent opens to the right). Both arcs meet at the
      // exact circle-circle intersection points (the horns), so no closing
      // chord cuts across the crescent.
      const pts: [number, number][] = [];
      const r1 = 0.95; // outer disc, centered on the origin
      const cx = 0.55; // carving disc center
      const r2 = 0.8;
      const a = (cx * cx + r1 * r1 - r2 * r2) / (2 * cx); // horn x on the outer circle
      const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
      const upA = Math.atan2(h, a); // upper horn angle (outer circle)
      const loA = -upA;
      const N = 40;
      // outer arc: upper horn -> around the left -> lower horn
      for (let k = 0; k <= N; k++) {
        const ang = upA + ((Math.PI * 2 + loA - upA) * k) / N;
        pts.push([r1 * Math.cos(ang), r1 * Math.sin(ang)]);
      }
      // inner edge: the carving circle's left arc, from the lower horn back up
      // to the upper horn (this is exactly the part inside the outer disc)
      const upC = Math.atan2(h, a - cx);
      const loC = Math.atan2(-h, a - cx);
      const M = 28;
      for (let k = 1; k < M; k++) {
        const ang = loC + ((upC - loC - Math.PI * 2) * k) / M;
        pts.push([cx + r2 * Math.cos(ang), r2 * Math.sin(ang)]);
      }
      return pts;
    }
    case "heart": {
      // classic parametric heart, scaled to roughly fit [-1, 1]
      let s = 0;
      for (let k = 0; k < 72; k++) {
        const t = (k * 2 * Math.PI) / 72;
        const x = 16 * Math.pow(Math.sin(t), 3);
        const y =
          13 * Math.cos(t) -
          5 * Math.cos(2 * t) -
          2 * Math.cos(3 * t) -
          Math.cos(4 * t);
        pts.push([x, y]);
        s = Math.max(s, Math.abs(x), Math.abs(y));
      }
      return pts.map(([x, y]) => [x / s, y / s] as [number, number]);
    }
    default:
      return null;
  }
}

/**
 * Shared gingerbread outline (template style): big round head, stubby arms
 * angled slightly upward with round hands. The man's lower half is two
 * rounded legs with a V crotch notch; the woman's is a flared dress with
 * two short rounded legs below the hem. Built from smooth arc/bezier
 * sections so every corner is round.
 */
function gingerbreadBody(dress: boolean): [number, number][] {
  const pts: [number, number][] = [];
  const arc = (
    cx: number,
    cy: number,
    r: number,
    a0: number,
    a1: number,
    n: number
  ) => {
    for (let k = 0; k <= n; k++) {
      const a = a0 + ((a1 - a0) * k) / n;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  const bez = (
    p0: [number, number],
    p1: [number, number],
    p2: [number, number],
    p3: [number, number],
    n: number
  ) => {
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const u = 1 - t;
      pts.push([
        u * u * u * p0[0] +
          3 * u * u * t * p1[0] +
          3 * u * t * t * p2[0] +
          t * t * t * p3[0],
        u * u * u * p0[1] +
          3 * u * u * t * p1[1] +
          3 * u * t * t * p2[1] +
          t * t * t * p3[1],
      ]);
    }
  };
  // head: circle minus the neck wedge. The outline STARTS at the LEFT chin,
  // sweeps over the top (clockwise, matching the body below) and comes back
  // down to the RIGHT chin; the body then continues down the right neck with
  // no retracing. The closing edge from the left shoulder back to the left
  // chin is the single neck line.
  const neckHalf = 0.3;
  const headCy = 0.62;
  const headR = 0.34;
  const neckY = headCy - Math.sqrt(headR * headR - neckHalf * neckHalf);
  const headN = 24;
  const aLeft = Math.atan2(neckY - headCy, -neckHalf);
  const aRight = Math.atan2(neckY - headCy, neckHalf) - Math.PI * 2;
  for (let k = 0; k <= headN; k++) {
    const a = aLeft + ((aRight - aLeft) * k) / headN;
    pts.push([headR * Math.cos(a), headCy + headR * Math.sin(a)]);
  }
  // right neck into shoulder/armpit
  bez([0.3, neckY], [0.28, 0.42], [0.32, 0.4], [0.38, 0.4], 3);
  // right arm: out to the rounded hand, angled slightly upward
  bez([0.38, 0.42], [0.55, 0.46], [0.72, 0.5], [0.84, 0.52], 6);
  arc(0.84, 0.4, 0.12, Math.PI / 2, -Math.PI / 2, 8);
  // right arm underside back to the armpit
  bez([0.84, 0.28], [0.68, 0.24], [0.54, 0.2], [0.44, 0.14], 6);
  if (!dress) {
    // right torso down to the hip
    bez([0.44, 0.14], [0.38, 0.02], [0.36, -0.08], [0.38, -0.18], 4);
    // right leg outer edge down to the rounded foot
    bez([0.38, -0.18], [0.44, -0.4], [0.5, -0.6], [0.5, -0.78], 6);
    arc(0.32, -0.78, 0.18, 0, -Math.PI, 8);
    // right leg inner edge up to the crotch notch
    bez([0.14, -0.78], [0.14, -0.6], [0.1, -0.5], [0.05, -0.42], 5);
    arc(0, -0.36, 0.055, 0, Math.PI, 4);
    // left leg inner edge down to the foot
    bez([-0.05, -0.42], [-0.1, -0.5], [-0.14, -0.6], [-0.14, -0.78], 5);
    arc(-0.32, -0.78, 0.18, 0, -Math.PI, 8);
    // left leg outer edge up to the hip
    bez([-0.5, -0.78], [-0.5, -0.6], [-0.44, -0.4], [-0.38, -0.18], 6);
    // left torso up to the armpit
    bez([-0.38, -0.18], [-0.36, -0.08], [-0.38, 0.02], [-0.44, 0.14], 4);
  } else {
    // right bodice flaring out to the dress hem
    bez([0.44, 0.14], [0.42, 0.0], [0.48, -0.15], [0.58, -0.3], 6);
    // right hem corner (rounded)
    arc(0.5, -0.34, 0.1, 0.3, -Math.PI / 2 - 0.2, 5);
    // right leg outer edge down to the foot
    bez([0.48, -0.46], [0.48, -0.58], [0.47, -0.68], [0.45, -0.78], 4);
    arc(0.29, -0.78, 0.16, 0, -Math.PI, 8);
    // right leg inner edge up to the dress underside
    bez([0.13, -0.78], [0.13, -0.66], [0.12, -0.58], [0.1, -0.52], 4);
    // dress underside scallop between the legs
    bez([0.1, -0.52], [0.05, -0.48], [-0.05, -0.48], [-0.1, -0.52], 4);
    // left leg inner edge down to the foot
    bez([-0.1, -0.52], [-0.12, -0.58], [-0.13, -0.66], [-0.13, -0.78], 4);
    arc(-0.29, -0.78, 0.16, 0, -Math.PI, 8);
    // left leg outer edge up to the hem
    bez([-0.45, -0.78], [-0.47, -0.68], [-0.48, -0.58], [-0.48, -0.46], 4);
    // left hem corner (rounded): from the leg outer edge around to the
    // dress side edge, sweeping through the left (outer) side
    arc(-0.5, -0.34, 0.1, -Math.PI / 2 + 0.2, -Math.PI - 0.3, 5);
    // left side of dress back up to the armpit
    bez([-0.58, -0.3], [-0.48, -0.15], [-0.42, 0.0], [-0.44, 0.14], 6);
  }
  // left arm underside out to the hand
  bez([-0.44, 0.14], [-0.54, 0.2], [-0.68, 0.24], [-0.84, 0.28], 6);
  arc(-0.84, 0.4, 0.12, -Math.PI / 2, -Math.PI * 1.5, 8);
  // left arm top back to the shoulder; the closing edge from here to the
  // head's first point (the left chin) is the left neck line
  bez([-0.84, 0.52], [-0.72, 0.5], [-0.55, 0.46], [-0.38, 0.4], 6);
  return pts;
}

/**
 * Pumpkin outline (template style): a wide ribbed body with a curling stem.
 * The body is a chain of rib lobes — the arcs through consecutive crease
 * points, each standing a chosen `rise` above its chord — joined by rounded
 * notches: at every interior crease the two lobes that meet there are trimmed
 * back and bridged by a short bezier that leaves and arrives along the lobe
 * tangents, so creases read as round-bottomed slits rather than spikes. The
 * stem is spliced into the gap between the two crown ribs: up its left edge,
 * over the curled crest, through the notch to the hooked tip, then back down
 * the right edge into the body. `ribs`/`bez` skip their start point (it is
 * already the previous point).
 */
function pumpkinOutline(): [number, number][] {
  const pts: [number, number][] = [];
  const bez = (
    p0: [number, number],
    p1: [number, number],
    p2: [number, number],
    p3: [number, number],
    n: number
  ) => {
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const u = 1 - t;
      pts.push([
        u * u * u * p0[0] +
          3 * u * u * t * p1[0] +
          3 * u * t * t * p2[0] +
          t * t * t * p3[0],
        u * u * u * p0[1] +
          3 * u * u * t * p1[1] +
          3 * u * t * t * p2[1] +
          t * t * t * p3[1],
      ]);
    }
  };
  // Body centre: decides which side of a chord is "out".
  const bcx = 0;
  const bcy = -0.18;
  const onCircle = (
    c: { cx: number; cy: number; r: number },
    a: number
  ): [number, number] => [c.cx + c.r * Math.cos(a), c.cy + c.r * Math.sin(a)];
  /** Circle through p0..p1 whose crest stands `rise` above the chord, on the
   *  far side of that chord from the body centre. `da` is the signed angular
   *  sweep from p0 to p1 taken the short way, so the crest is always on it. */
  const lobeCircle = (
    p0: [number, number],
    p1: [number, number],
    rise: number
  ) => {
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const len = Math.hypot(dx, dy) || 1;
    const mx = (p0[0] + p1[0]) / 2;
    const my = (p0[1] + p1[1]) / 2;
    let nx = -dy / len;
    let ny = dx / len;
    if (nx * (mx - bcx) + ny * (my - bcy) < 0) {
      nx = -nx;
      ny = -ny;
    }
    const r = (len * len) / (8 * rise) + rise / 2;
    const h = r - rise; // circle centre stands h back from the chord
    const cx = mx - h * nx;
    const cy = my - h * ny;
    const a0 = Math.atan2(p0[1] - cy, p0[0] - cx);
    let da = Math.atan2(p1[1] - cy, p1[0] - cx) - a0;
    if (da > Math.PI) da -= 2 * Math.PI;
    if (da < -Math.PI) da += 2 * Math.PI;
    return { cx, cy, r, a0, da };
  };
  /** Travel direction along a lobe at angle a (the body is walked clockwise). */
  const tangent = (da: number, a: number): [number, number] => {
    const s = da < 0 ? -1 : 1;
    return [-s * Math.sin(a), s * Math.cos(a)];
  };
  /**
   * Ribbed chain: one lobe per crease pair, joined at interior creases by
   * rounded notches. `notch[k]` is how far the lobes either side of crease
   * k+1 are trimmed back before a bezier bridges them, so that crease can be
   * as deep as its point asks without becoming a spike. The chain's first
   * crease must already be on the list; its last crease stays a corner.
   */
  const ribs = (
    creases: [number, number][],
    rises: number[],
    notch: number[]
  ) => {
    const lobes = rises.map((rise, i) =>
      lobeCircle(creases[i], creases[i + 1], rise)
    );
    let prevP: [number, number] = [0, 0];
    let prevT: [number, number] = [1, 0];
    lobes.forEach((c, i) => {
      const sign = c.da < 0 ? -1 : 1;
      const ds = i > 0 ? notch[i - 1] / c.r : 0; // trim back from crease here
      const de = i < lobes.length - 1 ? notch[i] / c.r : 0; // and from the next
      const a0 = c.a0 + sign * ds;
      const a1 = c.a0 + c.da - sign * de;
      const start = onCircle(c, a0);
      if (i === 0) {
        pts.push(start);
      } else {
        const h = notch[i - 1] * 0.55;
        const t = tangent(c.da, a0);
        bez(
          prevP,
          [prevP[0] + prevT[0] * h, prevP[1] + prevT[1] * h],
          [start[0] - t[0] * h, start[1] - t[1] * h],
          start,
          4
        );
      }
      // a sample per 0.045 of arc keeps the big lobes as smooth as the small
      const n = Math.max(3, Math.ceil((Math.abs(c.da) * c.r) / 0.045));
      for (let k = 1; k <= n; k++) {
        pts.push(onCircle(c, a0 + ((a1 - a0) * k) / n));
      }
      prevP = onCircle(c, a1);
      prevT = tangent(c.da, a1);
    });
  };
  const sbl: [number, number] = [-0.122, 0.545]; // stem base, left of the gap
  const sbr: [number, number] = [0.122, 0.545]; // stem base, right of the gap
  // crease points, walked clockwise from the stem's right base: crown rib,
  // shoulder, cheek, five bottom scallops, then the mirror back up to the
  // stem's left base
  const creases: [number, number][] = [
    sbr,
    [0.4, 0.462], // crown rib -> shoulder
    [0.8, 0.3], // shoulder -> cheek
    [0.885, -0.43], // cheek -> outer scallop
    [0.6, -0.745], // outer -> mid scallop
    [0.245, -0.8], // mid -> centre scallop
    [-0.245, -0.8], // centre -> mid scallop
    [-0.6, -0.745],
    [-0.885, -0.43],
    [-0.8, 0.3],
    [-0.4, 0.462],
    sbl,
  ];
  // how far each rib's crest stands above its chord: crown, shoulder, cheek,
  // outer/mid/centre scallops, then the mirror of all that
  const rises = [
    0.05, 0.165, 0.166, 0.082, 0.1, 0.125, 0.1, 0.082, 0.166, 0.165, 0.05,
  ];
  // crease rounding: a trim of t pulls the notch bottom ~t/2 out of the
  // crease, so these are kept short where a crease wants to stay deep
  // (bottom scallop slits) and longer for the soft crown/shoulder waves
  const notch = [0.04, 0.05, 0.032, 0.026, 0.022, 0.022, 0.026, 0.032, 0.05, 0.04];
  // stem: left edge up to the crest, over it, into the notch, out to the
  // hooked tip, then down the right edge to the body's top edge
  pts.push(sbl);
  bez(sbl, [-0.152, 0.63], [-0.168, 0.78], [-0.124, 0.872], 8);
  bez([-0.124, 0.872], [-0.104, 0.912], [-0.056, 0.912], [-0.018, 0.894], 6);
  bez([-0.018, 0.894], [0.004, 0.868], [0.028, 0.862], [0.05, 0.876], 5);
  bez([0.05, 0.876], [0.062, 0.882], [0.072, 0.888], [0.078, 0.894], 3);
  bez([0.078, 0.894], [0.088, 0.8], [0.102, 0.66], sbr, 8);
  ribs(creases, rises, notch);
  // the closing edge retraces the last sample's short chord, so drop the
  // duplicated closing point rather than leave a zero-length edge
  const last = pts[pts.length - 1];
  if (Math.hypot(last[0] - pts[0][0], last[1] - pts[0][1]) < 1e-9) pts.pop();
  return pts;
}

/**
 * Butterfly outline (template style): two big forewings raised either side of
 * a deep central notch, two round hindwings below them with a slight waist
 * between the pairs, a slim body whose pointed abdomen hangs below the
 * hindwings, and two thin antennae standing in the notch. Only the right half
 * is authored — it runs clockwise from the head's top centre out over the
 * right forewing, down the wing margins, round the hindwing and down the
 * abdomen to its tip; the left half is that chain mirrored, and the two share
 * the head's top centre and the abdomen tip (both sit on x = 0). Arcs cover
 * the whole rounded wing margins, so the silhouette has no straight runs.
 */
function butterflyOutline(): [number, number][] {
  const right: [number, number][] = [];
  /** Append, skipping a point that would repeat the previous one — every
   *  section below starts where the last one ended. */
  const push = (x: number, y: number) => {
    const last = right[right.length - 1];
    if (last && Math.hypot(last[0] - x, last[1] - y) < 1e-9) return;
    right.push([x, y]);
  };
  /** Arc; the body is walked clockwise, so the wing arcs count their angle
   *  down (a1 < a0) and the sweep is taken through the points asked for. */
  const arc = (
    cx: number,
    cy: number,
    r: number,
    a0: number,
    a1: number,
    n: number
  ) => {
    for (let k = 1; k <= n; k++) {
      const a = a0 + ((a1 - a0) * k) / n;
      push(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
  };
  const bez = (
    p0: [number, number],
    p1: [number, number],
    p2: [number, number],
    p3: [number, number],
    n: number
  ) => {
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const u = 1 - t;
      push(
        u * u * u * p0[0] +
          3 * u * u * t * p1[0] +
          3 * u * t * t * p2[0] +
          t * t * t * p3[0],
        u * u * u * p0[1] +
          3 * u * u * t * p1[1] +
          3 * u * t * t * p2[1] +
          t * t * t * p3[1]
      );
    }
  };
  // Antenna: a thin stalk rising from the head with a short hook turning
  // outward at the tip. Its centreline is sampled once, then offset either
  // side by the half width, so both edges stay parallel and the tip is capped
  // by a half circle.
  const antHalf = 0.0085;
  const spine: [number, number][] = [];
  const spineBez = (
    p0: [number, number],
    p1: [number, number],
    p2: [number, number],
    p3: [number, number],
    n: number
  ) => {
    for (let k = spine.length ? 1 : 0; k <= n; k++) {
      const t = k / n;
      const u = 1 - t;
      spine.push([
        u * u * u * p0[0] +
          3 * u * u * t * p1[0] +
          3 * u * t * t * p2[0] +
          t * t * t * p3[0],
        u * u * u * p0[1] +
          3 * u * u * t * p1[1] +
          3 * u * t * t * p2[1] +
          t * t * t * p3[1],
      ]);
    }
  };
  spineBez([0.021, 0.098], [0.055, 0.235], [0.105, 0.375], [0.135, 0.45], 9);
  spineBez([0.135, 0.45], [0.16, 0.47], [0.185, 0.462], [0.198, 0.455], 4);
  /** Edge point at spine sample k: `side` +1 is the stalk's inner (left)
   *  edge, -1 its outer edge. */
  const edge = (k: number, side: number): [number, number] => {
    const p = spine[k];
    const a = spine[Math.max(0, k - 1)];
    const b = spine[Math.min(spine.length - 1, k + 1)];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const L = Math.hypot(tx, ty) || 1;
    return [p[0] - (side * ty * antHalf) / L, p[1] + (side * tx * antHalf) / L];
  };
  // head's top centre — the slot between the two antennae bottoms out here,
  // and the mirrored left half starts from the same point
  push(0, 0.096);
  for (let k = 0; k < spine.length; k++) {
    const [x, y] = edge(k, 1);
    push(x, y);
  }
  // tip: round the hooked end from the inner edge to the outer edge
  {
    const p = spine[spine.length - 1];
    const a = spine[spine.length - 2];
    const tx = p[0] - a[0];
    const ty = p[1] - a[1];
    const L = Math.hypot(tx, ty) || 1;
    const tX = tx / L;
    const tY = ty / L;
    const nX = -tY; // left of travel = the inner edge's normal
    const nY = tX;
    for (let k = 1; k <= 6; k++) {
      const phi = Math.PI / 2 - (Math.PI * k) / 6;
      push(
        p[0] + antHalf * (Math.cos(phi) * tX + Math.sin(phi) * nX),
        p[1] + antHalf * (Math.cos(phi) * tY + Math.sin(phi) * nY)
      );
    }
  }
  for (let k = spine.length - 1; k >= 0; k--) {
    const [x, y] = edge(k, -1);
    push(x, y);
  }
  // head's right shoulder dipping into the armpit between the head and the
  // forewing's base, then the forewing's inner margin — the right arm of the
  // central notch — rising to the wing's inner top corner
  bez([0.03, 0.095], [0.075, 0.072], [0.084, 0.022], [0.146, 0.176], 6);
  bez([0.146, 0.176], [0.245, 0.395], [0.325, 0.615], [0.376, 0.692], 7);
  // forewing: one arc covers the rounded top and the outer margin, bulging
  // out to x = 1 at the wing's widest point
  arc(0.6, 0.36, 0.4, 2.164, -0.524, 14);
  // the slight waist where forewing and hindwing meet on the outer edge
  bez([0.946, 0.16], [0.945, 0.075], [0.935, -0.02], [0.941, -0.071], 5);
  // hindwing: one arc covers its outer margin and its round bottom
  arc(0.529, -0.3, 0.472, 0.506, -2.827, 16);
  // hindwing's inner bottom sweeping up to where the abdomen leaves it: the
  // white sliver either side of the abdomen opens off this short concave run
  bez([0.08, -0.446], [0.068, -0.428], [0.055, -0.41], [0.045, -0.395], 3);
  // abdomen: slim taper down to the pointed tip (shared with the left half)
  bez([0.045, -0.395], [0.03, -0.47], [0.012, -0.57], [0, -0.65], 6);
  // left half: the same chain mirrored, minus the two points it shares with
  // the right half (both lie on x = 0, so mirroring would repeat them)
  const pts = right.slice();
  for (let k = right.length - 2; k >= 1; k--) {
    pts.push([-right[k][0], right[k][1]]);
  }
  return pts;
}
/**
 * Shamrock outline (template style): a classic 3-leaf clover with heart-shaped
 * leaflets and a gracefully curved stem. Authored from high-fidelity reference
 * silhouette with smooth rounded lobes, deep interior notches, and an asymmetric
 * stem sweeping down to the right.
 */
function shamrockOutline(): [number, number][] {
  return [
    [ 0.4000,  0.3223],
    [ 0.5911,  0.3860],
    [ 0.6930,  0.3962],
    [ 0.7592,  0.3834],
    [ 0.8229,  0.3554],
    [ 0.9070,  0.2815],
    [ 0.9401,  0.2280],
    [ 0.9631,  0.1618],
    [ 0.9682,  0.0650],
    [ 0.9605,  0.0217],
    [ 0.9045, -0.0904],
    [ 0.8459, -0.1465],
    [ 0.7949, -0.1745],
    [ 0.8459, -0.2484],
    [ 0.8688, -0.3070],
    [ 0.8790, -0.3605],
    [ 0.8688, -0.4701],
    [ 0.8331, -0.5490],
    [ 0.7720, -0.6178],
    [ 0.6981, -0.6637],
    [ 0.6268, -0.6866],
    [ 0.5045, -0.6866],
    [ 0.4484, -0.6688],
    [ 0.3924, -0.6357],
    [ 0.2777, -0.5312],
    [ 0.0917, -0.3121],
    [ 0.0866, -0.3350],
    [ 0.0968, -0.4395],
    [ 0.1401, -0.5924],
    [ 0.2166, -0.7350],
    [ 0.3236, -0.8573],
    [ 0.3287, -0.8752],
    [ 0.3210, -0.8930],
    [ 0.3083, -0.9210],
    [ 0.2726, -0.9592],
    [ 0.2115, -0.9975],
    [ 0.1860, -1.0000],
    [ 0.1070, -0.9032],
    [ 0.0561, -0.8217],
    [-0.0025, -0.6943],
    [-0.0510, -0.4981],
    [-0.0561, -0.2841],
    [-0.1809, -0.4369],
    [-0.3745, -0.6153],
    [-0.4382, -0.6510],
    [-0.4892, -0.6662],
    [-0.6013, -0.6688],
    [-0.6650, -0.6510],
    [-0.7414, -0.6051],
    [-0.7924, -0.5516],
    [-0.8331, -0.4752],
    [-0.8510, -0.3834],
    [-0.8459, -0.3197],
    [-0.8280, -0.2586],
    [-0.7822, -0.1771],
    [-0.8306, -0.1541],
    [-0.8917, -0.1057],
    [-0.9376, -0.0446],
    [-0.9631,  0.0140],
    [-0.9758,  0.0828],
    [-0.9707,  0.1618],
    [-0.9503,  0.2255],
    [-0.9070,  0.2968],
    [-0.8561,  0.3478],
    [-0.8102,  0.3783],
    [-0.6981,  0.4140],
    [-0.5631,  0.4013],
    [-0.3873,  0.3427],
    [-0.3847,  0.3503],
    [-0.5121,  0.5618],
    [-0.5325,  0.6280],
    [-0.5376,  0.7070],
    [-0.5299,  0.7554],
    [-0.4841,  0.8573],
    [-0.4331,  0.9134],
    [-0.3898,  0.9439],
    [-0.3261,  0.9720],
    [-0.2548,  0.9847],
    [-0.1834,  0.9796],
    [-0.1172,  0.9592],
    [-0.0510,  0.9185],
    [ 0.0000,  0.8650],
    [ 0.0611,  0.9312],
    [ 0.0968,  0.9567],
    [ 0.1631,  0.9873],
    [ 0.2268,  1.0000],
    [ 0.3006,  0.9975],
    [ 0.3822,  0.9720],
    [ 0.4510,  0.9261],
    [ 0.4943,  0.8803],
    [ 0.5503,  0.7682],
    [ 0.5605,  0.7121],
    [ 0.5580,  0.6433],
    [ 0.5223,  0.5363],
    [ 0.3949,  0.3274],
  ];
}



/**
 * Christmas tree outline (template style): a tall conifer in three tiers —
 * each a straight flank closing in a rounded base corner over a short base
 * shelf — standing on a flat-bottomed trunk whose corners are all but sharp.
 * Every corner is replaced by a tangent arc, which is what gives the
 * silhouette its soft clipart look. Only the right half is authored (crown
 * tip, down the flanks and shelves to the trunk's bottom right corner); the
 * left half is that chain mirrored, and the two share the crown tip on x = 0.
 * The corners are the sharp skeleton — the arcs pull the silhouette a hair
 * inside them, so the tree spans x = ±0.64 and y = -0.78..1 as measured.
 */
function treeOutline(): [number, number][] {
  // Corners of the right half, crown first, walked clockwise so the tree's
  // interior sits to the right of the walk, with the fillet radius of each:
  // the crown tip and the three tier base corners round generously, the
  // concave steps where the next tier's flank leaves a shelf only slightly,
  // the trunk a hair.
  const corner: [number, number][] = [
    [0, 1.0345], // crown tip (its arc peaks at y = 1)
    [0.277, 0.63], // tier 1's base corner
    [0.186, 0.608], // step: tier 2's flank leaves tier 1's shelf
    [0.455, 0.26], // tier 2's base corner
    [0.207, 0.225], // step: tier 3's flank leaves tier 2's shelf
    [0.683, -0.4], // tier 3's base corner (its arc reaches x = 0.64)
    [0.192, -0.43], // step: the trunk's right side leaves tier 3's shelf
    [0.192, -0.78], // trunk's bottom right corner
  ];
  const radius = [0.045, 0.04, 0.016, 0.045, 0.022, 0.045, 0.035, 0.02];
  // the left half, mirrored, minus the crown tip (it sits on x = 0)
  const loop = corner.slice();
  const radii = radius.slice();
  for (let k = corner.length - 1; k >= 1; k--) {
    loop.push([-corner[k][0], corner[k][1]]);
    radii.push(radius[k]);
  }

  const pts: [number, number][] = [];
  const push = (x: number, y: number) => {
    const last = pts[pts.length - 1];
    if (last && Math.hypot(last[0] - x, last[1] - y) < 1e-9) return;
    pts.push([x, y]);
  };
  for (let i = 0; i < loop.length; i++) {
    const a = loop[(i + loop.length - 1) % loop.length];
    const b = loop[i];
    const c = loop[(i + 1) % loop.length];
    const r = radii[i];
    const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const u1x = (b[0] - a[0]) / l1;
    const u1y = (b[1] - a[1]) / l1;
    const u2x = (c[0] - b[0]) / l2;
    const u2y = (c[1] - b[1]) / l2;
    // signed turn: right (negative) at a convex corner of a clockwise walk
    const turn = Math.atan2(u1x * u2y - u1y * u2x, u1x * u2x + u1y * u2y);
    // the arc is tangent to both edges, r*tan(turn/2) back along the incoming
    // one and the same distance on along the outgoing one; its centre sits on
    // the interior side at a convex corner and on the outside at a concave
    // one, so either way the arc cuts the corner off
    const d = r * Math.abs(Math.tan(turn / 2));
    const t1x = b[0] - u1x * d;
    const t1y = b[1] - u1y * d;
    const nx = turn < 0 ? u1y : -u1y;
    const ny = turn < 0 ? -u1x : u1x;
    const cx = t1x + nx * r;
    const cy = t1y + ny * r;
    push(t1x, t1y);
    const a0 = Math.atan2(t1y - cy, t1x - cx);
    // ~0.006 unit chords: small fillets stay cheap, big ones stay smooth
    const steps = Math.max(
      2,
      Math.min(16, Math.round((Math.abs(turn) * r) / 0.006))
    );
    for (let k = 1; k <= steps; k++) {
      const th = a0 + (turn * k) / steps;
      push(cx + r * Math.cos(th), cy + r * Math.sin(th));
    }
  }
  return pts;
}

/**
 * Snowflake outline: 60 vertices, 10 per 60-degree sector, walked clockwise
 * from the top tip. See the `case "snowflake"` note for the provenance.
 */
function snowflakeOutline(): [number, number][] {
  // [radius, clockwise degrees from the sector's arm axis], symmetrized so
  // each sector mirrors across its 30-degree mid-ray.
  const sector: [number, number][] = [
    [1.0, 0],
    [0.7209, 16.26],
    [0.4908, 10.6],
    [0.355, 17.0],
    [0.579, 19.49],
    [0.6864, 30],
    [0.579, 40.51],
    [0.355, 43.0],
    [0.4908, 49.4],
    [0.7209, 43.74],
  ];
  const pts: [number, number][] = [];
  for (let k = 0; k < 6; k++) {
    const base = k * 60;
    for (const [r, a] of sector) {
      const rad = ((base + a) * Math.PI) / 180;
      pts.push([r * Math.sin(rad), r * Math.cos(rad)]);
    }
  }
  return pts;
}

/**
 * Ghost outline (template style): round dome head, stubby arms out to either
 * side with wavy undersides, a wavy tail sweeping to the lower right, and a
 * notch where that tail passes below the right arm. Built from smooth
 * arc/bezier sections so every corner is round. `arc` pushes both endpoints;
 * `bez` and `wave` skip their start point (it is already the previous point).
 */
function ghostOutline(): [number, number][] {
  const pts: [number, number][] = [];
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const onCircle = (cx: number, cy: number, r: number, a: number): [number, number] => [
    cx + r * Math.cos(a),
    cy + r * Math.sin(a),
  ];
  const arc = (
    cx: number,
    cy: number,
    r: number,
    a0: number,
    a1: number,
    n: number
  ) => {
    for (let k = 0; k <= n; k++) {
      const a = a0 + ((a1 - a0) * k) / n;
      pts.push(onCircle(cx, cy, r, a));
    }
  };
  const bez = (
    p0: [number, number],
    p1: [number, number],
    p2: [number, number],
    p3: [number, number],
    n: number
  ) => {
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const u = 1 - t;
      pts.push([
        u * u * u * p0[0] +
          3 * u * u * t * p1[0] +
          3 * u * t * t * p2[0] +
          t * t * t * p3[0],
        u * u * u * p0[1] +
          3 * u * u * t * p1[1] +
          3 * u * t * t * p2[1] +
          t * t * t * p3[1],
      ]);
    }
  };
  // Wavy edge from p0 to p1: `bumps` ripples of amplitude `amp`, the first
  // one to the left of travel when `side` is +1. The sine is windowed by
  // sin(pi t) so the edge leaves and rejoins its baseline tangentially — no
  // kink where it meets the neighbouring segment.
  const wave = (
    p0: [number, number],
    p1: [number, number],
    amp: number,
    bumps: number,
    side: number,
    n: number
  ) => {
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const s = side * amp * Math.sin(2 * Math.PI * bumps * t) * Math.sin(Math.PI * t);
      pts.push([p0[0] + dx * t + nx * s, p0[1] + dy * t + ny * s]);
    }
  };

  // head: dome from the top down the left side to the left shoulder
  const headC: [number, number] = [0, 0.42];
  const headR = 0.5;
  const shL = onCircle(headC[0], headC[1], headR, rad(186));
  const shR = onCircle(headC[0], headC[1], headR, rad(-6));
  arc(headC[0], headC[1], headR, rad(90), rad(186), 14);

  // left arm: shoulder crease out over the top to the rounded tip
  const armCL: [number, number] = [-0.87, 0.13];
  const armR = 0.13;
  const capL0 = rad(113);
  const capL1 = rad(256);
  const capLStart = onCircle(armCL[0], armCL[1], armR, capL0);
  const capLEnd = onCircle(armCL[0], armCL[1], armR, capL1);
  // control points lay the tangents along the dome above and the tip cap
  // below, so the crease bends but never kinks
  bez(shL, [-0.478, 0.169], [-0.737, 0.328], capLStart, 10);
  // left arm tip: round cap (points left, a touch down)
  arc(armCL[0], armCL[1], armR, capL0, capL1, 8);
  // left arm underside: wavy fingers back in toward the body
  wave(capLEnd, [-0.34, -0.1], 0.055, 1.5, -1, 28);

  // body: armpit tucked under the arm, left flank, big round bottom
  bez([-0.34, -0.1], [-0.192, -0.127], [-0.419, -0.379], [-0.47, -0.52], 10);
  bez([-0.47, -0.52], [-0.44, -0.78], [-0.15, -0.88], [0.1, -0.8], 12);

  // tail: wavy flap sweeping right, ending in a rounded tip
  const tailC: [number, number] = [0.7, -0.44];
  const tailR = 0.115;
  const tailA0 = rad(-62);
  const tailA1 = rad(78);
  const tailStart = onCircle(tailC[0], tailC[1], tailR, tailA0);
  const tailEnd = onCircle(tailC[0], tailC[1], tailR, tailA1);
  wave([0.1, -0.8], tailStart, 0.07, 1.5, 1, 28);
  arc(tailC[0], tailC[1], tailR, tailA0, tailA1, 8);
  // tail upper edge: wave back left into the notch below the right arm
  wave(tailEnd, [0.32, -0.26], 0.045, 1, -1, 18);

  // right arm underside: wavy fingers out to the tip (the cap's start
  // tangent is 24.4deg, matching the underside wave's baseline, so the two
  // join smoothly)
  const armCR: [number, number] = [0.87, 0.13];
  const capR0 = rad(-65.6);
  const capR1 = rad(67);
  const capRStart = onCircle(armCR[0], armCR[1], armR, capR0);
  const capREnd = onCircle(armCR[0], armCR[1], armR, capR1);
  wave([0.32, -0.26], capRStart, 0.055, 1.5, 1, 28);
  // right arm tip: round cap (points right, a touch up)
  arc(armCR[0], armCR[1], armR, capR0, capR1, 8);
  // right arm: top edge back up into the dome
  bez(capREnd, [0.737, 0.328], [0.478, 0.169], shR, 10);
  // dome: right shoulder over the top, closing the loop (stopping a hair
  // short of the first point so the outline has no doubled-up vertex)
  arc(headC[0], headC[1], headR, rad(-6), rad(89.6), 14);
  return pts;
}

/** Even-odd point-in-polygon test. */
function pointInPolygon(
  x: number,
  y: number,
  poly: [number, number][]
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Minimum distance from a point to a polygon's boundary. */
function distanceToPolygon(
  x: number,
  y: number,
  poly: [number, number][]
): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const dx = xj - xi;
    const dy = yj - yi;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((x - xi) * dx + (y - yi) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = xi + t * dx - x;
    const py = yi + t * dy - y;
    const d = px * px + py * py;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/**
 * Analytic shape silhouette for smooth mesh edges: precise point tests and
 * boundary projection in fractional pixel coordinates (x right, y down,
 * pixel centers at +0.5, pixel corners at integers). Used by the mesh
 * generator so shape edges are true lines/curves instead of a pixel
 * staircase.
 */
export interface ShapeSilhouette {
  /** Fractional pixel coordinates. */
  inside(px: number, py: number): boolean;
  /** Nearest point on the shape boundary, in fractional pixel coordinates. */
  project(px: number, py: number): [number, number];
  /**
   * Optional fast path: rasterize membership for every fine cell center
   * (row-major, gw*sub x gh*sub, 1 = inside). Polygon shapes provide a
   * scanline fill so the cost is O(rows x edges) instead of
   * O(cells x edges).
   */
  fillFine?(gw: number, gh: number, sub: number): Uint8Array;
}

/** Unit-space inside test shared by the pixel classifier and the silhouette.
 * Note: "custom" (pixel-space crop rect) is handled separately and never
 * reaches this function. */
function insideUnit(type: Exclude<ShapeType, "custom">, ux: number, uy: number): boolean {
  switch (type) {
    case "circle":
      return ux * ux + uy * uy <= 1;
    case "square":
      return Math.abs(ux) <= 1 && Math.abs(uy) <= 1;
    case "rectangle":
      return true; // covers the whole image; boundary is the image frame
    default:
      return pointInPolygon(ux, uy, shapePolygon(type)!);
  }
}

/** Nearest point on a unit-space polygon boundary (edges in order). */
function projectToPolygon(
  ux: number,
  uy: number,
  poly: [number, number][]
): [number, number] {
  let bx = 0,
    by = 0,
    best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const dx = xj - xi;
    const dy = yj - yi;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((ux - xi) * dx + (uy - yi) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = xi + t * dx - ux;
    const py = yi + t * dy - uy;
    const d = px * px + py * py;
    if (d < best) {
      best = d;
      bx = xi + t * dx;
      by = yi + t * dy;
    }
  }
  return [bx, by];
}

/** Nearest point on the unit-space boundary of a shape.
 * Note: "custom" (pixel-space crop rect) is handled separately and never
 * reaches this function. */
function projectUnit(
  type: Exclude<ShapeType, "custom">,
  ux: number,
  uy: number
): [number, number] {
  switch (type) {
    case "circle": {
      const len = Math.hypot(ux, uy);
      if (len < 1e-12) return [1, 0];
      return [ux / len, uy / len];
    }
    case "square": {
      const ax = Math.abs(ux);
      const ay = Math.abs(uy);
      if (ax <= 1 && ay <= 1) {
        // inside: drop to the nearest of the four sides
        if (1 - ax <= 1 - ay) return [Math.sign(ux) || 1, uy];
        return [ux, Math.sign(uy) || 1];
      }
      // outside: nearest corner
      return [Math.max(-1, Math.min(1, ux)), Math.max(-1, Math.min(1, uy))];
    }
    default:
      return projectToPolygon(ux, uy, shapePolygon(type)!);
  }
}

/**
 * Pixel-space bounds of the "custom" crop rectangle: an axis-aligned rect
 * centered at (cx, cy) with width w * gw and height h * gh, clamped to the
 * image frame with a minimum span of 1px. Returned as [x0, y0, x1, y1] in
 * fractional image-pixel coordinates (origin = top-left).
 */
export function customRectBounds(
  shape: ShapeParams,
  gw: number,
  gh: number
): { x0: number; y0: number; x1: number; y1: number } {
  const wFrac = Math.max(0.01, Math.min(1, shape.w ?? shape.size ?? 1));
  const hFrac = Math.max(0.01, Math.min(1, shape.h ?? shape.size ?? 1));
  const wPx = Math.max(1, wFrac * gw);
  const hPx = Math.max(1, hFrac * gh);
  let x0 = shape.cx * gw - wPx / 2;
  let y0 = shape.cy * gh - hPx / 2;
  // Clamp the rect into the frame so drags near the edge keep full size.
  x0 = Math.max(0, Math.min(gw - wPx, x0));
  y0 = Math.max(0, Math.min(gh - hPx, y0));
  return { x0, y0, x1: x0 + wPx, y1: y0 + hPx };
}

/**
 * Build the analytic silhouette of a shape over the pixel grid. For the
 * full-image rectangle the boundary is the image frame (pixel-aligned, so
 * projection is the identity there); the "custom" crop rect is an
 * axis-aligned pixel-space rect; every other shape tests and projects
 * exactly.
 */
export function makeShapeSilhouette(
  shape: ShapeParams,
  gw: number,
  gh: number
): ShapeSilhouette {
  if (shape.type === "rectangle") {
    const clamp = (v: number, lo: number, hi: number) =>
      Math.max(lo, Math.min(hi, v));
    return {
      inside: () => true,
      // Nearest point on the rectangle's boundary (the image edge frame),
      // in image pixel coordinates — used by the border-ring offset.
      project: (px, py) => {
        const dx = Math.min(px, gw - px);
        const dy = Math.min(py, gh - py);
        if (dx <= dy) return [clamp(px, 0, gw), py * 2 <= gh ? 0 : gh];
        return [px * 2 <= gw ? 0 : gw, clamp(py, 0, gh)];
      },
    };
  }
  if (shape.type === "custom") {
    const { x0, y0, x1, y1 } = customRectBounds(shape, gw, gh);
    const clamp = (v: number, lo: number, hi: number) =>
      Math.max(lo, Math.min(hi, v));
    return {
      inside: (px, py) => px >= x0 && px <= x1 && py >= y0 && py <= y1,
      // Nearest point on the crop-rect boundary (falls back to clamping
      // when the query point is strictly inside).
      project: (px, py) => {
        const cx = clamp(px, x0, x1);
        const cy = clamp(py, y0, y1);
        if (cx !== px || cy !== py) return [cx, cy];
        const dx = Math.min(px - x0, x1 - px);
        const dy = Math.min(py - y0, y1 - py);
        if (dx <= dy) return [px - x0 <= x1 - px ? x0 : x1, cy];
        return [cx, py - y0 <= y1 - py ? y0 : y1];
      },
    };
  }
  const minDim = Math.min(gw, gh);
  const radiusPx = Math.max(1e-9, (shape.size * minDim) / 2);
  const cpx = shape.cx * gw;
  const cpy = shape.cy * gh;
  const poly = shapePolygon(shape.type as Exclude<ShapeType, "custom">); // non-null for polygonal shapes
  const unitType = shape.type as Exclude<ShapeType, "custom">;
  const base = {
    inside: (px: number, py: number) =>
      insideUnit(
        unitType,
        (px - cpx) / radiusPx,
        (cpy - py) / radiusPx
      ),
    project: (px: number, py: number): [number, number] => {
      const [ux, uy] = projectUnit(
        unitType,
        (px - cpx) / radiusPx,
        (cpy - py) / radiusPx
      );
      return [ux * radiusPx + cpx, cpy - uy * radiusPx];
    },
  };
  if (!poly) return base;
  // Polygonal shapes: rebind to the polygon built above. insideUnit/
  // projectUnit would call shapePolygon() again on every invocation, and
  // this path runs per pixel (the classifier's coverage fallback) and per
  // boundary vertex (mesh clipping) — rebuilding the outline each time made
  // dense shapes (ghost, gingerbread) markedly slower to process.
  base.inside = (px: number, py: number) =>
    pointInPolygon((px - cpx) / radiusPx, (cpy - py) / radiusPx, poly);
  base.project = (px: number, py: number): [number, number] => {
    const [ux, uy] = projectToPolygon(
      (px - cpx) / radiusPx,
      (cpy - py) / radiusPx,
      poly
    );
    return [ux * radiusPx + cpx, cpy - uy * radiusPx];
  };
  // Scanline rasterizer for polygon shapes: for each fine row, intersect the
  // row with every polygon edge (even-odd rule) and fill the spans between
  // crossings. Cell centers sit at (fx + 0.5) / sub in pixel coordinates.
  const fillFine = (gwid: number, ghid: number, s: number): Uint8Array => {
    const fw = gwid * s;
    const fh = ghid * s;
    const out = new Uint8Array(fw * fh);
    for (let fy = 0; fy < fh; fy++) {
      // unit-space Y of this row's cell centers (+Y up)
      const uy = (cpy - (fy + 0.5) / s) / radiusPx;
      const xs: number[] = [];
      for (let i = 0, j = poly!.length - 1; i < poly!.length; j = i++) {
        const [xi, yi] = poly![i];
        const [xj, yj] = poly![j];
        if (yi > uy !== yj > uy) {
          xs.push(xi + ((uy - yi) * (xj - xi)) / (yj - yi));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        // unit -> pixel -> fine column range of centers inside [xs[k], xs[k+1]]
        const lo = xs[k] * radiusPx + cpx;
        const hi = xs[k + 1] * radiusPx + cpx;
        const fx0 = Math.ceil(lo * s - 0.5);
        const fx1 = Math.floor(hi * s - 0.5);
        for (let fx = Math.max(0, fx0); fx <= Math.min(fw - 1, fx1); fx++) {
          out[fy * fw + fx] = 1;
        }
      }
    }
    return out;
  };
  return { ...base, fillFine };
}

/**
 * Classify every pixel of the grid against the shape:
 * 0 = outside the shape (no geometry), 1 = border ring, 2 = inside.
 * Returns null when there is nothing to do (full rectangle, no border).
 */
export function classifyPixels(
  gw: number,
  gh: number,
  shape: ShapeParams,
  borderPx: number,
  /**
   * Exact pixel-intersection test (fractional pixel coords of the pixel's
   * lower-left corner): true when any part of the pixel overlaps the shape.
   * When provided (e.g. derived from the fine silhouette grid), it replaces
   * the sampled center/corner coverage test below and matches the mesh
   * clip exactly.
   */
  pixelIntersects?: (x: number, y: number) => boolean
): Uint8Array | null {
  if (shape.type === "rectangle" && borderPx <= 0) return null;
  const out = new Uint8Array(gw * gh);
  const minDim = Math.min(gw, gh);
  const radiusPx = (shape.size * minDim) / 2;
  const cpx = shape.cx * gw;
  const cpy = shape.cy * gh;
  const scaleX = 1 / radiusPx;
  const scaleY = 1 / radiusPx;
  const needPoly = !["rectangle", "circle", "square", "custom"].includes(
    shape.type
  );
  const poly = needPoly
    ? shapePolygon(shape.type as Exclude<ShapeType, "custom">)
    : null;
  const silhouette =
    shape.type !== "rectangle" ? makeShapeSilhouette(shape, gw, gh) : null;
  // Pixel-space crop rect for "custom" (avoids degenerate radiusPx math).
  const customBounds =
    shape.type === "custom" ? customRectBounds(shape, gw, gh) : null;

  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      // pixel center, image row 0 = top -> unit +Y is up -> flip
      const ux = (x + 0.5 - cpx) * scaleX;
      const uy = -(y + 0.5 - cpy) * scaleY;
      const i = y * gw + x;

      // Solidity uses area coverage, not just the pixel center: a pixel
      // counts as inside when any part of it overlaps the shape. The mesh
      // generator clips boundary columns cell-by-cell against the exact
      // silhouette, so this only decides which pixels can contribute
      // material (and therefore which color/height they carry) — geometry
      // never spills outside the true shape boundary.
      let inside: boolean;
      if (pixelIntersects) {
        inside = pixelIntersects(x, y);
      } else if (shape.type === "rectangle") {
        inside = true;
      } else if (shape.type === "circle") {
        inside = ux * ux + uy * uy <= 1;
      } else if (shape.type === "square") {
        inside = Math.abs(ux) <= 1 && Math.abs(uy) <= 1;
      } else if (shape.type === "custom") {
        const b = customBounds!;
        // Pixel-overlap test: pixel [x, x+1] x [y, y+1] vs crop rect.
        inside = x < b.x1 && x + 1 > b.x0 && y < b.y1 && y + 1 > b.y0;
      } else {
        inside = pointInPolygon(ux, uy, poly!);
      }
      if (!inside && silhouette) {
        inside =
          silhouette.inside(x, y) ||
          silhouette.inside(x + 1, y) ||
          silhouette.inside(x, y + 1) ||
          silhouette.inside(x + 1, y + 1) ||
          silhouette.inside(x + 0.5, y + 0.5);
      }
      if (!inside) {
        out[i] = 0;
        continue;
      }

      if (borderPx > 0) {
        let d: number; // distance to the shape boundary, in pixels
        if (shape.type === "circle") {
          d = Math.abs(1 - Math.sqrt(ux * ux + uy * uy)) * radiusPx;
        } else if (shape.type === "square") {
          d = Math.min(1 - Math.abs(ux), 1 - Math.abs(uy)) * radiusPx;
        } else if (shape.type === "rectangle" || shape.type === "custom") {
          // border = frame around the shape edges (image frame / crop rect)
          const b = customBounds;
          d = b
            ? Math.min(x - b.x0, y - b.y0, b.x1 - 1 - x, b.y1 - 1 - y)
            : Math.min(x, y, gw - 1 - x, gh - 1 - y);
        } else {
          d = distanceToPolygon(ux, uy, poly!) * radiusPx;
        }
        if (d <= borderPx) {
          out[i] = 1;
          continue;
        }
      }
      out[i] = 2;
    }
  }

  // Remove diagonal pinches: two solid cells touching only diagonally would
  // leave a non-manifold edge in the mesh. Fill one of the two orthogonal
  // empty cells with the pair's class (preferring border) — a 1-pixel nudge
  // that is invisible at print scale.
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < gh - 1; y++) {
      for (let x = 0; x < gw - 1; x++) {
        const i = y * gw + x;
        const a = out[i];
        const b = out[i + gw + 1];
        if (a > 0 && b > 0 && out[i + 1] === 0 && out[i + gw] === 0) {
          out[i + 1] = Math.min(a, b);
        } else {
          const a2 = out[i + 1];
          const b2 = out[i + gw];
          if (
            a2 > 0 &&
            b2 > 0 &&
            out[i] === 0 &&
            out[i + gw + 1] === 0
          ) {
            out[i] = Math.min(a2, b2);
          }
        }
      }
    }
  }

  return out;
}

/**
 * Unit-space polygon vertices for drawing the shape outline in previews,
 * sampled at the given resolution (for circle-ish shapes like heart).
 */
export function shapeOutlinePoints(
  type: ShapeType,
  samples = 128
): [number, number][] {
  // "custom" is a pixel-space crop rect, not a unit-space outline; it is
  // drawn directly as a rect in Preview2D and never needs outline points.
  if (type === "custom") return [];
  const poly = shapePolygon(type);
  if (poly) return poly;
  if (type === "circle") {
    const pts: [number, number][] = [];
    for (let k = 0; k < samples; k++) {
      const a = (k * 2 * Math.PI) / samples;
      pts.push([Math.cos(a), Math.sin(a)]);
    }
    return pts;
  }
  // square / rectangle
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
}
