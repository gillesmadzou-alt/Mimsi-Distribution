// Suivi d'erreurs (Sentry). N'envoie strictement rien si VITE_SENTRY_DSN
// n'est pas défini — l'app fonctionne exactement comme avant tant que ce
// DSN n'a pas été configuré (aucune dépendance dure sur ce service).
import * as Sentry from '@sentry/react';

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Échantillonnage modéré : suffisant pour repérer les régressions de
    // perf sans consommer tout le quota gratuit sur une petite app métier.
    tracesSampleRate: 0.1,
    integrations: [Sentry.browserTracingIntegration()],
    beforeSend(event) {
      // Ne jamais laisser fuiter un mot de passe/jeton qui traînerait par
      // erreur dans un message d'exception (ex: réponse HTTP échouée).
      if (event.message) {
        event.message = event.message.replace(/(password|token|secret|apikey)=[^&\s]+/gi, '$1=[redacted]');
      }
      return event;
    },
  });
}

/**
 * Identifie l'utilisateur courant dans Sentry — uniquement son id et son
 * rôle, jamais son nom complet ni son téléphone (données personnelles du
 * personnel, hors de propos pour du diagnostic d'erreur technique).
 */
export function setSentryUser(id: string | null, role?: number): void {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  if (!id) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id, role: role !== undefined ? String(role) : undefined });
}

export const SentryErrorBoundary = Sentry.ErrorBoundary;
