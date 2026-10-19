// Area results and names, shared by the simulation and the renderer (the renderer may only
// import from shared/, F8 §14 tests).

export interface AreaResult {
  regionId: Int32Array;          // -1 on intact wall tiles
  count: number;                 // number of regions
  tileCount: Int32Array;         // per region
  firstTile: Int32Array;         // per region, lowest tile index (its top-left-most tile)
  centerX: Float64Array;         // per region, mean tile x
  centerY: Float64Array;
}

/** Display name of a region ("Area 1" is the region with the lowest tile index). */
export const areaName = (regionId: number): string => `Area ${regionId + 1}`;
