import { scrypt, timingSafeEqual } from 'node:crypto';

const SALT = Buffer.from('k7/AZa0PYSfAUn53p9/QrQ==', 'base64');
const HASH = Buffer.from('cDGZ1bc9kUAb/Ph58Z68/sYC8L8ZaJe8alVVmPZddHE=', 'base64');
const OPTIONS = { N: 16384, r: 8, p: 1 } as const;

/** Compare a console password to the stored scrypt digest. Never log the input. */
export function verifyAdminConsolePassword(password: unknown): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
      resolve(false);
      return;
    }
    scrypt(password, SALT, HASH.length, OPTIONS, (error, got) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(got.length === HASH.length && timingSafeEqual(got, HASH));
    });
  });
}
