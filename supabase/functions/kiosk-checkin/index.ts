import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type CheckType = "arrival" | "departure";
type PersonType = "profile" | "driver" | "baker" | "kneader";

const allowedOrigins = new Set([
  "https://mimsi-distribution-ennx.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin)
      ? origin
      : "https://mimsi-distribution-ennx.vercel.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const json = (req: Request, body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders(req), "Content-Type": "application/json" },
});

function dateAndTimeInBusinessTimezone(recordedAt: Date): { date: string; time: string } {
  const timezone = Deno.env.get("APP_TIME_ZONE") ?? "Africa/Abidjan";
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(recordedAt);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .format(recordedAt),
  };
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
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Méthode non autorisée" }, 405);

  try {
    const body = await req.json();
    const action = body.action as CheckType;
    const personId = body.personId;
    const personType = body.personType as PersonType;
    const photo = decodePhoto(body.photo);
    const recordedAt = typeof body.recordedAt === "string" ? new Date(body.recordedAt) : new Date();
    if (!(["arrival", "departure"] as string[]).includes(action) || typeof personId !== "string" ||
      !(["profile", "driver", "baker", "kneader"] as string[]).includes(personType) || !photo || Number.isNaN(recordedAt.getTime())) {
      return json(req, { error: "Données de pointage invalides." }, 400);
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
    if (!person) return json(req, { error: "Personne inactive ou introuvable." }, 404);

    const { date, time } = dateAndTimeInBusinessTimezone(recordedAt);
    const filePath = `attendance/${date}/${personType}/${personId}/${action}-${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await admin.storage.from("attendance-photos")
      .upload(filePath, photo, { contentType: "image/jpeg", upsert: false });
    if (uploadError) return json(req, { error: "Impossible d’enregistrer la photo." }, 500);

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
      if (error?.code === "23505") return json(req, { error: "Votre arrivée est déjà enregistrée aujourd’hui." }, 409);
      if (error) return json(req, { error: "Impossible d’enregistrer l’arrivée." }, 500);
    } else {
      const { data: openRecord } = await admin.from("attendance_records")
        .select("id")
        .eq("person_id", person.id)
        .eq("person_type", person.person_type)
        .eq("attendance_date", date)
        .is("departure_time", null)
        .maybeSingle();
      if (!openRecord) return json(req, { error: "Aucune arrivée ouverte n’a été trouvée aujourd’hui." }, 409);
      const { error } = await admin.from("attendance_records")
        .update({ departure_time: time, departure_photo_url: filePath })
        .eq("id", openRecord.id)
        .is("departure_time", null);
      if (error) return json(req, { error: "Impossible d’enregistrer le départ." }, 500);
    }
    return json(req, { success: true });
  } catch {
    return json(req, { error: "Erreur serveur." }, 500);
  }
});
