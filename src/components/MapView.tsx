import { useEffect, useRef } from "react";
import type { LatLng } from "@/lib/geo";
// NOTE: do NOT import 'leaflet' at module top — it touches `window` and breaks SSR.
// Import dynamically inside useEffect so it only runs in the browser.
import type * as LeafletNS from "leaflet";

interface Props {
  source?: LatLng | null;
  destination?: LatLng | null;
  route?: LatLng[];
  alternativeRoutes?: LatLng[][];
  waypoints?: LatLng[];
  current?: LatLng | null;
  deviating?: boolean;
  onMapClick?: (latlng: LatLng) => void;
  onAlternativeClick?: (index: number) => void;
  className?: string;
}

function pinIcon(L: typeof LeafletNS, color: string, label: string) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:32px;height:32px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      background:${color};
      border:3px solid white;
      box-shadow:0 4px 8px rgba(0,0,0,0.25);
      display:flex;align-items:center;justify-content:center;
    "><span style="transform:rotate(45deg);color:white;font-weight:700;font-size:12px;">${label}</span></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
  });
}

function liveIcon(L: typeof LeafletNS, deviating: boolean) {
  const c = deviating ? "#e35d5b" : "#1f9e8e";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:20px;height:20px;">
      <div style="position:absolute;inset:0;border-radius:50%;background:${c};border:3px solid white;box-shadow:0 0 0 4px ${c}40;"></div>
    </div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

export function MapView({ source, destination, route, alternativeRoutes, waypoints, current, deviating, onMapClick, onAlternativeClick, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const LRef = useRef<typeof LeafletNS | null>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const layersRef = useRef<{
    src?: LeafletNS.Marker; dst?: LeafletNS.Marker; live?: LeafletNS.Marker; route?: LeafletNS.Polyline;
    alts: LeafletNS.Polyline[]; waypoints: LeafletNS.Marker[];
  }>({ alts: [], waypoints: [] });
  const propsRef = useRef({ source, destination, route, alternativeRoutes, waypoints, current, deviating, onMapClick, onAlternativeClick });
  propsRef.current = { source, destination, route, alternativeRoutes, waypoints, current, deviating, onMapClick, onAlternativeClick };

  // Init (browser only)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mod = await import("leaflet");
      if (cancelled || !containerRef.current) return;
      const L = mod.default ?? mod;
      LRef.current = L;
      const map = L.map(containerRef.current, { center: [20, 0], zoom: 2, zoomControl: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      applySource(propsRef.current.source ?? null);
      applyDestination(propsRef.current.destination ?? null);
      applyAlternatives(propsRef.current.alternativeRoutes);
      applyRoute(propsRef.current.route, propsRef.current.source ?? null, propsRef.current.destination ?? null);
      applyWaypoints(propsRef.current.waypoints);
      applyCurrent(propsRef.current.current ?? null, !!propsRef.current.deviating);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      LRef.current = null;
      layersRef.current = { alts: [], waypoints: [] };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !onMapClick) return;
    const handler = (e: LeafletNS.LeafletMouseEvent) =>
      onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    map.on("click", handler);
    return () => { map.off("click", handler); };
  }, [onMapClick]);

  function applySource(src: LatLng | null) {
    const map = mapRef.current; const L = LRef.current; if (!map || !L) return;
    if (layersRef.current.src) { layersRef.current.src.remove(); layersRef.current.src = undefined; }
    if (src) layersRef.current.src = L.marker([src.lat, src.lng], { icon: pinIcon(L, "#1f9e8e", "A") }).addTo(map);
  }
  function applyDestination(dst: LatLng | null) {
    const map = mapRef.current; const L = LRef.current; if (!map || !L) return;
    if (layersRef.current.dst) { layersRef.current.dst.remove(); layersRef.current.dst = undefined; }
    if (dst) layersRef.current.dst = L.marker([dst.lat, dst.lng], { icon: pinIcon(L, "#e35d5b", "B") }).addTo(map);
  }
  function applyAlternatives(alts: LatLng[][] | undefined) {
    const map = mapRef.current; const L = LRef.current; if (!map || !L) return;
    layersRef.current.alts.forEach((p) => p.remove());
    layersRef.current.alts = [];
    if (!alts) return;
    alts.forEach((coords, idx) => {
      if (coords.length < 2) return;
      const line = L.polyline(coords.map((p) => [p.lat, p.lng] as [number, number]), {
        color: "#94a3b8", weight: 5, opacity: 0.6, dashArray: "8 8",
      }).addTo(map);
      const cb = propsRef.current.onAlternativeClick;
      if (cb) {
        line.on("click", (e: LeafletNS.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          cb(idx);
        });
        line.on("mouseover", () => line.setStyle({ color: "#1f9e8e", opacity: 0.9 }));
        line.on("mouseout", () => line.setStyle({ color: "#94a3b8", opacity: 0.6 }));
      }
      layersRef.current.alts.push(line);
    });
  }
  function applyWaypoints(pts: LatLng[] | undefined) {
    const map = mapRef.current; const L = LRef.current; if (!map || !L) return;
    layersRef.current.waypoints.forEach((m) => m.remove());
    layersRef.current.waypoints = [];
    if (!pts) return;
    pts.forEach((p, i) => {
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:22px;height:22px;border-radius:50%;background:#7c3aed;color:white;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;">${i + 1}</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      layersRef.current.waypoints.push(L.marker([p.lat, p.lng], { icon }).addTo(map));
    });
  }
  function applyRoute(rt: LatLng[] | undefined, src: LatLng | null, dst: LatLng | null) {
    const map = mapRef.current; const L = LRef.current; if (!map || !L) return;
    if (layersRef.current.route) { layersRef.current.route.remove(); layersRef.current.route = undefined; }
    if (rt && rt.length > 1) {
      const line = L.polyline(rt.map((p) => [p.lat, p.lng] as [number, number]), {
        color: "#1f9e8e", weight: 5, opacity: 0.85,
      }).addTo(map);
      layersRef.current.route = line;
      map.fitBounds(line.getBounds(), { padding: [40, 40] });
    } else if (src && dst) {
      map.fitBounds(L.latLngBounds([src.lat, src.lng], [dst.lat, dst.lng]), { padding: [40, 40] });
    } else if (src) {
      map.setView([src.lat, src.lng], 13);
    }
  }
  function applyCurrent(cur: LatLng | null, dev: boolean) {
    const map = mapRef.current; const L = LRef.current; if (!map || !L) return;
    if (layersRef.current.live) { layersRef.current.live.remove(); layersRef.current.live = undefined; }
    if (cur) layersRef.current.live = L.marker([cur.lat, cur.lng], { icon: liveIcon(L, dev), zIndexOffset: 1000 }).addTo(map);
  }

  useEffect(() => { applySource(source ?? null); }, [source]);
  useEffect(() => { applyDestination(destination ?? null); }, [destination]);
  useEffect(() => { applyAlternatives(alternativeRoutes); }, [alternativeRoutes]);
  useEffect(() => { applyRoute(route, source ?? null, destination ?? null); }, [route, source, destination]);
  useEffect(() => { applyWaypoints(waypoints); }, [waypoints]);
  useEffect(() => { applyCurrent(current ?? null, !!deviating); }, [current, deviating]);

  return <div ref={containerRef} className={className} style={{ minHeight: 400 }} />;
}
