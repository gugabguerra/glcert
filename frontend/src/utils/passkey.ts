// Browser side of passkeys (WebAuthn). The server speaks the JSON form of the options and
// responses, with binary fields as unpadded base64url; the browser API wants ArrayBuffers. The
// conversion is done by hand so it also works where PublicKeyCredential.toJSON() is missing.

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64Url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface DescriptorJSON {
  id: string;
  type: string;
  transports?: string[];
}

/** What the server sends to start registering a passkey. */
export interface CreationOptionsJSON {
  publicKey: Record<string, unknown> & {
    challenge: string;
    user: { id: string; name: string; displayName: string };
    excludeCredentials?: DescriptorJSON[];
  };
}

/** What the server sends to start a passkey sign-in. */
export interface RequestOptionsJSON {
  publicKey: Record<string, unknown> & {
    challenge: string;
    allowCredentials?: DescriptorJSON[];
  };
}

const descriptors = (list: DescriptorJSON[] | undefined) =>
  list?.map((d) => ({ ...d, id: base64UrlToBytes(d.id) }));

export function decodeCreationOptions(json: CreationOptionsJSON): CredentialCreationOptions {
  const { publicKey } = json;
  return {
    publicKey: {
      ...publicKey,
      challenge: base64UrlToBytes(publicKey.challenge),
      user: { ...publicKey.user, id: base64UrlToBytes(publicKey.user.id) },
      excludeCredentials: descriptors(publicKey.excludeCredentials),
    } as unknown as PublicKeyCredentialCreationOptions,
  };
}

export function decodeRequestOptions(json: RequestOptionsJSON): CredentialRequestOptions {
  const { publicKey } = json;
  return {
    publicKey: {
      ...publicKey,
      challenge: base64UrlToBytes(publicKey.challenge),
      allowCredentials: descriptors(publicKey.allowCredentials),
    } as unknown as PublicKeyCredentialRequestOptions,
  };
}

const optional = (buffer: ArrayBuffer | null | undefined) =>
  buffer ? bytesToBase64Url(buffer) : undefined;

function encodeCredential(credential: PublicKeyCredential, response: Record<string, unknown>) {
  return {
    id: credential.id,
    rawId: bytesToBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    response,
    // No extensions are requested, and the server ignores any a browser adds.
    clientExtensionResults: {},
  };
}

/** True when this browser can use passkeys at all. Some desktop web views cannot. */
export function passkeysSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof window.PublicKeyCredential === 'function' &&
    !!navigator.credentials
  );
}

/** Asks the browser to create a passkey and returns the answer for the server. */
export async function createPasskey(options: CreationOptionsJSON) {
  const credential = (await navigator.credentials.create(
    decodeCreationOptions(options),
  )) as PublicKeyCredential | null;
  if (!credential) throw new DOMException('No passkey was created.', 'NotAllowedError');
  const response = credential.response as AuthenticatorAttestationResponse;
  return encodeCredential(credential, {
    clientDataJSON: bytesToBase64Url(response.clientDataJSON),
    attestationObject: bytesToBase64Url(response.attestationObject),
    transports: response.getTransports?.() ?? [],
  });
}

/** Asks the browser to sign in with a passkey and returns the answer for the server. */
export async function getPasskey(options: RequestOptionsJSON) {
  const credential = (await navigator.credentials.get(
    decodeRequestOptions(options),
  )) as PublicKeyCredential | null;
  if (!credential) throw new DOMException('No passkey was used.', 'NotAllowedError');
  const response = credential.response as AuthenticatorAssertionResponse;
  return encodeCredential(credential, {
    clientDataJSON: bytesToBase64Url(response.clientDataJSON),
    authenticatorData: bytesToBase64Url(response.authenticatorData),
    signature: bytesToBase64Url(response.signature),
    userHandle: optional(response.userHandle),
  });
}

/**
 * Plain words for a failed browser passkey prompt. Browsers report a cancelled prompt and a
 * timeout the same way, on purpose, so one message covers both.
 */
export function passkeyErrorMessage(error: unknown, action: 'create' | 'use'): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'InvalidStateError' && action === 'create')
    return 'This device already holds a passkey for your account.';
  if (name === 'SecurityError')
    return 'Passkeys do not work at this address. Open GLcert at its public address.';
  if (name === 'NotAllowedError' || name === 'AbortError')
    return action === 'create'
      ? 'No passkey was created. The prompt was closed or timed out.'
      : 'No passkey was used. The prompt was closed or timed out.';
  return action === 'create' ? 'Could not create the passkey.' : 'Could not use the passkey.';
}

/** The second factors a sign-in can be finished with, in the order the sign-in page offers them. */
export type SecondFactor = 'passkey' | 'totp' | 'backup';

/**
 * Which second-factor screens to offer after the password. Backup codes always work; a passkey is
 * only offered where the browser can use one.
 */
export function secondFactorModes(methods: string[], canUsePasskey: boolean): SecondFactor[] {
  const modes: SecondFactor[] = [];
  if (methods.includes('passkey') && canUsePasskey) modes.push('passkey');
  if (methods.includes('totp')) modes.push('totp');
  modes.push('backup');
  return modes;
}
