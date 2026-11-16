import { describe, expect, it } from 'vitest';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  decodeCreationOptions,
  decodeRequestOptions,
  passkeyErrorMessage,
  secondFactorModes,
} from './passkey';

describe('base64url', () => {
  it('round-trips every byte value without padding or URL-unsafe characters', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const text = bytesToBase64Url(bytes);
    expect(text, 'alphabet').toMatch(/^[A-Za-z0-9_-]+$/);
    expect([...base64UrlToBytes(text)], 'round trip').toEqual([...bytes]);
  });

  it('decodes each padding length the server can send', () => {
    expect([...base64UrlToBytes('_w')], 'one byte').toEqual([255]);
    expect([...base64UrlToBytes('__8')], 'two bytes').toEqual([255, 255]);
    expect([...base64UrlToBytes('-_-_')], 'three bytes').toEqual([251, 255, 191]);
    expect(base64UrlToBytes('').length, 'empty').toBe(0);
  });
});

describe('decoding server options', () => {
  it('turns the registration challenge, user id and excluded ids into bytes', () => {
    const { publicKey } = decodeCreationOptions({
      publicKey: {
        rp: { id: 'localhost', name: 'GLcert' },
        challenge: 'AQID',
        user: { id: 'dXNlcg', name: 'a@example.com', displayName: 'A' },
        excludeCredentials: [{ id: 'BAUG', type: 'public-key' }],
      },
    });
    expect([...(publicKey!.challenge as Uint8Array)], 'challenge').toEqual([1, 2, 3]);
    expect(new TextDecoder().decode(publicKey!.user.id as Uint8Array), 'user id').toBe('user');
    expect([...(publicKey!.excludeCredentials![0].id as Uint8Array)], 'excluded').toEqual([
      4, 5, 6,
    ]);
    expect(publicKey!.rp.id, 'other fields pass through').toBe('localhost');
  });

  it('turns the sign-in challenge and allowed ids into bytes', () => {
    const { publicKey } = decodeRequestOptions({
      publicKey: {
        challenge: 'AQID',
        rpId: 'localhost',
        allowCredentials: [{ id: 'BAUG', type: 'public-key' }],
      },
    });
    expect([...(publicKey!.challenge as Uint8Array)], 'challenge').toEqual([1, 2, 3]);
    expect([...(publicKey!.allowCredentials![0].id as Uint8Array)], 'allowed').toEqual([4, 5, 6]);
    expect(publicKey!.rpId, 'rp id').toBe('localhost');
  });

  it('accepts options without a credential list', () => {
    const { publicKey } = decodeRequestOptions({ publicKey: { challenge: 'AQID' } });
    expect(publicKey!.allowCredentials, 'no list').toBeUndefined();
  });
});

describe('secondFactorModes', () => {
  it('offers the passkey first, then the app, and always a backup code', () => {
    expect(secondFactorModes(['passkey', 'totp'], true), 'both').toEqual([
      'passkey',
      'totp',
      'backup',
    ]);
    expect(secondFactorModes(['totp'], true), 'app only').toEqual(['totp', 'backup']);
    expect(secondFactorModes(['passkey'], true), 'passkey only').toEqual(['passkey', 'backup']);
  });

  it('leaves the passkey out where the browser cannot use one', () => {
    expect(secondFactorModes(['passkey', 'totp'], false), 'falls back to the app').toEqual([
      'totp',
      'backup',
    ]);
    expect(secondFactorModes(['passkey'], false), 'only a backup code is left').toEqual(['backup']);
  });
});

describe('passkeyErrorMessage', () => {
  it('explains a closed or timed-out prompt', () => {
    const cancelled = new DOMException('', 'NotAllowedError');
    expect(passkeyErrorMessage(cancelled, 'use'), 'sign-in').toMatch(/closed or timed out/);
    expect(passkeyErrorMessage(cancelled, 'create'), 'registration').toMatch(
      /No passkey was created/,
    );
  });

  it('explains a device that is already registered, and a wrong address', () => {
    expect(passkeyErrorMessage(new DOMException('', 'InvalidStateError'), 'create')).toMatch(
      /already holds a passkey/,
    );
    expect(passkeyErrorMessage(new DOMException('', 'SecurityError'), 'use')).toMatch(
      /do not work at this address/,
    );
  });

  it('falls back to a plain failure for anything else', () => {
    expect(passkeyErrorMessage(new Error('boom'), 'use')).toBe('Could not use the passkey.');
  });
});
