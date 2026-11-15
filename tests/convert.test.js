// Run: node --test tests/
// Converts the sample LPIS export and checks it against reference coordinates computed with pyproj (EPSG:5514 → 4326).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

globalThis.fflate = require("../web/js/lib/fflate.js");
globalThis.proj4 = require("../web/js/lib/proj4.js");
require("../web/js/lpis.js");
const { convert, LpisError } = globalThis.LPIS;

const zip = new Uint8Array(fs.readFileSync(path.join(__dirname, "..", "test", "20260523-930318-DPB-SHP.zip")));

// First vertex of each block (S-JTSK → WGS-84 by pyproj/PROJ).
const REFERENCE = {
  "4003/2": [13.906095505880359, 49.790786405951124],
  "4002/2": [13.904165155744904, 49.78915982206711],
  "4001/1": [13.902814714539067, 49.78829229110989],
  "4001/3": [13.903856476751267, 49.7868212084719],
  "4004/2": [13.906033377478058, 49.78991455826608],
  "4005/1": [13.905631892251945, 49.79067610069143],
};

test("exports every block of a farmer", () => {
  const r = convert([zip], { idUz: "62418", outputName: "farma/1" });
  assert.equal(r.fileName, "farma_1.kml");
  assert.deepEqual(r.blocks.map((b) => b.name).sort(), Object.keys(REFERENCE).sort());
  for (const b of r.blocks) {
    const all = b.polygons.flatMap((p) => [p.outer, ...p.holes]);
    const [lon, lat] = REFERENCE[b.name];
    const hit = all.some((ring) => ring.some(([x, y]) => Math.abs(x - lon) < 1e-6 && Math.abs(y - lat) < 1e-6));
    assert.ok(hit, `${b.name}: reference vertex within ~5 cm`);
  }
  assert.match(r.kml, /^<\?xml/);
  assert.equal((r.kml.match(/<name>4003\/2<\/name>/g) || []).length, r.blocks.find((b) => b.name === "4003/2").polygons.length);
  assert.match(r.kml, /<coordinates>13\.9\d+,49\.7\d+,0 /);
});

test("exports a single block", () => {
  const r = convert([zip], { idUz: "62418", blockNumber: "4001/3" });
  assert.equal(r.fileName, "lpis_export.kml");
  assert.deepEqual(r.blocks.map((b) => b.name), ["4001/3"]);
});

test("reports missing farmer and block", () => {
  assert.throws(() => convert([zip], { idUz: "38670" }), LpisError);
  assert.throws(() => convert([zip], { idUz: "62418", blockNumber: "4901" }), /Blok "4901"/);
  assert.throws(() => convert([zip], { idUz: "" }), /ID_UZ je povinné/);
  assert.throws(() => convert([new Uint8Array([1, 2, 3])], { idUz: "1" }), /Neplatný ZIP/);
});
