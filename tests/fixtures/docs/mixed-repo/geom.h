#ifndef GEOM_H
#define GEOM_H

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Adds two numbers.
 * @param a The first number.
 * @param b The second number.
 * @return The sum.
 */
int geom_add(int a, int b);

int geom_scale(int v, int k);

#ifdef __cplusplus
}
#endif

#endif
