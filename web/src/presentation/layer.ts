// CesiumJS side of the race presentation: turns the meshes from geometry.ts into
// primitives. Turning it off destroys every primitive and material (and so the textures),
// so repeated toggles do not pile up GPU memory. Fictional event dressing only.

import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Cartographic,
  ComponentDatatype,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  GeometryInstance,
  GeometryPipeline,
  Material,
  MaterialAppearance,
  Primitive,
  PrimitiveCollection,
  PrimitiveType,
  type TerrainProvider,
  type Viewer,
  sampleTerrainMostDetailed,
} from "cesium";
import type { Course } from "../course";
import { LatestOnly } from "../latest";
import { buildTrack } from "../vehicle/track";
import type { PresentationConfig } from "./config";
import { buildMeshes, type Grid, gridIndices } from "./geometry";
import { adTexture, concreteTexture, fenceTexture, roadTexture } from "./textures";

export interface PresentationStats {
  vertices: number;
  triangles: number;
  primitives: number;
  terrainSamples: number;
  buildMs: number;
}

function toGeometry(grid: Grid, heights: number[]): Geometry {
  const n = grid.lonLat.length;
  const positions = new Float64Array(n * 3);
  const st = new Float32Array(n * 2);
  const p = new Cartesian3();
  for (let i = 0; i < n; i++) {
    const [lon, lat] = grid.lonLat[i];
    Cartesian3.fromDegrees(lon, lat, heights[i] + grid.up[i], undefined, p);
    positions.set([p.x, p.y, p.z], i * 3);
    st.set(grid.uv[i], i * 2);
  }
  const attributes = new GeometryAttributes();
  attributes.position = new GeometryAttribute({ componentDatatype: ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: positions });
  attributes.st = new GeometryAttribute({ componentDatatype: ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: st });
  const geometry = new Geometry({
    attributes,
    indices: new Uint32Array(gridIndices(grid.rows, grid.cols)),
    primitiveType: PrimitiveType.TRIANGLES,
    boundingSphere: BoundingSphere.fromVertices(Array.from(positions)),
  });
  return GeometryPipeline.computeNormal(geometry);
}

export class RacePresentation {
  private collection: PrimitiveCollection | null = null;
  private materials: Material[] = [];
  private readonly loads = new LatestOnly();
  stats: PresentationStats | null = null;

  constructor(private readonly viewer: Viewer) {}

  get shown(): boolean {
    return this.collection !== null;
  }

  /**
   * Build and add the presentation for `course`. Heights come from the same terrain as the
   * vehicle (ellipsoid when there is none). Returns false if hide()/show() was called again
   * meanwhile; the stale result is discarded.
   */
  async show(course: Course, cfg: PresentationConfig, terrain: TerrainProvider | null): Promise<boolean> {
    const generation = this.loads.begin();
    this.clear();
    const t0 = performance.now();
    const track = buildTrack(course.coordinates, course.mode === "circuit");
    const meshes = buildMeshes(track, cfg);
    const grids = [meshes.road, ...meshes.barriers, ...meshes.fences, ...meshes.ads.map((a) => a.grid)];

    // one terrain query for every vertex of every grid
    const points = grids.flatMap((g) => g.lonLat.map(([lon, lat]) => Cartographic.fromDegrees(lon, lat)));
    if (terrain) await sampleTerrainMostDetailed(terrain, points);
    if (!this.loads.isCurrent(generation)) return false;
    let next = 0;
    const heightsFor = (g: Grid) => g.lonLat.map(() => (terrain ? points[next++].height : 0));
    const heights = new Map(grids.map((g) => [g, heightsFor(g)]));

    const collection = new PrimitiveCollection();
    const add = (gs: Grid[], material: Material, translucent = false) => {
      this.materials.push(material);
      collection.add(
        new Primitive({
          geometryInstances: gs.map((g) => new GeometryInstance({ geometry: toGeometry(g, heights.get(g) as number[]) })),
          appearance: new MaterialAppearance({
            material,
            translucent,
            closed: false,
            faceForward: true,
            materialSupport: MaterialAppearance.MaterialSupport.TEXTURED,
          }),
          asynchronous: false,
        }),
      );
    };
    const image = (canvas: HTMLCanvasElement, translucent = false) =>
      new Material({ fabric: { type: "Image", uniforms: { image: canvas, repeat: new Cartesian2(1, 1) } }, translucent });

    add([meshes.road], image(roadTexture(cfg.road)));
    add(meshes.barriers, image(concreteTexture()));
    if (meshes.fences.length) add(meshes.fences, image(fenceTexture(), true), true);
    for (const ad of meshes.ads) add([ad.grid], image(adTexture(ad.panel.sponsor, cfg.ads.subText, cfg.ads.lengthM / cfg.ads.heightM)));

    this.collection = this.viewer.scene.primitives.add(collection) as PrimitiveCollection;
    this.stats = {
      vertices: grids.reduce((a, g) => a + g.lonLat.length, 0),
      triangles: grids.reduce((a, g) => a + 2 * (g.rows - 1) * (g.cols - 1), 0),
      primitives: collection.length,
      terrainSamples: terrain ? points.length : 0,
      buildMs: Math.round(performance.now() - t0),
    };
    return true;
  }

  hide(): void {
    this.loads.begin(); // drop a show() still waiting for terrain
    this.clear();
  }

  private clear(): void {
    // removing the collection destroys it and its primitives; materials own the textures
    if (this.collection) this.viewer.scene.primitives.remove(this.collection);
    this.collection = null;
    for (const m of this.materials) m.destroy();
    this.materials = [];
    this.stats = null;
  }
}
