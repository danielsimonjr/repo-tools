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
    return x
