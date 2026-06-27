export type LatLng = { lat: number; lng: number };

export function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000; // meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Min distance from point p to a polyline (in meters).
export function distanceToPolyline(p: LatLng, line: LatLng[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return haversine(p, line[0]);
  let min = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const d = distanceToSegment(p, line[i], line[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

function distanceToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  // Project to local planar coords using equirectangular approximation.
  const toXY = (pt: LatLng, ref: LatLng) => {
    const R = 6371000;
    const x = ((pt.lng - ref.lng) * Math.PI) / 180 * R * Math.cos((ref.lat * Math.PI) / 180);
    const y = ((pt.lat - ref.lat) * Math.PI) / 180 * R;
    return { x, y };
  };
  const ref = a;
  const P = toXY(p, ref);
  const A = { x: 0, y: 0 };
  const B = toXY(b, ref);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(P.x, P.y);
  let t = (P.x * dx + P.y * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = A.x + t * dx;
  const cy = A.y + t * dy;
  return Math.hypot(P.x - cx, P.y - cy);
}

export type GeocodeResult = { label: string; lat: number; lng: number };

export async function geocode(query: string): Promise<GeocodeResult[]> {
  if (!query.trim()) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  const data = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>;
  return data.map((d) => ({ label: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon) }));
}

export type Route = {
  coordinates: LatLng[]; // ordered polyline
  distanceMeters: number;
  durationSeconds: number;
};

export type TravelMode = "driving" | "walking";

// OSRM demo server only supports driving. For walking, use the OSM-hosted
// multi-profile router at routing.openstreetmap.de (routed-foot).
function osrmBase(mode: TravelMode): string {
  return mode === "walking"
    ? "https://routing.openstreetmap.de/routed-foot"
    : "https://router.project-osrm.org";
}

export async function fetchRoute(from: LatLng, to: LatLng, mode: TravelMode = "driving"): Promise<Route | null> {
  const all = await fetchRouteAlternatives(from, to, mode);
  return all[0] ?? null;
}

export async function fetchRouteAlternatives(from: LatLng, to: LatLng, mode: TravelMode = "driving"): Promise<Route[]> {
  const url = `${osrmBase(mode)}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&alternatives=3`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  const routes = (data.routes ?? []) as Array<{
    geometry: { coordinates: [number, number][] };
    distance: number;
    duration: number;
  }>;
  return routes.map((r) => ({
    coordinates: r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
    distanceMeters: r.distance,
    durationSeconds: r.duration,
  }));
}

// Build a route through ordered waypoints (snapped to paths via OSRM).
export async function fetchRouteThroughWaypoints(points: LatLng[], mode: TravelMode = "driving"): Promise<Route | null> {
  if (points.length < 2) return null;
  const coordsStr = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `${osrmBase(mode)}/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const r = data.routes?.[0];
  if (!r) return null;
  return {
    coordinates: (r.geometry.coordinates as [number, number][]).map(([lng, lat]) => ({ lat, lng })),
    distanceMeters: r.distance,
    durationSeconds: r.duration,
  };
}

// Build a straight-line "as-the-crow-flies" route through waypoints (no road snapping).
export function straightLineRoute(points: LatLng[]): Route | null {
  if (points.length < 2) return null;
  const distanceMeters = points.slice(1).reduce((sum, p, i) => sum + haversine(points[i], p), 0);
  return { coordinates: points, distanceMeters, durationSeconds: 0 };
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function formatDuration(s: number): string {
  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}