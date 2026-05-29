# LPIS → KML for DJI FlightHub 2

A web app that converts Czech agricultural land parcel data (LPIS) from Shapefile format into KML files ready to import into **DJI FlightHub 2** for drone mission planning.

Primary use case: scanning fields with a drone before mowing to rescue fawns and other wildlife.

![Python](https://img.shields.io/badge/Python-3.9%2B-3a7d3a?logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-2.3%2B-3a7d3a?logo=flask&logoColor=white)

---

## How it works

1. Download a SHP ZIP for your district from the public [LPIS data portal](https://mze.gov.cz/public/app/eagriapp/lpisdata/)
2. Upload the ZIP to the web app and enter your **ID_UZ** (farmer's LPIS identifier)
3. The app filters the parcels, reprojects coordinates from S-JTSK (EPSG:5514) to WGS-84, and generates a KML file
4. Import the KML into DJI FlightHub 2 via **Map Annotations → Import**

All land parcels appear on the map labelled with their block numbers (e.g. `4003/2`).

---

## Quick start

### Requirements

- Python 3.9+
- pip

### Install

```bash
pip install flask geopandas simplekml
```

### Run

```bash
python app.py
```

Open [http://localhost:5000](http://localhost:5000) in your browser.

---

## Usage

### Getting your ID_UZ

Every farmer registered in the Czech LPIS system has a unique **ID_UZ** number (also called *ID LPIS*).

1. Go to [mze.gov.cz → LPIS public register](https://mze.gov.cz/public/app/lpisext/lpis/verejny2/plpis/)
2. Search by municipality name in the **Obec** tab
3. Click the farmer's name in the results
4. Note the **ID LPIS** number (e.g. `89677`) — this is your ID_UZ

### Downloading the SHP data

1. Go to [eagri.cz → LPIS data](https://mze.gov.cz/public/app/eagriapp/lpisdata/)
2. Filter by **district** (okres)
3. Set **Entita = DPB**, **Typ = SHP**
4. Click *Vygenerovat seznam souborů*
5. Download the first row where *Území = Okres* (covers the whole district)

> **Note:** If a farmer operates across multiple districts, download a ZIP for each district.

### Converting

| Field | Required | Description |
|---|---|---|
| ZIP file | ✓ | SHP ZIP downloaded from LPIS |
| ID_UZ | ✓ | Farmer's LPIS identifier |
| Output filename | — | Name for the KML file (default: `lpis_export`) |
| Block number | — | Export a single parcel only (e.g. `4003/2`) |

Leave **Block number** empty to export all parcels for the given ID_UZ at once.

---

## Project structure

```
├── app.py               # Flask app — upload, process, download
├── requirements.txt
├── templates/
│   ├── index.html       # Converter UI
│   └── wiki.html        # Documentation page (/wiki)
└── docs/
    └── MANUAL *.pdf     # Original manual (Czech)
```

---

## Tech stack

| Library | Purpose |
|---|---|
| [Flask](https://flask.palletsprojects.com/) | Web server |
| [GeoPandas](https://geopandas.org/) | Reading SHP files, CRS reprojection |
| [simplekml](https://simplekml.readthedocs.io/) | Generating KML output |

---

## Notes

- **Coordinate system:** LPIS data uses S-JTSK / Krovak (EPSG:5514). The app reprojects to WGS-84 (EPSG:4326) as required by KML.
- **3D geometry:** LPIS polygons are `POLYGON Z` — Z values are stripped in the output KML.
- **Block name column:** The app looks for `ZKOD_DPB` first (short code like `4003/2`), falling back to `NKOD_DPB` and others.
- **Max upload size:** 500 MB.
- **Data freshness:** LPIS data is updated weekly — always download the latest export.

---

## License

MIT
