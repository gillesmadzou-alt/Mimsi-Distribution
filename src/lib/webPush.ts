// Web Push : permet de recevoir une notification système même quand
// l'application est fermée (contrairement aux notifications in-app de
// NotificationBell, qui n'existent que quand l'onglet est ouvert).
//
// Fonctionnement : le navigateur crée un abonnement push unique (endpoint +
// clés de chiffrement) via la clé publique VAPID ; on l'enregistre dans
// `push_subscriptions`. Un trigger Postgres appelle ensuite la fonction Edge
// `send-push` à chaque nouvelle notification, qui envoie le message chiffré
// au navigateur via ce endpoint — voir docs/web-push-setup.md pour la mise
// en place complète (clés VAPID, secrets Supabase).

import { supabase } from './supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from(rawData, (c) => c.charCodeAt(0));
}

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && !!VAPID_PUBLIC_KEY;
}

export async function getPushSubscriptionState(): Promise<'subscribed' | 'unsubscribed' | 'unsupported'> {
  if (!isPushSupported()) return 'unsupported';
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  return existing ? 'subscribed' : 'unsubscribed';
}

export async function subscribeToPush(userId: string): Promise<{ error?: string }> {
  if (!isPushSupported()) return { error: 'Les notifications push ne sont pas supportées sur cet appareil.' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { error: 'Autorisation refusée pour les notifications.' };
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!) as unknown as BufferSource,
    });
  }

  const key = subscription.getKey('p256dh');
  const auth = subscription.getKey('auth');
  if (!key || !auth) return { error: 'Impossible de lire les clés de l’abonnement.' };

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: btoa(String.fromCharCode(...new Uint8Array(key))),
      auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
    },
    { onConflict: 'endpoint' },
  );

  if (error) return { error: 'Impossible d’enregistrer l’abonnement push.' };
  return {};
}

export async function unsubscribeFromPush(): Promise<{ error?: string }> {
  if (!isPushSupported()) return {};
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return {};

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) return { error: 'Abonnement local supprimé, mais échec de la suppression côté serveur.' };
  return {};
}
