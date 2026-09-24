import { readFileSync } from "node:fs";
import {
  join,
  dirname,
} from "node:path";
import type { Stats } from "node:fs";

// A top-level comment with braces { that } must not count.
