#include "geom.h"

/** Clamps a value. */
static int clamp(int v) {
  return v;
}

int geom_scale(int v, int k) {
  return clamp(v) * k;
}
