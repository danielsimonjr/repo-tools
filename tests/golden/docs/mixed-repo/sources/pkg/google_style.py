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
    """TODO: state what this does, in one active-voice sentence.

    Args:
        a: TODO: state what it is. Do not repeat the type.
        b: TODO: state what it is. Do not repeat the type.

    Returns:
        TODO: state what the caller gets back.
    """
    return a + b


class Store:
    """Hold named values."""

    def put(self, key,
            value):
        """TODO: state what this does, in one active-voice sentence.

        Args:
            key: TODO: state what it is. Do not repeat the type.
            value: TODO: state what it is. Do not repeat the type.

        Returns:
            TODO: state what the caller gets back.
        """
        self.data = {key: value}

    def get(self, key):
        """Return the value for the key.

        Args:
            key: The name to look up.
            stale: A name that the signature does not have.
        """
        return self.data[key]
