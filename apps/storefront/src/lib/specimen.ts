/**
 * The specimen fields.
 *
 * Five flat tints a photograph can sit on, rotated in a fixed order so a grid
 * of tiles reads as a considered set rather than a random palette. They are all
 * near-neutral and low-saturation on purpose: the shoe is the only saturated
 * thing on the page.
 *
 * This lives in a plain module rather than beside a component because both
 * server and client components need it. Re-exporting it from a `'use client'`
 * file would make it a client reference, and a server component cannot call a
 * client function during render.
 */
const FIELDS = ['bg-field-a', 'bg-field-b', 'bg-field-c', 'bg-field-d', 'bg-field-e'] as const;

/** The field tint for the nth tile in a sequence. Always the same order. */
export function fieldForIndex(index: number): string {
  return FIELDS[index % FIELDS.length] as string;
}
