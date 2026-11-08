"""Helpers that use the reST docstring form."""


def clamp(x, low, high):
    """Clamp x into the range.

    :param x: The value.
    :param low: The lower bound.
    :param high: The upper bound.
    :returns: The clamped value.
    """
    return max(low, min(x, high))


def todo_left(y):
    """TODO: state what this does."""
    return y


def _private(z):
    return z
