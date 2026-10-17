/*
 * `three` ships without types at the version view3d pins (0.134), and only the
 * hotspot picker in ViewerPreview.tsx imports it directly — for a Raycaster,
 * Vector2/3 and Triangle.getBarycoord. Typed loosely rather than pulling in
 * @types/three, whose versions track three's and would have to be pinned to
 * match.
 */
declare module "three";
