/**
 * Length as the API's `@MaxLength` counts it (class-validator `isLength`):
 * a surrogate pair is one character, so an emoji counts once, not twice.
 */
export function textLength(value: string): number {
  return (
    value.length - (value.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g) ?? []).length
  );
}
