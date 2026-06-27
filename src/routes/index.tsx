import { createFileRoute, Link } from "@tanstack/react-router";
import { Shield, MapPin, Bell, Users, Activity, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-soft" />
        <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-gradient-hero opacity-20 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-gradient-hero opacity-20 blur-3xl" />

        <div className="container relative mx-auto px-4 py-20 sm:py-28 lg:py-36">
          <div className="mx-auto max-w-3xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              Live tracking · Smart alerts · Trusted contacts
            </div>
            <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Travel with peace of mind on{" "}
              <span className="bg-gradient-hero bg-clip-text text-transparent">every route.</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground sm:text-xl">
              SafeRoute monitors your journey in real time, detects unusual deviations or stops,
              and instantly alerts your loved ones if something feels off.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <Button size="lg" asChild className="shadow-elegant">
                <Link to="/auth">Start tracking free</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/track">See live demo</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="container mx-auto px-4 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Built for solo travellers, late nights & unfamiliar routes
          </h2>
          <p className="mt-4 text-muted-foreground">
            Everything that ordinary navigation apps miss — proactive monitoring, automated alerts,
            and a safety net you can count on.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-border bg-card p-6 shadow-card transition hover:-translate-y-1 hover:shadow-elegant"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-hero shadow-elegant">
                <f.icon className="h-6 w-6 text-primary-foreground" />
              </div>
              <h3 className="mt-5 text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-gradient-soft py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">How it works</h2>
            <p className="mt-4 text-muted-foreground">Three simple steps to a safer journey.</p>
          </div>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {steps.map((s, i) => (
              <div key={s.title} className="relative">
                <div className="absolute -left-2 -top-2 flex h-10 w-10 items-center justify-center rounded-full bg-card font-bold text-primary shadow-card">
                  {i + 1}
                </div>
                <div className="rounded-2xl border border-border bg-card p-6 pl-10 shadow-card">
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="container mx-auto px-4 py-20">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-hero p-10 text-center shadow-elegant sm:p-16">
          <div className="absolute inset-0 opacity-30 [background:radial-gradient(circle_at_30%_20%,white_0%,transparent_40%)]" />
          <div className="relative">
            <h2 className="text-3xl font-bold tracking-tight text-primary-foreground sm:text-4xl">
              Your safety net, every trip.
            </h2>
            <p className="mt-4 text-primary-foreground/90">
              Add a few trusted contacts and start your first protected journey in under a minute.
            </p>
            <Button size="lg" variant="secondary" asChild className="mt-8 shadow-card">
              <Link to="/auth">Create free account</Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        <p>© {new Date().getFullYear()} SafeRoute · Built for safer journeys.</p>
      </footer>
    </div>
  );
}

const features = [
  { icon: MapPin, title: "Live route monitoring", desc: "Pick a source and destination, then we track your live location continuously against the planned path." },
  { icon: Activity, title: "Deviation detection", desc: "If you stray significantly off-route, SafeRoute notices instantly and prompts you to confirm." },
  { icon: Clock, title: "Inactivity alerts", desc: "Stopped for too long without warning? We check in — and escalate if you don't respond." },
  { icon: Bell, title: "Auto-escalation", desc: "Ignore the alert and SafeRoute automatically notifies your trusted contacts with your live location." },
  { icon: Users, title: "Trusted contacts", desc: "Add family or friends who get notified during emergencies — share with a tap." },
  { icon: Shield, title: "Private & secure", desc: "Your data stays yours. Contacts and trips are protected by row-level security." },
];

const steps = [
  { title: "Add your contacts", desc: "Save a few trusted people who should be notified in case of emergencies." },
  { title: "Plan your trip", desc: "Pick a source and destination on the map. We compute the safest route." },
  { title: "Travel protected", desc: "We monitor your journey live and escalate automatically if anything seems wrong." },
];
