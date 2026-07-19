/**
 * Recursively removes keys whose value is `undefined` from a plain-object tree.
 *
 * Firestore rejects `undefined` field values with "Unsupported field value: undefined".
 * Call this before any addDoc / updateDoc / setDoc when the data object was built
 * from TypeScript interfaces that contain optional (?) fields.
 *
 * Non-plain-object values (arrays, Dates, Firestore FieldValues such as
 * serverTimestamp()) are passed through unchanged — their prototypes differ
 * from Object.prototype so they are never recursed into.
 */
export function removeUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(removeUndefined) as unknown as T;
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as object)) {
      if (v !== undefined) {
        out[k] = removeUndefined(v);
      }
    }
    return out as T;
  }
  return value;
}
