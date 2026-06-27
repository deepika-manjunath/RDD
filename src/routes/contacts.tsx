import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Trash2, Phone, Mail, UserPlus } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Contact = Database["public"]["Tables"]["emergency_contacts"]["Row"];

export const Route = createFileRoute("/contacts")({
  head: () => ({
    meta: [{ title: "Emergency contacts — SafeRoute" }],
  }),
  component: Contacts,
});

function Contacts() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [relationship, setRelationship] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  async function load() {
    const { data, error } = await supabase
      .from("emergency_contacts")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setContacts(data ?? []);
  }

  useEffect(() => {
    if (user) load();
  }, [user]);

  async function addContact(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    const normalizedPhone = phone.replace(/[^\d+]/g, "");

    const { error } = await supabase.from("emergency_contacts").insert([{
      user_id: user.id,
      name,
      phone: normalizedPhone,
      email: email || null,
      relationship: relationship || null,
    }]);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setName(""); setPhone(""); setEmail(""); setRelationship("");
    toast.success("Contact added");
    load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("emergency_contacts").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Removed"); load(); }
  }

  if (loading || !user) return null;

  return (
    <div className="container mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Emergency contacts</h1>
      <p className="mt-1 text-muted-foreground">
        These trusted people will be notified with your live location during emergencies.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" /> Add a contact
            </CardTitle>
            <CardDescription>You can add as many trusted contacts as you'd like.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={addContact}>
              <div className="space-y-2">
                <Label htmlFor="c-name">Full name</Label>
                <Input id="c-name" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-phone">Phone number</Label>
                <Input id="c-phone" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 123 4567" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-email">Email (optional)</Label>
                <Input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-rel">Relationship (optional)</Label>
                <Input id="c-rel" value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="Mother, Friend, Roommate…" />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Adding…" : "Add contact"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div>
          <h2 className="text-lg font-semibold">Your contacts ({contacts.length})</h2>
          {contacts.length === 0 ? (
            <Card className="mt-4">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No contacts yet. Add at least one to enable emergency escalation.
              </CardContent>
            </Card>
          ) : (
            <div className="mt-4 grid gap-3">
              {contacts.map((c) => (
                <Card key={c.id} className="shadow-card">
                  <CardContent className="flex items-start justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="font-medium">{c.name}</div>
                      {c.relationship && (
                        <div className="text-xs text-muted-foreground">{c.relationship}</div>
                      )}
                      <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <Phone className="h-3 w-3" /> {c.phone}
                        </span>
                        {c.email && (
                          <span className="inline-flex items-center gap-1.5">
                            <Mail className="h-3 w-3" /> {c.email}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => remove(c.id)} title="Delete">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
