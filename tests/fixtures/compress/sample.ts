/**
 * Inventory helpers.
 * See https://example.com/docs for details.
 */

// The item record.
export interface Item {
  name: string; // The item name.
  quantity: number;
}

/* A block comment
   that spans two lines. */
export function total(items: Item[]): number {
  let sum = 0;
  for (const item of items) {
    sum += item.quantity;
  }



  return sum;
}

export function names(items: Item[]): string[] {
  return items.map((item) => item.name);
}
