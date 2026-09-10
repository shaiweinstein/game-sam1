/* Horizontal discs only: the umbrella canopy and decorative props stay walkable. */
export const CHARACTER_RADIUS = 0.26;

export function moveAroundProps(from, to, obstacles, radius = CHARACTER_RADIUS) {
  const p = { x: from.x, z: from.z };
  // Recover safely if a newly grounded prop overlaps an existing anchor.
  for (const o of obstacles) {
    const r = radius + o.radius + 0.001;
    const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz);
    if (d < r) {
      p.x = o.x + (d > 1e-8 ? dx / d : 1) * r;
      p.z = o.z + (d > 1e-8 ? dz / d : 0) * r;
    }
  }
  let dx = to.x - p.x, dz = to.z - p.z;
  // Swept circle contact prevents tunnelling, including the final arrival snap.
  for (let pass = 0; pass < 3; pass++) {
    const a = dx * dx + dz * dz;
    if (a < 1e-14) break;
    let time = 1, hit = null;
    for (const o of obstacles) {
      const r = radius + o.radius;
      const ox = p.x - o.x, oz = p.z - o.z;
      const b = ox * dx + oz * dz, c = ox * ox + oz * oz - r * r;
      const disc = b * b - a * c;
      if (b >= 0 || disc < 0) continue;
      const t = (-b - Math.sqrt(disc)) / a;
      if (t >= 0 && t < time) { time = t; hit = o; }
    }
    const travel = Math.max(0, time - (hit ? 1e-5 : 0));
    p.x += dx * travel; p.z += dz * travel;
    if (!hit) break;
    dx *= 1 - travel; dz *= 1 - travel;
    const nx = p.x - hit.x, nz = p.z - hit.z;
    const inward = Math.min(0, (dx * nx + dz * nz) / (nx * nx + nz * nz));
    dx -= nx * inward; dz -= nz * inward;
  }
  return p;
}

/* A tiny visibility graph for scripted approach/exit only. Native holds slide
   at contact, while automatic actors take a complete route around both discs. */
export function routeAroundProps(from, to, obstacles, bounds) {
  const nodes = [{ x: from.x, z: from.z }, { x: to.x, z: to.z }];
  for (const o of obstacles) {
    const r = (o.radius + CHARACTER_RADIUS + 0.07) / Math.cos(Math.PI / 12);
    for (let i = 0; i < 12; i++) {
      const p = { x: o.x + Math.cos(i * Math.PI / 6) * r,
        z: o.z + Math.sin(i * Math.PI / 6) * r };
      if (p.x >= bounds.xMin && p.x <= bounds.xMax && p.z >= bounds.zMin && p.z <= bounds.zMax) nodes.push(p);
    }
  }
  const clear = (a, b) => obstacles.every(o => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((o.x - a.x) * dx + (o.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    // A native hold may leave the actor exactly at contact. Permit an outward
    // first edge from there; inflating that endpoint would trap every route.
    const margin = a === nodes[0] ? -1e-6 : 0.015;
    return Math.hypot(a.x + dx * t - o.x, a.z + dz * t - o.z) >= o.radius + CHARACTER_RADIUS + margin;
  });
  const distance = nodes.map(() => Infinity), previous = [], visited = new Set();
  distance[0] = 0;
  for (let step = 0; step < nodes.length; step++) {
    let best = -1;
    for (let i = 0; i < nodes.length; i++) {
      if (!visited.has(i) && (best < 0 || distance[i] < distance[best])) best = i;
    }
    if (best < 0 || !Number.isFinite(distance[best])) break;
    if (best === 1) {
      const path = [];
      for (let i = 1; i !== 0; i = previous[i]) path.unshift(nodes[i]);
      return path;
    }
    visited.add(best);
    for (let i = 1; i < nodes.length; i++) {
      if (visited.has(i) || !clear(nodes[best], nodes[i])) continue;
      const d = distance[best] + Math.hypot(nodes[best].x - nodes[i].x, nodes[best].z - nodes[i].z);
      if (d < distance[i]) { distance[i] = d; previous[i] = best; }
    }
  }
  return null;
}
