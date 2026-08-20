import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type CheckType = "arrival" | "departure";
type PersonType = "profile" | "driver" | "baker" | "kneader";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

function todayInBusinessTimezone(): string {
  const timezone = Deno.env.get("APP_TIME_ZONE") ?? "Africa/Abidjan";
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function localTime(): string {
  const timezone = Deno.env.get("APP_TIME_ZONE") ?? "Africa/Abidjan";
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .format(new Date());
}

function decodePhoto(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !value.startsWith("data:image/")) return null;
  const base64 = value.split(",", 2)[1];
  if (!base64 || base64.length > 7_000_000) return null;
  try {
    const binary = atob(base64);
    if (binary.length === 0 || binary.length > 5 * 1024 * 1024) return null;
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const body = await req.json();
    const action = body.action as CheckType;
    const personId = body.personId;
    const personType = body.personType as PersonType;
    const photo = decodePhoto(body.photo);
    if (!(["arrival", "departure"] as string[]).includes(action) || typeof personId !== "string" ||
      !(["profile", "driver", "baker", "kneader"] as string[]).includes(personType) || !photo) {
      return json({ error: "Données de pointage invalides." }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: person } = await admin
      .from("kiosk_people")
      .select("id, full_name, role, person_type")
      .eq("id", personId)
      .eq("person_type", personType)
      .maybeSingle();
    if (!person) return json({ error: "Personne inactive ou introuvable." }, 404);

    const date = todayInBusinessTimezone();
    const time = localTime();
    const filePath = `attendance/${date}/${personType}/${personId}/${action}-${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await admin.storage.from("attendance-photos")
      .upload(filePath, photo, { contentType: "image/jpeg", upsert: false });
    if (uploadError) return json({ error: "Impossible d’enregistrer la photo." }, 500);

    if (action === "arrival") {
      const { error } = await admin.from("attendance_records").insert({
        person_id: person.id,
        person_name: person.full_name,
        person_role: person.role,
        person_type: person.person_type,
        attendance_date: date,
        arrival_time: time,
        departure_time: null,
        status: "present",
        notes: null,
        recorded_by: null,
        photo_url: filePath,
        departure_photo_url: null,
      });
      if (error?.code === "23505") return json({ error: "Votre arrivée est déjà enregistrée aujourd’hui." }, 409);
      if (error) return json({ error: "Impossible d’enregistrer l’arrivée." }, 500);
    } else {
      const { data: openRecord } = await admin.from("attendance_records")
        .select("id")
        .eq("person_id", person.id)
        .eq("person_type", person.person_type)
        .eq("attendance_date", date)
        .is("departure_time", null)
        .maybeSingle();
      if (!openRecord) return json({ error: "Aucune arrivée ouverte n’a été trouvée aujourd’hui." }, 409);
      const { error } = await admin.from("attendance_records")
        .update({ departure_time: time, departure_photo_url: filePath })
        .eq("id", openRecord.id)
        .is("departure_time", null);
      if (error) return json({ error: "Impossible d’enregistrer le départ." }, 500);
    }
    return json({ success: true });
  } catch {
    return json({ error: "Erreur serveur." }, 500);
  }
});
