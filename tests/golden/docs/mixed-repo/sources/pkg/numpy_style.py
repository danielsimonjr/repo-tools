"""Helpers that use the NumPy docstring form."""


def mean(values):
    """Return the mean of the values.

    Parameters
    ----------
    values : list
        The numbers.

    Returns
    -------
    float
        The mean.
    """
    return sum(values) / len(values)


def missing(x):
    """TODO: state what this does, in one active-voice sentence.

    Args:
        x: TODO: state what it is. Do not repeat the type.

    Returns:
        TODO: state what the caller gets back.
    """
    return x
