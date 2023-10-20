type Class<T> = new (...args: any[]) => T;

export const create = <T extends {}>(obj: T, classType?: Class<T>): T => {
  if (classType) {
    const instance = new classType();
    return Object.assign(instance, obj);
  }
  const prototype = Object.getPrototypeOf(obj);
  if (prototype.constructor) {
    const instance = new prototype.constructor();
    return Object.assign(instance, obj);
  }
  return Object.assign(Object.create(prototype), obj);
}

export const isRequired = (name: string): any => {
  throw new Error(`Field ${name} is required`);
}

export const b64Encode = (payload: string) => btoa(unescape(encodeURIComponent(payload)));
export const b64Decode = (payload: string) => decodeURIComponent(escape(atob(payload)));

// for unit testing purposes
const hardCodedHash = '²Èªï{Ê«¢¤¹`àçp³&²#}J	É~Ü|';
export const genKey = async (tokenHash: string) => {
  const hash = (!tokenHash || tokenHash.length < 32) ? hardCodedHash : tokenHash.substring(0, 32);
  const encode = Uint8Array.from(hash, x => x.charCodeAt(0));
  let key = await crypto.subtle.importKey(
    'raw',
    encode,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  return key;
}