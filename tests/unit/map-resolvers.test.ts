/**
 * The resolvers of the map engine: specifier to file, per language.
 *
 * Ported from the architecture-docs skill: `test_typescript_resolver.py`,
 * `test_python_resolver.py`, `test_csharp_resolver.py`, and the resolver part of `test_rust.py`.
 */
import { describe, expect, test } from "bun:test";
import { emptyModule } from "../../src/map/parsing.ts";
import { CSharpResolver, getResolver, RustResolver } from "../../src/map/resolvers.ts";

describe("TypeScript resolver", () => {
  const r = getResolver("typescript");
  const KNOWN = new Set(["src/a.ts", "src/b.ts", "src/dir/index.ts", "src/c.tsx"]);

  test("classifies the specifier kind", () => {
    expect(r.classifySpecifier("./b.js")).toBe("relative");
    expect(r.classifySpecifier("node:fs")).toBe("node");
    expect(r.classifySpecifier("fs")).toBe("node");
    expect(r.classifySpecifier("zod")).toBe("external");
    expect(r.classifySpecifier("fs/promises")).toBe("node");
    expect(r.classifySpecifier("node:fs/promises")).toBe("node");
  });

  test("classifies alias specifiers apart from external packages", () => {
    expect(r.classifySpecifier("@/components/Button")).toBe("alias");
    expect(r.classifySpecifier("~/lib/util")).toBe("alias");
    expect(r.classifySpecifier("@scope/pkg")).toBe("external");
    expect(r.resolve("@/components/Button", "src/a.ts", KNOWN)).toBeNull();
  });

  test("resolves .js to the .ts source, extensionless, index and .tsx", () => {
    expect(r.resolve("./b.js", "src/a.ts", KNOWN)).toBe("src/b.ts");
    expect(r.resolve("./b", "src/a.ts", KNOWN)).toBe("src/b.ts");
    expect(r.resolve("./dir", "src/a.ts", KNOWN)).toBe("src/dir/index.ts");
    expect(r.resolve("./c.js", "src/a.ts", KNOWN)).toBe("src/c.tsx");
    expect(r.resolve("zod", "src/a.ts", KNOWN)).toBeNull();
  });

  test("prefers the .ts source over a literal .js, and falls back to the .js", () => {
    expect(r.resolve("./b.js", "src/a.ts", new Set([...KNOWN, "src/b.js"]))).toBe("src/b.ts");
    const known = new Set(["src/a.ts", "src/legacy.js"]);
    expect(r.resolve("./legacy.js", "src/a.ts", known)).toBe("src/legacy.js");
    expect(r.resolve("./legacy", "src/a.ts", known)).toBe("src/legacy.js");
  });
});

describe("Python resolver", () => {
  const r = getResolver("python");
  const KNOWN = new Set([
    "server.py",
    "remember/__init__.py",
    "remember/system.py",
    "remember/types.py",
    "pkg/sub/__init__.py",
    "pkg/sub/deep.py",
  ]);

  test("classifies the specifier kind", () => {
    expect(r.classifySpecifier(".types")).toBe("relative");
    expect(r.classifySpecifier("..pkg.mod")).toBe("relative");
    expect(r.classifySpecifier("os")).toBe("stdlib");
    expect(r.classifySpecifier("os.path")).toBe("stdlib");
    expect(r.classifySpecifier("asyncio")).toBe("stdlib");
    expect(r.classifySpecifier("numpy")).toBe("external");
    expect(r.classifySpecifier("fastmcp.server")).toBe("external");
  });

  test("relative imports: a sibling module, the package init, one level up", () => {
    expect(r.resolve(".types", "remember/system.py", KNOWN)).toBe("remember/types.py");
    expect(r.resolve(".", "remember/system.py", KNOWN)).toBe("remember/__init__.py");
    const known = new Set(["a/b/c.py", "a/x.py", "a/__init__.py"]);
    expect(r.resolve("..x", "a/b/c.py", known)).toBe("a/x.py");
  });

  test("absolute first-party paths, and a package to its init", () => {
    expect(r.resolve("remember.system", "server.py", KNOWN)).toBe("remember/system.py");
    expect(r.resolve("pkg.sub.deep", "server.py", KNOWN)).toBe("pkg/sub/deep.py");
    expect(r.resolve("pkg.sub", "server.py", KNOWN)).toBe("pkg/sub/__init__.py");
  });

  test("an unresolvable or stdlib import gives null, and climbing above the root is not an error", () => {
    expect(r.resolve(".nope", "remember/system.py", KNOWN)).toBeNull();
    expect(r.resolve("numpy", "server.py", KNOWN)).toBeNull();
    expect(r.resolve("os", "server.py", KNOWN)).toBeNull();
    expect(r.resolve("....way.up", "remember/system.py", KNOWN)).toBeNull();
  });
});

