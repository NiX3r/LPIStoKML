import io
import os
import tempfile
import zipfile
from pathlib import Path

import geopandas as gpd
import pandas as pd
import simplekml
from flask import Flask, jsonify, render_template, request, send_file

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024  # 500 MB


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/wiki")
def wiki():
    return render_template("wiki.html")


@app.route("/convert", methods=["POST"])
def convert():
    if "zip_file" not in request.files or not request.files["zip_file"].filename:
        return jsonify({"error": "Nebyl nahrán žádný soubor."}), 400

    f = request.files["zip_file"]
    id_uz = request.form.get("id_uz", "").strip()
    output_name = request.form.get("output_name", "").strip() or "lpis_export"
    block_number = request.form.get("block_number", "").strip()

    if not id_uz:
        return jsonify({"error": "ID_UZ je povinné pole."}), 400

    for ch in r'/\:*?"<>|':
        output_name = output_name.replace(ch, "_")

    with tempfile.TemporaryDirectory() as tmpdir:
        zip_path = os.path.join(tmpdir, "input.zip")
        f.save(zip_path)

        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                # Guard against zip-slip path traversal
                base = Path(tmpdir).resolve()
                for member in zf.namelist():
                    dest = (base / member).resolve()
                    if not str(dest).startswith(str(base)):
                        return jsonify({"error": "Neplatný ZIP soubor."}), 400
                zf.extractall(tmpdir)
        except zipfile.BadZipFile:
            return jsonify({"error": "Neplatný ZIP soubor."}), 400

        shp_files = list(Path(tmpdir).rglob("*.shp"))
        if not shp_files:
            return jsonify({"error": "ZIP neobsahuje žádné SHP soubory."}), 400

        # Prefer DPB shapefiles if present
        dpb_files = [p for p in shp_files if "dpb" in p.name.lower()]
        if dpb_files:
            shp_files = dpb_files

        gdfs = []
        for shp in shp_files:
            try:
                gdf = gpd.read_file(str(shp))
                if not gdf.empty:
                    gdfs.append(gdf)
            except Exception:
                pass

        if not gdfs:
            return jsonify({"error": "Nepodařilo se načíst žádné SHP soubory."}), 400

        # Normalise to common CRS before concat
        base_crs = gdfs[0].crs
        normalised = []
        for gdf in gdfs:
            if gdf.crs is not None and gdf.crs != base_crs:
                try:
                    gdf = gdf.to_crs(base_crs)
                except Exception:
                    pass
            normalised.append(gdf)

        combined = gpd.GeoDataFrame(
            pd.concat(normalised, ignore_index=True),
            geometry="geometry",
            crs=base_crs,
        )

        col_map = {c.upper(): c for c in combined.columns}
        id_col = col_map.get("ID_UZ")
        if id_col is None:
            avail = ", ".join(c for c in combined.columns if c != "geometry")
            return jsonify(
                {"error": f"Sloupec ID_UZ nenalezen. Dostupné sloupce: {avail}"}
            ), 400

        filtered = combined[combined[id_col].astype(str).str.strip() == id_uz].copy()

        # Find the block-name column (try common LPIS variants, prefer short human-readable codes)
        block_col = next(
            (col_map[c] for c in ("ZKOD_DPB", "NKOD_DPB", "BLOK_ID", "DPB_ID", "LBLOK", "NBLOK", "KOD_DPB") if c in col_map),
            None,
        )

        if block_number and block_col:
            filtered = filtered[filtered[block_col].astype(str).str.strip() == block_number]

        if filtered.empty:
            if block_number:
                msg = f'Blok "{block_number}" pro ID_UZ={id_uz} nebyl nalezen.'
            else:
                msg = f"Pro ID_UZ={id_uz} nebyly nalezeny žádné bloky."
            return jsonify({"error": msg, "count": 0}), 404

        count = len(filtered)

        # Reproject to WGS84 — KML requires geographic coords
        if filtered.crs is not None and filtered.crs.to_epsg() != 4326:
            try:
                filtered = filtered.to_crs(epsg=4326)
            except Exception as e:
                return jsonify({"error": f"Chyba převodu souřadnic: {e}"}), 500

        kml = simplekml.Kml()
        kml.document.name = output_name

        for _, row in filtered.iterrows():
            name = str(row[block_col]).strip() if block_col else f"Blok {_}"
            geom = row.geometry
            if geom is None or geom.is_empty:
                continue

            if geom.geom_type == "Polygon":
                polys = [geom]
            elif geom.geom_type == "MultiPolygon":
                polys = list(geom.geoms)
            else:
                continue

            for poly in polys:
                pol = kml.newpolygon(name=name)
                pol.outerboundaryis = [(c[0], c[1]) for c in poly.exterior.coords]
                if poly.interiors:
                    pol.innerboundaryis = [(c[0], c[1]) for c in list(poly.interiors)[0].coords]
                # Semi-transparent green fill, solid green border
                pol.style.polystyle.color = "7f00ff00"
                pol.style.polystyle.outline = 1
                pol.style.linestyle.color = "ff00ff00"
                pol.style.linestyle.width = 2

        kml_bytes = io.BytesIO(kml.kml().encode("utf-8"))

        response = send_file(
            kml_bytes,
            mimetype="application/vnd.google-earth.kml+xml",
            as_attachment=True,
            download_name=f"{output_name}.kml",
        )
        response.headers["X-Block-Count"] = str(count)
        # Allow JS to read the custom header cross-origin
        response.headers["Access-Control-Expose-Headers"] = "X-Block-Count"
        return response


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
