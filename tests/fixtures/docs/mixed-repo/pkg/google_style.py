"""Helpers that use the Google docstring form."""


def scale(value, factor=2):
    """Multiply the value by the factor.

    Args:
        value: The number to scale.
        factor: The multiplier.

    Returns:
        The scaled number.
    """
    return value * factor


def undocumented(a, b):
    return a + b


class Store:
    """Hold named values."""

    def put(self, key,
            value):
        self.data = {key: value}

    def get(self, key):
        """Return the value for the key.

        Args:
            key: The name to look up.
            stale: A name that the signature does not have.
        """
        return self.data[key]
