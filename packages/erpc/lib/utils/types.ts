/**
 * Combine types A and B, but A overwrites common properties
 */
export type Overwrite<A extends Record<string, any>, B extends Record<string, any>> = A & Omit<B, keyof A>;
