const localStorageDescriptor =
  typeof window === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(window, "localStorage");

if (typeof window !== "undefined" && localStorageDescriptor?.value === undefined) {
  const values = new Map<string, string>();
  const storagePrototype = Storage.prototype;

  Object.defineProperties(storagePrototype, {
    clear: {
      configurable: true,
      value() {
        values.clear();
      },
    },
    getItem: {
      configurable: true,
      value(key: string) {
        return values.get(String(key)) ?? null;
      },
    },
    key: {
      configurable: true,
      value(index: number) {
        return Array.from(values.keys())[index] ?? null;
      },
    },
    length: {
      configurable: true,
      get() {
        return values.size;
      },
    },
    removeItem: {
      configurable: true,
      value(key: string) {
        values.delete(String(key));
      },
    },
    setItem: {
      configurable: true,
      value(key: string, value: string) {
        values.set(String(key), String(value));
      },
    },
  });

  const storage = Object.create(storagePrototype) as Storage;

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
}
