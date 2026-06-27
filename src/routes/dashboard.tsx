import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { MapPin, Users, Activity, Plus } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Trip = Database["public"]["Tables"]["trips"]["Row"];

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [{ title: "Dashboard — SafeRoute" }],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [contactCount, setContactCount] = useState(0);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: t }, { count }] = await Promise.all([
        supabase.from("trips").select("*").order("created_at", { ascending: false }).limit(10),
        supabase.from("emergency_contacts").select("*", { count: "exact", head: true }),
      ]);
      setTrips(t ?? []);
      setContactCount(count ?? 0);
    })();
  }, [user]);

  if (loading || !user) return null;

  const activeTrip = trips.find((t) => t.status === "active");

  return (
    <div className="container mx-auto px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-muted-foreground">Plan, track, and stay safe on every journey.</p>
        </div>
        <Button asChild size="lg" className="shadow-elegant">
          <Link to="/track">
            <Plus className="mr-2 h-4 w-4" /> Start a new trip
          </Link>
        </Button>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <StatCard icon={Activity} label="Total trips" value={trips.length} />
        <StatCard icon={Users} label="Trusted contacts" value={contactCount} action={<Link to="/contacts" className="text-sm text-primary hover:underline">Manage</Link>} />
        <StatCard
          icon={MapPin}
          label="Active trip"
          value={activeTrip ? "In progress" : "None"}
          tone={activeTrip ? "active" : "default"}
        />
      </div>

      {contactCount === 0 && (
        <Card className="mt-6 border-warning/50 bg-warning/5">
          <CardHeader>
            <CardTitle className="text-base">Add your first emergency contact</CardTitle>
            <CardDescription>
              Without trusted contacts, alerts can't be escalated. Add at least one person to be notified during emergencies.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/contacts">Add a contact</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="mt-10">
        <h2 className="text-xl font-semibold">Recent trips</h2>
        {trips.length === 0 ? (
          <Card className="mt-4">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground">
              <MapPin className="h-10 w-10 opacity-40" />
              <p>No trips yet. Start your first protected journey.</p>
              <Button asChild>
                <Link to="/track">Plan a trip</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          (() => {
            const pastTrips = trips.filter((t) => t.status !== "active" && t.status !== "emergency");
            if (pastTrips.length === 0) {
              return (
                <Card className="mt-4">
                  <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground">
                    <MapPin className="h-10 w-10 opacity-40" />
                    <p>No past trips yet.</p>
                  </CardContent>
                </Card>
              );
            }
            return (
              <div className="mt-4 grid gap-3">
                {pastTrips.map((t) => (
                  <TripRow key={t.id} trip={t} />
                ))}
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon, label, value, tone = "default", action,
}: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; tone?: "default" | "active"; action?: React.ReactNode }) {
  return (
    <Card className="shadow-card">
      <CardContent className="flex items-center justify-between p-6">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className={`mt-1 text-2xl font-semibold ${tone === "active" ? "text-success" : ""}`}>{value}</div>
          {action && <div className="mt-2">{action}</div>}
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-hero shadow-elegant">
          <Icon className="h-6 w-6 text-primary-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

function shortLabel(label: string) {
  if (!label) return "";

  if (label.toLowerCase().startsWith("my location")) {
    return "📍 My Location";
  }

  return label.split(",")[0].trim();
}

function TripRow({ trip }: { trip: Trip }) {
  const navigate = useNavigate();

  return (
    <Card
      className="cursor-pointer transition-all shadow-card hover:shadow-lg hover:border-primary/40 hover:-translate-y-0.5"
      onClick={() =>
        navigate({
          to: "/track",
          search: {
            reuseTrip: trip.id,
          },
        })
      }
    >
      <CardContent className="flex items-center justify-between gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            <span className="truncate inline-block max-w-[40%] align-middle">
              {shortLabel(trip.source_label)}
            </span>

            <span className="mx-2 text-muted-foreground">→</span>

            <span className="truncate inline-block max-w-[40%] align-middle">
              {shortLabel(trip.destination_label)}
            </span>
          </div>

          <div className="mt-1 text-xs text-muted-foreground">
            {new Date(trip.created_at).toLocaleString()}
          </div>
        </div>

        <Button variant="ghost" size="sm">
          Reuse
        </Button>
      </CardContent>
    </Card>
  );
}
