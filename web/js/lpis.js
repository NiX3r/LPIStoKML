/*
 * LPIS (SHP in ZIP) → KML for DJI FlightHub 2. Runs entirely in the browser (also in Node for tests).
 * Needs globals `fflate` (unzip) and `proj4` (S-JTSK → WGS-84).
 */
(function (root) {
  "use strict";

  // EPSG:5514 S-JTSK / Krovak East North with the same 7-parameter datum shift PROJ/pyproj picks
  // for the Czech Republic (~1 m accuracy). The shift in LPIS .prj files alone would be ~10 m off.
  var KROVAK =
    "+proj=krovak +lat_0=49.5 +lon_0=24.83333333333333 +alpha=30.28813972222222 +k=0.9999 " +
    "+x_0=0 +y_0=0 +ellps=bessel +towgs84=572.213,85.334,461.94,4.9732,1.529,5.2484,3.5378 +units=m +no_defs";

  // Block-name columns, preferring short human-readable codes like "4003/2".
  var BLOCK_COLUMNS = ["ZKOD_DPB", "NKOD_DPB", "BLOK_ID", "DPB_ID", "LBLOK", "NBLOK", "KOD_DPB"];

  function LpisError(message) {
    this.name = "LpisError";
    this.message = message;
  }
  LpisError.prototype = Object.create(Error.prototype);

  // ── ZIP ──────────────────────────────────────────────────────────────
  // Collects shapefile parts from (possibly nested) ZIPs: { "dir/name": { shp, shx, dbf, prj, cpg } }.
  function collectShapefiles(zipBytes, sets, prefix) {
    var files;
    try {
      files = root.fflate.unzipSync(zipBytes, {
        filter: function (f) { return /\.(shp|shx|dbf|prj|cpg|zip)$/i.test(f.name); }
      });
    } catch (e) {
      throw new LpisError("Neplatný ZIP soubor.");
    }
    Object.keys(files).forEach(function (name) {
      var m = name.match(/^(.*)\.(shp|shx|dbf|prj|cpg|zip)$/i);
      var ext = m[2].toLowerCase();
      if (ext === "zip") {
        collectShapefiles(files[name], sets, prefix + name + "/");
        return;
      }
      var key = prefix + m[1];
      (sets[key] = sets[key] || { name: key })[ext] = files[name];
    });
    return sets;
  }

  // ── DBF ──────────────────────────────────────────────────────────────
  function dbfEncoding(cpg) {
    var c = cpg ? new TextDecoder().decode(cpg).trim().toUpperCase() : "";
    if (/UTF-?8/.test(c)) return "utf-8";
    var cp = c.match(/(\d{3,4})$/);
    if (cp) return "windows-" + cp[1];
    return "windows-1250"; // LPIS exports: language driver 0x57 ("ANSI") = Czech Windows code page
  }

  function readDbf(bytes, cpg) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var count = view.getUint32(4, true);
    var headerLen = view.getUint16(8, true);
    var recordLen = view.getUint16(10, true);
    var decoder = new TextDecoder(dbfEncoding(cpg));
    var fields = [];
    for (var p = 32, offset = 1; p + 32 <= headerLen && bytes[p] !== 0x0d; p += 32) {
      var nameBytes = bytes.subarray(p, p + 11);
      var end = nameBytes.indexOf(0);
      var name = new TextDecoder("ascii").decode(nameBytes.subarray(0, end < 0 ? 11 : end)).trim();
      var len = bytes[p + 16];
      fields.push({ name: name, type: String.fromCharCode(bytes[p + 11]), offset: offset, length: len });
      offset += len;
    }
    return {
      count: count,
      fields: fields,
      deleted: function (i) { return bytes[headerLen + i * recordLen] === 0x2a; },
      value: function (i, field) {
        var start = headerLen + i * recordLen + field.offset;
        return decoder.decode(bytes.subarray(start, start + field.length)).trim();
      }
    };
  }

  // ── SHP ──────────────────────────────────────────────────────────────
  function shpOffsets(shp, shx) {
    var offsets = [];
    if (shx) {
      var x = new DataView(shx.buffer, shx.byteOffset, shx.byteLength);
      for (var p = 100; p + 8 <= shx.byteLength; p += 8) offsets.push(x.getInt32(p, false) * 2);
      return offsets;
    }
    var s = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
    for (var q = 100; q + 8 <= shp.byteLength; q += 8 + s.getInt32(q + 4, false) * 2) offsets.push(q);
    return offsets;
  }

  // Returns the rings ([[x, y], …]) of a (Multi)Polygon record, or null for other/empty shapes.
  function readRings(shp, offset) {
    var v = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
    var p = offset + 8;
    var type = v.getInt32(p, true);
    if (type !== 5 && type !== 15 && type !== 25) return null; // Polygon, PolygonZ, PolygonM
    var numParts = v.getInt32(p + 36, true);
    var numPoints = v.getInt32(p + 40, true);
    var partsAt = p + 44;
    var pointsAt = partsAt + numParts * 4;
    var rings = [];
    for (var i = 0; i < numParts; i++) {
      var from = v.getInt32(partsAt + i * 4, true);
      var to = i + 1 < numParts ? v.getInt32(partsAt + (i + 1) * 4, true) : numPoints;
      var ring = [];
      for (var k = from; k < to; k++) {
        ring.push([v.getFloat64(pointsAt + k * 16, true), v.getFloat64(pointsAt + k * 16 + 8, true)]);
      }
      if (ring.length >= 4) rings.push(ring);
    }
    return rings.length ? rings : null;
  }

  // ── Coordinates ──────────────────────────────────────────────────────
  function makeTransform(prj, sampleXY) {
    var wkt = prj ? new TextDecoder().decode(prj) : "";
    if (/krovak|s[-_]?jtsk/i.test(wkt)) return proj4Forward(KROVAK);
    if (wkt) {
      if (/GEOGCS\[[^\]]*WGS[ _]?84/i.test(wkt) && !/PROJCS/i.test(wkt)) return null;
      try { return proj4Forward(wkt); } catch (e) { /* fall through to guessing */ }
    }
    // No/unknown .prj: LPIS coordinates are S-JTSK (negative metres); plain degrees need no transform.
    if (sampleXY && Math.abs(sampleXY[0]) <= 180 && Math.abs(sampleXY[1]) <= 90) return null;
    return proj4Forward(KROVAK);
  }

  function proj4Forward(def) {
    var conv = root.proj4(def, "EPSG:4326");
    return function (xy) { return conv.forward([xy[0], xy[1]]); };
  }

  function signedArea(ring) {
    var a = 0;
    for (var i = 0, n = ring.length - 1; i < n; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    return a / 2;
  }

  function contains(ring, pt) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // Shapefile rule: outer rings clockwise, holes counter-clockwise. Returns [{ outer, holes }].
  function groupRings(rings) {
    var outers = [], holes = [];
    rings.forEach(function (r) { (signedArea(r) < 0 ? outers : holes).push(r); });
    if (!outers.length) { outers = holes; holes = []; }
    var polys = outers.map(function (r) { return { outer: r, holes: [] }; });
    holes.forEach(function (h) {
      var owner = polys.find(function (p) { return contains(p.outer, h[0]); });
      if (owner) owner.holes.push(h);
      else polys.push({ outer: h.slice().reverse(), holes: [] });
    });
    return polys;
  }

  // ── KML ──────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c];
    });
  }

  function ringKml(ring) {
    return ring.map(function (c) { return c[0].toFixed(9) + "," + c[1].toFixed(9) + ",0"; }).join(" ");
  }

  function toKml(name, blocks) {
    var out = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<kml xmlns="http://www.opengis.net/kml/2.2">',
      "<Document>",
      "<name>" + esc(name) + "</name>",
      // Semi-transparent green fill, solid green border
      '<Style id="lpis"><LineStyle><color>ff00ff00</color><width>2</width></LineStyle>' +
        "<PolyStyle><color>7f00ff00</color><outline>1</outline></PolyStyle></Style>"
    ];
    blocks.forEach(function (b) {
      b.polygons.forEach(function (p) {
        out.push(
          "<Placemark><name>" + esc(b.name) + "</name><styleUrl>#lpis</styleUrl><Polygon>" +
            "<outerBoundaryIs><LinearRing><coordinates>" + ringKml(p.outer) + "</coordinates></LinearRing></outerBoundaryIs>" +
            p.holes.map(function (h) {
              return "<innerBoundaryIs><LinearRing><coordinates>" + ringKml(h) + "</coordinates></LinearRing></innerBoundaryIs>";
            }).join("") +
            "</Polygon></Placemark>"
        );
      });
    });
    out.push("</Document>", "</kml>", "");
    return out.join("\n");
  }

  // ── Main ─────────────────────────────────────────────────────────────
  /**
   * @param {Uint8Array[]} zips   one or more LPIS SHP ZIP files
   * @param {{idUz: string, blockNumber?: string, outputName?: string}} opts
   * @returns {{kml: string, fileName: string, blocks: {name: string, polygons: object[]}[]}}
   */
  function convert(zips, opts) {
    var idUz = String(opts.idUz || "").trim();
    var blockNumber = String(opts.blockNumber || "").trim();
    var outputName = String(opts.outputName || "").trim().replace(/[\/\\:*?"<>|]/g, "_") || "lpis_export";
    if (!idUz) throw new LpisError("ID_UZ je povinné pole.");

    var sets = {};
    zips.forEach(function (z) { collectShapefiles(z, sets, ""); });
    var layers = Object.keys(sets).map(function (k) { return sets[k]; }).filter(function (s) { return s.shp && s.dbf; });
    if (!layers.length) throw new LpisError("ZIP neobsahuje žádné SHP soubory.");
    // Prefer DPB shapefiles if present
    var dpb = layers.filter(function (s) { return /dpb/i.test(s.name.split("/").pop()); });
    if (dpb.length) layers = dpb;

    var blocks = [];
    var idFound = false;
    var columns = [];
    var idNum = Number(idUz);

    layers.forEach(function (layer) {
      var dbf = readDbf(layer.dbf, layer.cpg);
      var byName = {};
      dbf.fields.forEach(function (f) { byName[f.name.toUpperCase()] = f; });
      columns = dbf.fields.map(function (f) { return f.name; });
      var idField = byName.ID_UZ;
      if (!idField) return;
      idFound = true;
      var blockField = BLOCK_COLUMNS.map(function (c) { return byName[c]; }).find(Boolean);

      var offsets = shpOffsets(layer.shp, layer.shx);
      var transform;
      for (var i = 0; i < dbf.count && i < offsets.length; i++) {
        if (dbf.deleted(i)) continue;
        var id = dbf.value(i, idField);
        if (id !== idUz && !(id !== "" && Number(id) === idNum)) continue;
        var name = blockField ? dbf.value(i, blockField) : "Blok " + i;
        if (blockNumber && blockField && name !== blockNumber) continue;
        var rings = readRings(layer.shp, offsets[i]);
        if (!rings) continue;
        if (transform === undefined) transform = makeTransform(layer.prj, rings[0][0]);
        if (transform) rings = rings.map(function (r) { return r.map(transform); });
        blocks.push({ name: name, polygons: groupRings(rings) });
      }
    });

    if (!idFound) {
      throw new LpisError("Sloupec ID_UZ nenalezen. Dostupné sloupce: " + columns.join(", "));
    }
    if (!blocks.length) {
      throw new LpisError(
        blockNumber
          ? 'Blok "' + blockNumber + '" pro ID_UZ=' + idUz + " nebyl nalezen."
          : "Pro ID_UZ=" + idUz + " nebyly nalezeny žádné bloky."
      );
    }
    return { kml: toKml(outputName, blocks), fileName: outputName + ".kml", blocks: blocks };
  }

  root.LPIS = { convert: convert, LpisError: LpisError };
})(typeof globalThis !== "undefined" ? globalThis : this);
