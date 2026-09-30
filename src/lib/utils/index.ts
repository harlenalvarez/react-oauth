type Class<T> = new (...args: never[]) => T;

export function create<T extends object>(obj: T, classType?: Class<T>): T {
  if (classType !== undefined) {
    return Object.assign(new classType(), obj);
  }

  const prototype: object | null = Object.getPrototypeOf(obj) as object | null;
  if (prototype === null || prototype === Object.prototype) return { ...obj };
  return Object.assign(Object.create(prototype) as T, obj);
}

export function isRequired(name: string): never {
  throw new Error(`Field ${name} is required`);
}

export function b64Encode(payload: string): string {
  return btoa(unescape(encodeURIComponent(payload)));
}

export function b64Decode(payload: string): string {
  return decodeURIComponent(escape(atob(payload)));
}
