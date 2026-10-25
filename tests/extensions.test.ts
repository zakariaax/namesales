import { describe, expect, it } from "vitest";
import { arrangeExtensions, classifyExtension, VISIBLE_EXTENSION_CAP, type ExtensionCount } from "../src/shared/extensions";

function row(extension: string, count: number): ExtensionCount {
  return { extension, count };
}

const catalog: ExtensionCount[] = [
  row(".com", 1000),
  row(".net", 800),
  row(".org", 700),
  row(".io", 600),
  row(".ai", 500),
  row(".co", 400),
  row(".xyz", 300),
  row(".app", 200),
  row(".shop", 190),
  row(".dev", 180),
  row(".online", 170),
  row(".site", 160),
  row(".blog", 6),
  row(".info", 5),
  row(".biz", 4),
  row(".de", 3),
  row(".co.uk", 2),
  ...Array.from({ length: 40 }, (_, index) => row(`.n${String(index).padStart(2, "0")}tld`, 1)),
];

describe("extension picker groups", () => {
  it("leads with the popular names, then classifies the rest, and caps the mounted rows", () => {
    const view = arrangeExtensions(catalog, "");
    expect(view.totalMatches).toBe(catalog.length);
    expect(view.shown).toBe(VISIBLE_EXTENSION_CAP);
    expect(view.groups.map((group) => group.name)).toEqual(["Popular", "Generic", "Country codes", "New gTLDs"]);
    expect(view.groups[0]?.items.map((item) => item.extension)).toEqual([
      ".com", ".net", ".org", ".io", ".ai", ".co", ".xyz", ".app", ".shop", ".dev", ".online", ".site",
    ]);
    expect(view.groups[1]?.items.map((item) => item.extension)).toEqual([".info", ".biz"]);
    expect(view.groups[2]?.items.map((item) => item.extension)).toEqual([".de", ".co.uk"]);
    expect(view.groups[3]?.items[0]?.extension).toBe(".blog");
    const mounted = view.groups.reduce((sum, group) => sum + group.items.length, 0);
    expect(mounted).toBe(VISIBLE_EXTENSION_CAP);
  });

  it("filters in memory and keeps a typed match in its own group", () => {
    const countries = arrangeExtensions(catalog, "UK");
    expect(countries.totalMatches).toBe(1);
    expect(countries.groups).toEqual([{ name: "Country codes", items: [row(".co.uk", 2)] }]);
    const generic = arrangeExtensions(catalog, ".info");
    expect(generic.groups[0]).toEqual({ name: "Generic", items: [row(".info", 5)] });
    const popular = arrangeExtensions(catalog, "com");
    expect(popular.groups[0]?.name).toBe("Popular");
    expect(popular.groups[0]?.items.map((item) => item.extension)).toEqual([".com"]);
  });

  it("classifies legacy, country, and new names", () => {
    expect(classifyExtension(".info")).toBe("Generic");
    expect(classifyExtension(".de")).toBe("Country codes");
    expect(classifyExtension(".co.uk")).toBe("Country codes");
    expect(classifyExtension(".blog")).toBe("New gTLDs");
  });
});