describe("C# resolver", () => {
  /** A resolver whose index says: path -> the namespaces that the path declares. */
  function indexed(mapping: Record<string, string[]>): CSharpResolver {
    const r = new CSharpResolver();
    const parsed = new Map(
      Object.entries(mapping).map(([p, ns]) => [p, { ...emptyModule(), provides: ns }] as const),
    );
    r.indexNamespaces(parsed);
    return r;
  }
  const none = new Set<string>();

  test("System namespaces are stdlib; a name that only starts with System is not", () => {
    const r = new CSharpResolver();
    expect(r.classifySpecifier("System")).toBe("stdlib");
    expect(r.classifySpecifier("System.Text.Json")).toBe("stdlib");
    expect(r.classifySpecifier("System.Collections.Generic")).toBe("stdlib");
    expect(r.classifySpecifier("SystemsCheck.Core")).not.toBe("stdlib");
  });

  test("first-party and third-party both classify as external before resolution", () => {
    const r = new CSharpResolver();
    expect(r.classifySpecifier("ModelContextProtocol.Server")).toBe("external");
    expect(r.classifySpecifier("UiMcp.Abstractions")).toBe("external");
    expect(r.resolvesAbsoluteInternal).toBe(true);
  });

  test("a using resolves to every file that declares the namespace, except itself", () => {
    expect(
      indexed({ "src/UiMcp/Tools/UiTools.cs": ["UiMcp.Tools"] }).resolveAll(
        "UiMcp.Tools",
        "src/UiMcp/Program.cs",
        none,
      ),
    ).toEqual(["src/UiMcp/Tools/UiTools.cs"]);
    const many = indexed({
      "src/A.cs": ["Shared.Core"],
      "src/B.cs": ["Shared.Core"],
      "src/C.cs": ["Other"],
    });
    expect(many.resolveAll("Shared.Core", "src/Z.cs", none)).toEqual(["src/A.cs", "src/B.cs"]);
    const self = indexed({ "src/A.cs": ["Shared.Core"], "src/B.cs": ["Shared.Core"] });
    expect(self.resolveAll("Shared.Core", "src/A.cs", none)).toEqual(["src/B.cs"]);
  });

  test("an unknown namespace, no index, or a parent namespace gives nothing", () => {
    expect(
      indexed({ "src/A.cs": ["Known"] }).resolveAll("Nuget.Package", "src/A.cs", none),
    ).toEqual([]);
    expect(new CSharpResolver().resolveAll("Anything", "a.cs", none)).toEqual([]);
    expect(
      indexed({ "src/Tools.cs": ["UiMcp.Tools"] }).resolveAll("UiMcp", "src/Program.cs", none),
    ).toEqual([]);
  });

  test("resolve gives one path, or null", () => {
    expect(indexed({ "src/A.cs": ["N"] }).resolve("N", "src/Z.cs", none)).toBe("src/A.cs");
    expect(indexed({ "src/A.cs": ["N"] }).resolve("Missing", "src/Z.cs", none)).toBeNull();
  });

  test("getResolver gives a new C# resolver for each build", () => {
    expect(getResolver("csharp")).not.toBe(getResolver("csharp"));
  });
});

describe("Rust resolver", () => {
  const r = new RustResolver();

  test("resolveMod finds a sibling file and a mod.rs", () => {
    const known = new Set(["src/lib.rs", "src/engine.rs", "src/net/mod.rs"]);
    expect(r.resolveMod("engine", "src/lib.rs", known)).toBe("src/engine.rs");
    expect(r.resolveMod("net", "src/lib.rs", known)).toBe("src/net/mod.rs");
  });

  test("a non-mod.rs file owns a sibling folder", () => {
    const known = new Set(["src/lib.rs", "src/a.rs", "src/a/child.rs"]);
    expect(r.resolveMod("child", "src/a.rs", known)).toBe("src/a/child.rs");
  });

  test("crate, self and super roots", () => {
    const known = new Set(["src/lib.rs", "src/a.rs", "src/a/child.rs", "src/a/b.rs", "src/b.rs"]);
    expect(r.resolve("crate::b::Thing", "src/a/child.rs", known)).toBe("src/b.rs");
    expect(r.resolve("self::child::Thing", "src/a.rs", known)).toBe("src/a/child.rs");
    expect(r.resolve("super::b::Thing", "src/a/child.rs", known)).toBe("src/a/b.rs");
    expect(r.resolve("super::super::b::Thing", "src/a/child.rs", known)).toBe("src/b.rs");
  });

  test("the standard library and external crates resolve to nothing", () => {
    const known = new Set(["src/lib.rs", "src/a.rs"]);
    expect(r.resolve("std::fmt::Debug", "src/a.rs", known)).toBeNull();
    expect(r.resolve("serde::Serialize", "src/a.rs", known)).toBeNull();
  });

  test("a trailing item segment does not invent a file", () => {
    expect(r.resolve("crate::a::Thing", "src/lib.rs", new Set(["src/lib.rs", "src/a.rs"]))).toBe(
      "src/a.rs",
    );
  });
});
