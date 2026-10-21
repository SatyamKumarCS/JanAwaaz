# Geography dataset format (I-03)

The geography seed loads one **dataset directory**: a `manifest.json` plus CSV files. The real data
comes from the official sources chosen in D-06. It is converted into this format in I-03b and is not
committed yet. The loader is `services/api/src/geo/`. Run it with:

```sh
pnpm db:seed:geo <dataset-dir> [--report seed-report.json]
```

The command runs against the **local** database only, and validates everything before it writes
anything. It loads in one transaction, so if a check fails, nothing is written. It refuses test
fixtures.

## manifest.json

```json
{
  "dataset": "lgd-up-pilot-districts",
  "files": {
    "districts.csv": {
      "source": "LGD: <report name>",
      "source_url": "https://lgdirectory.gov.in/...",
      "as_of": "YYYY-MM-DD",
      "licence": "GODL-India"
    }
  }
}
```

- **Metadata for every file:** each CSV in the directory needs an entry with `source`, `source_url`
  (https), `as_of` (a real date, not in the future) and `licence`. A CSV with no entry fails the
  load, and so does an entry with no CSV.
- **Coordinates licence gate (D-06 Q4):** the licence for `village_coords.csv` must be exactly
  `CC BY-NC-SA 4.0`.
- **Fixture flag:** `"fixture": true` marks test data. The real seed command refuses it.

## Files

- **Encoding:** UTF-8, comma-separated, with an optional BOM. Quoted fields follow RFC 4180.
- **Header:** the first line must be exactly the header shown.
- **Empty values:** an empty `name_hi`, `pc11_code` or `zone_key` means null.
- **LGD codes:** numeric strings, kept as text. They are the stable identity of every row.

| File | Header | Required | Notes |
|---|---|---|---|
| `districts.csv` | `lgd_code,name_en,name_hi` | yes | Exactly the 5 pilot districts: Gorakhpur, Varanasi, Lucknow, Agra, Kanpur Nagar. Matched by English name. |
| `blocks.csv` | `lgd_code,district_lgd_code,name_en,name_hi` | yes | |
| `villages.csv` | `lgd_code,district_lgd_code,block_lgd_code,name_en,name_hi,pc11_code` | yes | One block per village (schema). The block must be in the same district. `area_type` is always `rural` (D-06 Q2). |
| `gram_panchayats.csv` | `lgd_code,block_lgd_code,name_en,name_hi` | with the map | |
| `village_gp_map.csv` | `village_lgd_code,gp_lgd_code,is_full` | with the GPs | `is_full` is `true` or `false` (D-05 Q1). |
| `ulbs.csv` | `lgd_code,district_lgd_code,name_en,name_hi,kind` | no | `kind` is `nagar_nigam`, `nagar_palika_parishad` or `nagar_panchayat`. Each district needs exactly one `nagar_nigam` row. Only Nagar Nigams are `supported` (D-06 Q3b). |
| `village_ulb_map.csv` | `village_lgd_code,ulb_lgd_code,merge_extent` | no | Comes from LGD "Urban villages mapped with urban local bodies". `merge_extent` is `full` or `partial`. One ULB per village. |
| `zones.csv` | `zone_key,ulb_lgd_code,name_en,name_hi,source_url,as_of` | no | Official Nagar Nigam sources only (D-06 Q6). `zone_key` is local to the dataset. |
| `wards.csv` | `lgd_code,ulb_lgd_code,name_en,name_hi,zone_key` | no | Nagar Nigams only. An empty `zone_key` means no verified zone. A ward's `as_of` comes from the manifest. |
| `village_coords.csv` | `pc11_code,lat,lng` | no | SHRUG / Census 2011 centroids, joined to villages by `pc11_code`. Matched villages get `coord_source = shrug_pc11`. |

## Rerun behaviour

- **Upserts:** every row is upserted by LGD code, so a renamed ward or village keeps its row. Zones
  have no LGD code; they are matched by ULB plus English name, case-insensitively.
- **Recomputed fields:** coordinates, merged-ULB links, village↔GP links and ward zones are
  recomputed from the dataset on every run. If one is missing from the dataset, it is cleared.
- **Nothing is deleted:** database rows the dataset no longer lists are counted under
  `not_in_dataset` in the report. Complaints may still reference them.
- **District check:** after loading, the database must hold exactly 5 districts. If not, the whole
  load is rolled back.

## Seed report

The report is JSON. It records each file's sources and dates, and per-district counts of blocks,
villages, villages missing a Hindi name, villages with and without coordinates, merged villages
(full and partial), gram panchayats, and ULBs by kind. For each Nagar Nigam it records wards, wards
with a zone, the ward codes **without** a verified zone, and the number of zones. It also has
coordinate match counts and the `not_in_dataset` counts.

## Decisions this format defers

- **Split blocks:** a village LGD maps to more than one block. The I-03b converter must choose one
  block per village. That rule is decided when the real LGD data shows how common splits are.
- **Zone identity:** zones are matched by name until the schema has a stable zone key.
