import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type SosInput = {
  tripId: string;
  lat?: number | null;
  lng?: number | null;
  reason: "deviation" | "inactivity" | "sos";
};

type SmsResult = {
  to: string;
  name: string;
  ok: boolean;
  error?: string;
  sid?: string;
};

export const sendSosSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SosInput): SosInput => {
    if (!input || typeof input.tripId !== "string" || input.tripId.length === 0) {
      throw new Error("tripId is required");
    }
    if (!["deviation", "inactivity", "sos"].includes(input.reason)) {
      throw new Error("Invalid reason");
    }
    return {
      tripId: input.tripId,
      lat: typeof input.lat === "number" ? input.lat : null,
      lng: typeof input.lng === "number" ? input.lng : null,
      reason: input.reason,
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
    const TWILIO_API_KEY_SID = process.env.TWILIO_API_KEY_SID;
    const TWILIO_API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET;
    const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

    console.log("Twilio configured:", {
      hasSID: !!TWILIO_ACCOUNT_SID,
      hasKeySID: !!TWILIO_API_KEY_SID,
      hasSecret: !!TWILIO_API_KEY_SECRET,
      hasPhone: !!TWILIO_PHONE_NUMBER,
    });

    if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY_SID || !TWILIO_API_KEY_SECRET || !TWILIO_PHONE_NUMBER) {
      return {
        ok: false,
        error: "Twilio is not fully configured on the server.",
        results: [] as SmsResult[],
        contactsCount: 0,
      };
    }

    const { data: contacts, error: contactsErr } = await supabase
      .from("emergency_contacts")
      .select("name, phone")
      .eq("user_id", userId)
      .order("is_primary", { ascending: false });

    if (contactsErr) {
      return { ok: false, error: contactsErr.message, results: [], contactsCount: 0 };
    }

    if (!contacts || contacts.length === 0) {
      return {
        ok: false,
        error: "No emergency contacts configured.",
        results: [],
        contactsCount: 0,
      };
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", userId)
      .maybeSingle();

    const personName = profile?.display_name?.trim() || "A SafeRoute user";

    const reasonText =
      data.reason === "sos"
        ? "manually triggered an SOS"
        : data.reason === "deviation"
          ? "deviated from their planned route"
          : "has been inactive on their trip";

    const locText =
      data.lat != null && data.lng != null
        ? `Last known location: https://maps.google.com/?q=${data.lat},${data.lng}`
        : "Location unavailable.";

    const body = `🚨 SafeRoute Alert: ${personName} ${reasonText}. ${locText}`;

    const auth = btoa(`${TWILIO_API_KEY_SID}:${TWILIO_API_KEY_SECRET}`);
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

    const results: SmsResult[] = await Promise.all(
      contacts.map(async (c) => {
        try {
          const form = new URLSearchParams({
            To: c.phone,
            From: TWILIO_PHONE_NUMBER,
            Body: body,
          });
          const res = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Basic ${auth}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: form.toString(),
          });
          const json = (await res.json()) as { sid?: string; message?: string };
          if (!res.ok) {
            console.error("Twilio error", res.status, json);
            return { to: c.phone, name: c.name, ok: false, error: json?.message || `HTTP ${res.status}` };
          }
          return { to: c.phone, name: c.name, ok: true, sid: json.sid };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Unknown error";
          console.error("Twilio request failed", msg);
          return { to: c.phone, name: c.name, ok: false, error: msg };
        }
      }),
    );

    const successCount = results.filter((r) => r.ok).length;

    await supabase.from("trip_alerts").insert([{
      trip_id: data.tripId,
      user_id: userId,
      kind: data.reason,
      lat: data.lat,
      lng: data.lng,
      notified_contacts: successCount > 0,
      notes: `SMS sent to ${successCount}/${contacts.length} contact(s) via Twilio.`,
    }]);

    await supabase
      .from("trips")
      .update({ status: "emergency" })
      .eq("id", data.tripId);

    return {
      ok: successCount > 0,
      contactsCount: contacts.length,
      successCount,
      results,
    };
  });