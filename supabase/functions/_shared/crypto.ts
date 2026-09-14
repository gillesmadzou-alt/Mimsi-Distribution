// Chiffrement des jetons d'acces des comptes sociaux.
//
// Les jetons Facebook/Instagram/WhatsApp d'un client donnent un controle total
// sur sa page et sa messagerie. Ils ne doivent jamais se retrouver en clair
// dans la base : une sauvegarde egaree suffirait a compromettre tous les
// comptes de tous les clients d'un coup.
//
// On chiffre donc cote Edge Function, en AES-256-GCM (chiffrement authentifie :
// toute alteration du chiffre est detectee au dechiffrement). La base ne
// stocke que le resultat.
//
// Configuration :
//   supabase secrets set TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)"
//
// Format stocke : base64( nonce (12 octets) || chiffre || tag (16 octets) ).
// Le nonce est tire au hasard a chaque chiffrement -- jamais reutilise, c'est
// la condition de securite de GCM.

const NONCE_BYTES = 12;

let cachedKey: CryptoKey | null = null;

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export class EncryptionKeyMissingError extends Error {
  constructor() {
    super(
      "TOKEN_ENCRYPTION_KEY n'est pas configuree. " +
        "Generer une cle avec : openssl rand -base64 32, " +
        "puis : supabase secrets set TOKEN_ENCRYPTION_KEY=<cle>",
    );
    this.name = "EncryptionKeyMissingError";
  }
}

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  const raw = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (!raw) throw new EncryptionKeyMissingError();

  const keyBytes = decodeBase64(raw.trim());
  if (keyBytes.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY doit faire 32 octets une fois decodee (obtenu : ${keyBytes.length}). Utiliser : openssl rand -base64 32`,
    );
  }

  cachedKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  return cachedKey;
}

export async function encryptToken(plaintext: string): Promise<string> {
  const key = await getKey();
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, new TextEncoder().encode(plaintext)),
  );

  const packed = new Uint8Array(nonce.length + ciphertext.length);
  packed.set(nonce, 0);
  packed.set(ciphertext, nonce.length);
  return encodeBase64(packed);
}

export async function decryptToken(stored: string): Promise<string> {
  const key = await getKey();
  const packed = decodeBase64(stored);
  if (packed.length <= NONCE_BYTES) {
    throw new Error("Jeton chiffre invalide : trop court pour contenir un nonce.");
  }

  const nonce = packed.slice(0, NONCE_BYTES);
  const ciphertext = packed.slice(NONCE_BYTES);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
