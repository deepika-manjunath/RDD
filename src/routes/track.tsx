import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  AlertTriangle, Crosshair, MapPin, Navigation2, Play, Square, Search, Loader2, Siren,
} from "lucide-react";
import { MapView } from "@/components/MapView";
import { sendSosSms } from "@/fns/sos.functions.server";
import {
  geocode, fetchRouteAlternatives, fetchRouteThroughWaypoints, straightLineRoute,
  haversine, distanceToPolyline, formatDistance, formatDuration,
  type LatLng, type GeocodeResult, type Route as RouteData, type TravelMode,
} from "@/lib/geo";
import { Car, PersonStanding } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type { Database, Json } from "@/integrations/supabase/types";

type Trip = Database["public"]["Tables"]["trips"]["Row"];

export const Route = createFileRoute("/track")({
  validateSearch: (search: Record<string, unknown>) => ({
    reuseTrip:
      typeof search.reuseTrip === "string"
        ? search.reuseTrip
        : undefined,
  }),

  head: () => ({
    meta: [
      { title: "Live tracking — SafeRoute" },
      {
        name: "description",
        content:
          "Plan a trip and track your live location with deviation detection.",
      },
    ],
  }),

  component: TrackPage,
});

const DEVIATION_THRESHOLD_DRIVING_M = 150;  // off-route distance to trigger (driving)
const DEVIATION_THRESHOLD_WALKING_M = 60;   // tighter — walkers stay near the path
const INACTIVITY_THRESHOLD_DRIVING_S = 90;  // idle (driving)
const INACTIVITY_THRESHOLD_WALKING_S = 180; // idle (walking — natural pauses)
const ALERT_COUNTDOWN_S = 20;               // user grace period

function routeFromTripGeometry(geometry: Json | null): RouteData | null {
  if (!Array.isArray(geometry)) return null;
  const coordinates = geometry
    .map((point) => {
      if (!point || typeof point !== "object" || Array.isArray(point)) return null;
      const { lat, lng } = point as { lat?: unknown; lng?: unknown };
      return typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;
    })
    .filter((point): point is LatLng => Boolean(point));
  if (coordinates.length < 2) return null;
  const distanceMeters = coordinates.slice(1).reduce((sum, point, index) => sum + haversine(coordinates[index], point), 0);
  return { coordinates, distanceMeters, durationSeconds: 0 };
}

function TrackPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { reuseTrip } = Route.useSearch();

  const [travelMode, setTravelMode] = useState<TravelMode>("driving");
  const deviationThreshold = travelMode === "walking" ? DEVIATION_THRESHOLD_WALKING_M : DEVIATION_THRESHOLD_DRIVING_M;
  const inactivityThreshold = travelMode === "walking" ? INACTIVITY_THRESHOLD_WALKING_S : INACTIVITY_THRESHOLD_DRIVING_S;

  const [sourceQuery, setSourceQuery] = useState("");
  const [destQuery, setDestQuery] = useState("");
  const [sourceResults, setSourceResults] = useState<GeocodeResult[]>([]);
  const [destResults, setDestResults] = useState<GeocodeResult[]>([]);
  const [source, setSource] = useState<GeocodeResult | null>(null);
  const [destination, setDestination] = useState<GeocodeResult | null>(null);
  const [route, setRoute] = useState<RouteData | null>(null);
  const [alternatives, setAlternatives] = useState<RouteData[]>([]);
  const [selectedAltIdx, setSelectedAltIdx] = useState<number | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [snapToRoads, setSnapToRoads] = useState(true);
  const [waypoints, setWaypoints] = useState<LatLng[]>([]);
  const [searching, setSearching] = useState<"src" | "dst" | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [restoringTrip, setRestoringTrip] = useState(true);

  const [tripId, setTripId] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const [useReal, setUseReal] = useState(true);
  const [current, setCurrent] = useState<LatLng | null>(null);
  const [deviating, setDeviating] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertReason, setAlertReason] = useState<"deviation" | "inactivity" | "sos">("deviation");
  const [countdown, setCountdown] = useState(ALERT_COUNTDOWN_S);

  const lastMoveRef = useRef<number>(Date.now());
  const lastPosRef = useRef<LatLng | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const simIndexRef = useRef<number>(0);
  const simTimerRef = useRef<number | null>(null);
  const inactivityTimerRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const alertOpenRef = useRef<boolean>(false);
  const escalatingRef = useRef<boolean>(false);



  useEffect(() => { alertOpenRef.current = alertOpen; }, [alertOpen]);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setRestoringTrip(true);
      const { data, error } = await supabase
        .from("trips")
        .select("*")
        .eq("user_id", user.id)
        .in("status", ["active", "emergency"])
        .is("ended_at", null)
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        toast.error(error.message);
      } else if (data) {
        restoreTrip(data, true);
      }
      setRestoringTrip(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
  if (!user || !reuseTrip) return;

  let cancelled = false;

  (async () => {
    const { data, error } = await supabase
      .from("trips")
      .select("*")
      .eq("id", reuseTrip)
      .eq("user_id", user.id)
      .single();

    if (cancelled) return;

    if (error) {
      toast.error("Couldn't load saved trip.");
      return;
    }

    restoreTrip(data, false);
  })();

  return () => {
    cancelled = true;
  };
}, [user, reuseTrip]);

  function restoreTrip(trip: Trip, active: boolean) {
  const restoredSource = {
    label: trip.source_label,
    lat: trip.source_lat,
    lng: trip.source_lng,
  };

  const restoredDestination = {
    label: trip.destination_label,
    lat: trip.destination_lat,
    lng: trip.destination_lng,
  };

  const restoredRoute = routeFromTripGeometry(trip.route_geometry);

  setSource(restoredSource);
  setDestination(restoredDestination);

  setSourceQuery(trip.source_label);
  setDestQuery(trip.destination_label);

  setRoute(restoredRoute);

  if (active) {
    setTripId(trip.id);

    setCurrent(restoredSource);

    lastPosRef.current = restoredSource;
    lastMoveRef.current = Date.now();

    setTracking(true);
  }
}

  // Geocode debounce for source
  useEffect(() => {
    if (!sourceQuery.trim()) { setSourceResults([]); return; }
    const t = setTimeout(async () => {
      setSearching("src");
      setSourceResults(await geocode(sourceQuery));
      setSearching(null);
    }, 400);
    return () => clearTimeout(t);
  }, [sourceQuery]);

  useEffect(() => {
    if (!destQuery.trim()) { setDestResults([]); return; }
    const t = setTimeout(async () => {
      setSearching("dst");
      setDestResults(await geocode(destQuery));
      setSearching(null);
    }, 400);
    return () => clearTimeout(t);
  }, [destQuery]);

  // Fetch route alternatives when both endpoints known (skip when drawing custom)
  useEffect(() => {
    if (!source || !destination) {
      setRoute(null); setAlternatives([]); setSelectedAltIdx(null); return;
    }
    if (drawMode) return;
    setRouteBusy(true);
    fetchRouteAlternatives(source, destination, travelMode).then((alts) => {
      setAlternatives(alts);
      setRoute(alts[0] ?? null);
      setSelectedAltIdx(alts.length ? 0 : null);
      setRouteBusy(false);
      if (alts.length === 0) toast.error("Could not compute a route between those points.");
    });
  }, [source, destination, drawMode, travelMode]);

  function selectAlternative(idx: number) {
    const alt = alternatives[idx];
    if (!alt) return;
    setSelectedAltIdx(idx);
    setRoute(alt);
  }

  // Recompute the drawn route whenever waypoints / mode change
  useEffect(() => {
    if (!drawMode || !source || !destination) return;
    const pts: LatLng[] = [source, ...waypoints, destination];
    if (pts.length < 2) { setRoute(null); return; }
    if (!snapToRoads) {
      setRoute(straightLineRoute(pts));
      return;
    }
    setRouteBusy(true);
    fetchRouteThroughWaypoints(pts, travelMode).then((r) => {
      setRoute(r ?? straightLineRoute(pts));
      setRouteBusy(false);
      if (!r) toast.error("Couldn't snap to roads — using straight lines.");
    });
  }, [drawMode, snapToRoads, waypoints, source, destination, travelMode]);

  function toggleDrawMode(enable: boolean) {
    setDrawMode(enable);
    setWaypoints([]);
    if (!enable) {
      // Restore best alternative
      if (alternatives.length) { setRoute(alternatives[0]); setSelectedAltIdx(0); }
    } else {
      setSelectedAltIdx(null);
    }
  }

  function clearWaypoints() { setWaypoints([]); }
  function undoWaypoint() { setWaypoints((w) => w.slice(0, -1)); }

  function pickResult(kind: "src" | "dst", r: GeocodeResult) {
    if (kind === "src") { setSource(r); setSourceQuery(r.label); setSourceResults([]); }
    else { setDestination(r); setDestQuery(r.label); setDestResults([]); }
  }

  async function useMyLocationAsSource() {
    if (!navigator.geolocation) { toast.error("Geolocation not supported"); return; }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const r: GeocodeResult = {
          label: `My location (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)})`,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        pickResult("src", r);
      },
      (err) => toast.error(err.message),
      { enableHighAccuracy: true },
    );
  }

  async function startTrip() {
    if (!user || !source || !destination || !route) {
      toast.error("Pick a source and destination first");
      return;
    }
    const { data, error } = await supabase
      .from("trips")
      .insert([{
        user_id: user.id,
        source_label: source.label,
        source_lat: source.lat,
        source_lng: source.lng,
        destination_label: destination.label,
        destination_lat: destination.lat,
        destination_lng: destination.lng,
        route_geometry: route.coordinates as unknown as import("@/integrations/supabase/types").Json,
        status: "active" as const,
        started_at: new Date().toISOString(),
      }])
      .select()
      .single();
    if (error || !data) { toast.error(error?.message || "Failed to start"); return; }
    setTripId(data.id);
    setTracking(true);
    lastMoveRef.current = Date.now();
    setCurrent({ lat: source.lat, lng: source.lng });
    lastPosRef.current = { lat: source.lat, lng: source.lng };
    simIndexRef.current = 0;
    toast.success("Trip started — stay safe!");
  }

  async function endTrip(
  status: "completed" | "cancelled" | "emergency" = "completed"
) {
  setTracking(false);

  if (tripId) {
    await supabase
      .from("trips")
      .update({
        status,
        ended_at: new Date().toISOString(),
      })
      .eq("id", tripId);
  }


  setTripId(null);
  setCurrent(null);
  setDeviating(false);
  setAlertOpen(false);

  // refresh the page to clear any active trip state
  setSource(null);
  setDestination(null);

  setSourceQuery("");
  setDestQuery("");

  setRoute(null);

  setAlternatives([]);
  setSelectedAltIdx(null);

  setWaypoints([]);

  setDrawMode(false);
}

  // Real GPS watcher
  useEffect(() => {
    if (!tracking || !useReal) return;
    if (!navigator.geolocation) { toast.error("Geolocation not supported"); return; }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        handleNewPosition(p);
      },
      (err) => toast.error(`Location error: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    watchIdRef.current = id;
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, useReal]);

  // Simulator
  useEffect(() => {
    if (!tracking || useReal || !route) return;
    simTimerRef.current = window.setInterval(() => {
      const coords = route.coordinates;
      if (simIndexRef.current >= coords.length) {
        if (simTimerRef.current) window.clearInterval(simTimerRef.current);
        toast.success("Arrived at destination");
        endTrip("completed");
        return;
      }
      // Inject deviation every ~25th step for demo flavor (10% chance)
      const base = coords[simIndexRef.current];
      const jitter = Math.random() < 0.08 ? 0.004 : 0; // ~400m off
      const p = { lat: base.lat + jitter, lng: base.lng + jitter };
      handleNewPosition(p);
      simIndexRef.current += 1;
    }, 1500);
    return () => {
      if (simTimerRef.current) { window.clearInterval(simTimerRef.current); simTimerRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, useReal, route]);

  function handleNewPosition(p: LatLng) {
    setCurrent(p);
    const moved = lastPosRef.current ? haversine(lastPosRef.current, p) : Infinity;
    if (moved > 8) lastMoveRef.current = Date.now(); // ~8m to count as movement
    lastPosRef.current = p;

    if (route) {
      const off = distanceToPolyline(p, route.coordinates);
      const isOff = off > deviationThreshold;
      setDeviating(isOff);
      if (isOff && !alertOpenRef.current) {
        triggerAlert("deviation");
      }
      // Arrived?
      if (destination && haversine(p, destination) < 40) {
        toast.success("Arrived safely 🎉");
        endTrip("completed");
      }
    }
  }

  // Inactivity watcher
  useEffect(() => {
    if (!tracking) return;
    inactivityTimerRef.current = window.setInterval(() => {
      const idle = (Date.now() - lastMoveRef.current) / 1000;
      if (idle > inactivityThreshold && !alertOpenRef.current) {
        triggerAlert("inactivity");
      }
    }, 5000);
    return () => {
      if (inactivityTimerRef.current) window.clearInterval(inactivityTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking]);

  function triggerAlert(reason: "deviation" | "inactivity" | "sos") {
    // Guard against re-entry: if an alert countdown is already running, don't restart it
    if (alertOpenRef.current || countdownTimerRef.current !== null || escalatingRef.current) return;
    setAlertReason(reason);
    setCountdown(ALERT_COUNTDOWN_S);
    setAlertOpen(true);
    alertOpenRef.current = true;
    countdownTimerRef.current = window.setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (countdownTimerRef.current) {
            window.clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }
          escalate(reason);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  function imSafe() {
    if (countdownTimerRef.current) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setAlertOpen(false);
    alertOpenRef.current = false;
    lastMoveRef.current = Date.now();
    setDeviating(false);
    toast.success("Marked as safe.");
  }

  async function escalate(reason: "deviation" | "inactivity" | "sos") {
    if (escalatingRef.current) return;
    escalatingRef.current = true;
    if (countdownTimerRef.current) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setAlertOpen(false);
    alertOpenRef.current = false;
    // Reset detectors so the alert doesn't immediately re-trigger while SMS sends
    lastMoveRef.current = Date.now();
    setDeviating(false);

    if (!user) {
      toast.error("🚨 Cannot send SOS: not signed in.", { duration: 8000 });
      return;
    }
    if (!tripId) {
      toast.error("🚨 Cannot send SOS: no active trip.", { duration: 8000 });
      return;
    }
    const sendingToast = toast.loading("🚨 Sending SOS to your contacts…");
    try {
      const res = await sendSosSms({
        data: {
          tripId,
          lat: current?.lat ?? null,
          lng: current?.lng ?? null,
          reason,
        },
      });
      console.log("SOS Response:", res);
      toast.dismiss(sendingToast);
      if (res.ok) {
        toast.error(
          `🚨 Emergency: SMS sent to ${res.successCount}/${res.contactsCount} contact(s) with your live location.`,
          { duration: 8000 },
        );
      } else if (res.contactsCount === 0) {
        toast.error("🚨 Emergency triggered, but no contacts are configured.", { duration: 8000 });
      } else {
        toast.error(`🚨 Emergency triggered, but SMS failed: ${res.error ?? "unknown error"}`, { duration: 8000 });
      }
    } catch (e) {
      toast.dismiss(sendingToast);
      const msg = e instanceof Error ? e.message : "Unknown error";
      console.error("SOS send failed", e);
      toast.error(`Failed to send SOS: ${msg}`, { duration: 8000 });
    } finally {
      escalatingRef.current = false;
    }
  }

  const stats = useMemo(() => {
    if (!route) return null;
    return {
      distance: formatDistance(route.distanceMeters),
      duration: formatDuration(route.durationSeconds),
    };
  }, [route]);

  if (loading || !user) return null;

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        {/* Sidebar */}
        <div className="space-y-4">
          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Plan your trip</CardTitle>
              <CardDescription>Search for a place or click on the map.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Travel mode</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTravelMode("driving")}
                    disabled={tracking}
                    className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm transition disabled:opacity-50 ${
                      travelMode === "driving"
                        ? "border-primary bg-primary/5 font-medium"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    <Car className="h-4 w-4" /> Driving
                  </button>
                  <button
                    type="button"
                    onClick={() => setTravelMode("walking")}
                    disabled={tracking}
                    className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm transition disabled:opacity-50 ${
                      travelMode === "walking"
                        ? "border-primary bg-primary/5 font-medium"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    <PersonStanding className="h-4 w-4" /> Walking
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {travelMode === "walking"
                    ? "Uses footpaths — ignores one-ways and car-only streets. Tighter deviation threshold."
                    : "Uses driveable roads — respects one-ways and turn restrictions."}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="src">From</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="src" className="pl-9"
                    placeholder="Source address"
                    value={sourceQuery}
                    onChange={(e) => { setSourceQuery(e.target.value); setSource(null); }}
                    disabled={tracking}
                  />
                </div>
                {sourceResults.length > 0 && (
                  <ResultList items={sourceResults} onPick={(r) => pickResult("src", r)} />
                )}
                <Button variant="ghost" size="sm" onClick={useMyLocationAsSource} disabled={tracking} className="text-xs">
                  <Crosshair className="mr-1 h-3 w-3" /> Use my current location
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="dst">To</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="dst" className="pl-9"
                    placeholder="Destination address"
                    value={destQuery}
                    onChange={(e) => { setDestQuery(e.target.value); setDestination(null); }}
                    disabled={tracking}
                  />
                </div>
                {destResults.length > 0 && (
                  <ResultList items={destResults} onPick={(r) => pickResult("dst", r)} />
                )}
              </div>

              {searching && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Searching…
                </div>
              )}

              {routeBusy && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Computing route…
                </div>
              )}

              {stats && (
                <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Distance</div>
                    <div className="font-semibold">{stats.distance}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Est. time</div>
                    <div className="font-semibold">{stats.duration}</div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {source && destination && !tracking && (
            <Card className="shadow-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Choose your route</CardTitle>
                <CardDescription>
                  {drawMode
                    ? "Draw your own path by clicking waypoints on the map."
                    : "Pick a suggested route or draw your own."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!drawMode && alternatives.length > 0 && (
                  <div className="space-y-2">
                    {alternatives.map((alt, idx) => {
                      const selected = idx === selectedAltIdx;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => selectAlternative(idx)}
                          className={`flex w-full items-center justify-between rounded-lg border p-3 text-left text-sm transition ${
                            selected
                              ? "border-primary bg-primary/5"
                              : "border-border hover:bg-accent"
                          }`}
                        >
                          <div>
                            <div className="font-medium">
                              {idx === 0 ? "Recommended" : `Alternative ${idx}`}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatDistance(alt.distanceMeters)} · {formatDuration(alt.durationSeconds)}
                            </div>
                          </div>
                          {selected && <Badge className="bg-success/15 text-success">Selected</Badge>}
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <div>
                    <Label htmlFor="draw">Draw my own route</Label>
                    <p className="text-xs text-muted-foreground">Click the map to add waypoints</p>
                  </div>
                  <Switch id="draw" checked={drawMode} onCheckedChange={toggleDrawMode} />
                </div>

                {drawMode && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                      <div>
                        <Label htmlFor="snap">Snap to roads</Label>
                        <p className="text-xs text-muted-foreground">Off = straight lines between points</p>
                      </div>
                      <Switch id="snap" checked={snapToRoads} onCheckedChange={setSnapToRoads} />
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{waypoints.length} waypoint{waypoints.length === 1 ? "" : "s"}</span>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={undoWaypoint} disabled={!waypoints.length}>Undo</Button>
                        <Button size="sm" variant="ghost" onClick={clearWaypoints} disabled={!waypoints.length}>Clear</Button>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Tracking</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="real">Use real GPS</Label>
                  <p className="text-xs text-muted-foreground">Off = simulate movement along route</p>
                </div>
                <Switch id="real" checked={useReal} onCheckedChange={setUseReal} disabled={tracking} />
              </div>

              {restoringTrip ? (
                <Button className="w-full" size="lg" disabled>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Restoring active trip…
                </Button>
              ) : !tracking ? (
                <Button className="w-full shadow-elegant" size="lg" disabled={!route} onClick={startTrip}>
                  <Play className="mr-2 h-4 w-4" /> Start trip
                </Button>
              ) : (
                <div className="space-y-2">
                  <Button className="w-full" size="lg" variant="destructive" onClick={() => triggerAlert("sos")}>
                    <Siren className="mr-2 h-4 w-4" /> Trigger SOS
                  </Button>
                  <Button className="w-full" variant="outline" onClick={() => endTrip("cancelled")}>
                    <Square className="mr-2 h-4 w-4" /> End trip
                  </Button>
                </div>
              )}

              {tracking && (
                <div className="rounded-lg border border-border bg-card p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status</span>
                    {deviating ? (
                      <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> Off route</Badge>
                    ) : (
                      <Badge className="bg-success/15 text-success">On route</Badge>
                    )}
                  </div>
                  {current && (
                    <div className="mt-2 flex items-center gap-1.5 text-muted-foreground">
                      <Navigation2 className="h-3 w-3" />
                      {current.lat.toFixed(5)}, {current.lng.toFixed(5)}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Map */}
        <Card className="overflow-hidden shadow-card">
          <MapView
            className="h-[70vh] w-full"
            source={source ? { lat: source.lat, lng: source.lng } : null}
            destination={destination ? { lat: destination.lat, lng: destination.lng } : null}
            route={route?.coordinates}
            alternativeRoutes={
              !tracking && !drawMode && alternatives.length > 1
                ? alternatives
                    .map((a, i) => (i === selectedAltIdx ? null : a.coordinates))
                    .filter((c): c is LatLng[] => Boolean(c))
                : undefined
            }
            waypoints={drawMode ? waypoints : undefined}
            current={current}
            deviating={deviating}
            onAlternativeClick={(visibleIdx) => {
              // Map "visible (non-selected) index" back to real alternatives index
              const others = alternatives
                .map((_, i) => i)
                .filter((i) => i !== selectedAltIdx);
              const realIdx = others[visibleIdx];
              if (typeof realIdx === "number") selectAlternative(realIdx);
            }}
            onMapClick={(p) => {
              if (tracking) return;
              if (drawMode && source && destination) {
                setWaypoints((w) => [...w, p]);
                return;
              }
              if (!source) { pickResult("src", { label: `(${p.lat.toFixed(4)}, ${p.lng.toFixed(4)})`, ...p }); }
              else if (!destination) { pickResult("dst", { label: `(${p.lat.toFixed(4)}, ${p.lng.toFixed(4)})`, ...p }); }
            }}
          />
          {!source && !destination ? (
            <div className="border-t border-border bg-muted/20 px-4 py-2 text-xs text-muted-foreground flex items-center gap-2">
              <MapPin className="h-3 w-3" /> Tip: tap the map to set source, then destination.
            </div>
          ) : drawMode ? (
            <div className="border-t border-border bg-muted/20 px-4 py-2 text-xs text-muted-foreground flex items-center gap-2">
              <MapPin className="h-3 w-3" /> Click the map to add waypoints — your route will pass through them in order.
            </div>
          ) : alternatives.length > 1 ? (
            <div className="border-t border-border bg-muted/20 px-4 py-2 text-xs text-muted-foreground flex items-center gap-2">
              <MapPin className="h-3 w-3" /> Dashed grey lines are alternative routes — click one to select it.
            </div>
          ) : null}
        </Card>
      </div>

      {/* Alert dialog */}
      <Dialog open={alertOpen} onOpenChange={(o) => { if (!o) imSafe(); }}>
        <DialogContent>
          <DialogHeader>
            <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-7 w-7 text-destructive" />
            </div>
            <DialogTitle className="text-center">
              {alertReason === "deviation" && "Route deviation detected"}
              {alertReason === "inactivity" && "You've been inactive"}
              {alertReason === "sos" && "SOS triggered"}
            </DialogTitle>
            <DialogDescription className="text-center">
              {alertReason === "sos"
                ? "Your trusted contacts will be notified with your live location."
                : "Tap \"I'm safe\" to dismiss. Otherwise, your trusted contacts will be notified."}
            </DialogDescription>
          </DialogHeader>
          <div className="text-center text-3xl font-bold tabular-nums text-destructive">
            {countdown}s
          </div>
          <DialogFooter className="sm:justify-center">
            <Button variant="outline" onClick={imSafe}>I'm safe</Button>
            <Button variant="destructive" onClick={() => { if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current); escalate(alertReason); }}>
              Notify contacts now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ResultList({ items, onPick }: { items: GeocodeResult[]; onPick: (r: GeocodeResult) => void }) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-popover text-sm shadow-card">
      {items.map((r, i) => (
        <button
          key={`${r.lat}-${r.lng}-${i}`}
          type="button"
          onClick={() => onPick(r)}
          className="block w-full truncate px-3 py-2 text-left hover:bg-accent"
          title={r.label}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
