// Inventory helpers (JavaScript).
const DOCS_URL = "https://example.com/docs";

/**
 * Returns the total quantity.
 */
function total(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.quantity; // add one item
  }
  return sum;
}


/* Returns the item names. */
function names(items) {
  return items.map((item) => item.name);
}

module.exports = { total, names, DOCS_URL };
