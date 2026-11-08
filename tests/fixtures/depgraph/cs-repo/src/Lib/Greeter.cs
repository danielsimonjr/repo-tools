namespace Lib;

/// <summary>Writes a greeting.</summary>
public static class Greeter
{
    public static string Greet(string name) => Format.Wrap(name);
}
