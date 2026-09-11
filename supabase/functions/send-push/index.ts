import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

// Déclenchée par le trigger Postgres `app_notifications_send_push` (voir
// supabase/migrations/20260911190000_add_push_notifications.sql) à chaque
// nouvelle notification in-app. Protégée par un secret partagé plutôt que
// par un JWT utilisateur puisqu'elle est appelée depuis la base, pas depuis
// le navigateur — même schéma que receive-marketing-order.

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Méthode non autorisée" }, 405);
  }

  const expectedSecret = Deno.env.get("PUSH_TRIGGER_SECRET");
  const providedSecret = req.headers.get("x-webhook-secret");
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return jsonResponse({ error: "Non autorisé" }, 401);
  }

  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.error("send-push: VAPID secrets not configured");
    return jsonResponse({ error: "Configuration push incomplète" }, 500);
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  try {
    const { user_id, notification_id, title, body, link_page, priority } = await req.json();
    if (!user_id || !title) {
      return jsonResponse({ error: "user_id et title sont obligatoires." }, 400);
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: subscriptions, error: fetchError } = await serviceClient
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", user_id);

    if (fetchError) {
      console.error("send-push: fetch subscriptions error", fetchError.message);
      return jsonResponse({ error: "Impossible de lire les abonnements." }, 500);
    }
    if (!subscriptions || subscriptions.length === 0) {
      return jsonResponse({ success: true, sent: 0 }, 200);
    }

    const payload = JSON.stringify({ title, body, link_page, priority, notification_id });

    let sent = 0;
    const staleIds: string[] = [];
    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          );
          sent++;
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            // Abonnement expiré/révoqué côté navigateur : on le nettoie.
            staleIds.push(sub.id);
          } else {
            console.error("send-push: send error", err instanceof Error ? err.message : err);
          }
        }
      }),
    );

    if (staleIds.length > 0) {
      await serviceClient.from("push_subscriptions").delete().in("id", staleIds);
    }

    return jsonResponse({ success: true, sent, cleaned: staleIds.length }, 200);
  } catch (err) {
    console.error("send-push unexpected error:", err);
    return jsonResponse({ error: "Erreur serveur" }, 500);
  }
});
