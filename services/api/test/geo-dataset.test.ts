// I-03a: dataset reading and validation (no database). Fixtures are fake; see support/geo-fixture.ts.
import { parseCsv } from '../src/geo/csv';
import { DatasetError, readDataset } from '../src/geo/dataset';
import { fixtureReasons } from '../src/geo/guard';
import { cleanupDatasets, fakeFiles, type Files, withManifest, without, writeDataset } from './support/geo-fixture';

afterEach(cleanupDatasets);

function errorsFor(files: Files): string[] {
  try {
    readDataset(writeDataset(files), { today: '2026-10-21' });
  } catch (err) {
    if (err instanceof DatasetError) return err.errors;
    throw err;
  }
  return [];
}
const replace = (files: Files, name: string, from: string, to: string): Files => {
  expect(files[name]).toContain(from);
  return { ...files, [name]: files[name]!.replace(from, to) };
};

describe('csv parser', () => {
  test('quotes, embedded commas/quotes/newlines, BOM, CRLF and line numbers', () => {
    const t = parseCsv('﻿a,b\r\n1,"x, ""y"""\r\n2,"multi\nline"\n\n3,\n');
    expect(t.header).toEqual(['a', 'b']);
    expect(t.rows).toEqual([
      { line: 2, values: ['1', 'x, "y"'] },
      { line: 3, values: ['2', 'multi\nline'] },
      { line: 6, values: ['3', ''] },
    ]);
  });

  test('unterminated quote is an error', () => {
    expect(() => parseCsv('a\n"oops\n')).toThrow(/unterminated/);
  });
});

describe('valid fixture', () => {
  test('reads with every file and relation', () => {
    const ds = readDataset(writeDataset(fakeFiles()), { today: '2026-10-21' });
    expect(ds.districts).toHaveLength(5);
    expect(ds.villages).toHaveLength(20);
    expect(ds.wards).toHaveLength(15);
    expect(ds.wards.filter((w) => w.zone === null)).toHaveLength(13);
  });

  test('only districts, blocks and villages are required', () => {
    let f = fakeFiles();
    for (const n of ['gram_panchayats.csv', 'village_gp_map.csv', 'village_ulb_map.csv', 'zones.csv', 'wards.csv', 'ulbs.csv', 'village_coords.csv']) {
      f = without(f, n);
    }
    expect(errorsFor(f)).toEqual([]);
  });
});

describe('source metadata', () => {
  test('missing manifest', () => {
    expect(errorsFor(without(fakeFiles(), 'manifest.json', true))).toEqual([expect.stringMatching(/manifest\.json: missing/)]);
  });

  test('a CSV without a manifest entry is rejected', () => {
    const f = withManifest(fakeFiles(), (m) => delete m.files['blocks.csv']);
    expect(errorsFor(f)).toContain('manifest.json: no source metadata for blocks.csv');
  });

  test('each of source, source_url, as_of and licence is required', () => {
    const f = withManifest(fakeFiles(), (m) => {
      m.files['villages.csv'] = { source: '', source_url: 'http://insecure.invalid', as_of: '2026-02-30' };
    });
    const e = errorsFor(f);
    expect(e).toEqual(
      expect.arrayContaining([
        'manifest.json: villages.csv.source is required',
        'manifest.json: villages.csv.licence is required',
        'manifest.json: villages.csv.source_url must be https',
        'manifest.json: villages.csv.as_of must be a real past date YYYY-MM-DD',
      ]),
    );
  });

  test('a future as_of is rejected', () => {
    const f = withManifest(fakeFiles(), (m) => {
      (m.files['wards.csv'] as { as_of: string }).as_of = '2027-01-01';
    });
    expect(errorsFor(f)).toContain('manifest.json: wards.csv.as_of must be a real past date YYYY-MM-DD');
  });

  test('metadata for a missing file is rejected', () => {
    expect(errorsFor(without(fakeFiles(), 'zones.csv', true))).toContain('manifest.json: metadata for zones.csv, but the file is missing');
  });

  test('coordinates need the CC BY-NC-SA 4.0 licence (licence gate)', () => {
    const f = withManifest(fakeFiles(), (m) => {
      (m.files['village_coords.csv'] as { licence: string }).licence = 'CC BY 4.0';
    });
    expect(errorsFor(f)).toEqual([expect.stringMatching(/village_coords\.csv\.licence must be "CC BY-NC-SA 4\.0"/)]);
  });
});

describe('district coverage', () => {
  test('a missing pilot district is rejected', () => {
    const f = replace(fakeFiles(), 'districts.csv', '99990004,Agra,\n', '');
    const e = errorsFor(f);
    expect(e).toContain('districts.csv: missing pilot district(s): Agra');
  });

  test('a district outside the pilot is rejected', () => {
    const f = replace(fakeFiles(), 'districts.csv', '99990004,Agra,', '99990004,TEST District,');
    const e = errorsFor(f);
    expect(e).toEqual(expect.arrayContaining([expect.stringMatching(/districts\.csv:5: "TEST District" is not one of the pilot districts/)]));
  });

  test('names match case- and space-insensitively but not duplicates', () => {
    let f = replace(fakeFiles(), 'districts.csv', ',Kanpur Nagar,', ',  kanpur   nagar ,');
    expect(errorsFor(f)).toEqual([]);
    f = replace(fakeFiles(), 'districts.csv', '99990004,Agra,', '99990004,Lucknow,');
    expect(errorsFor(f)).toEqual(expect.arrayContaining([expect.stringMatching(/duplicate district name "lucknow"/)]));
  });
});

describe('parents and uniqueness', () => {
  test('a village whose block is missing', () => {
    const f = replace(fakeFiles(), 'villages.csv', '99992111,99990001,99991101,', '99992111,99990001,99991109,');
    expect(errorsFor(f)).toContain('villages.csv:2: block_lgd_code "99991109" not in blocks.csv');
  });

  test('a village whose block is in another district', () => {
    const f = replace(fakeFiles(), 'villages.csv', '99992111,99990001,99991101,', '99992111,99990001,99991201,');
    expect(errorsFor(f)).toContain('villages.csv:2: block "99991201" belongs to district "99990002", not "99990001"');
  });

  test('a block whose district is missing', () => {
    const f = replace(fakeFiles(), 'blocks.csv', '99991101,99990001,', '99991101,99990009,');
    expect(errorsFor(f)).toEqual(expect.arrayContaining(['blocks.csv:2: district_lgd_code "99990009" not in districts.csv']));
  });

  test('GP map, ULB map, wards and zones reference existing parents', () => {
    let f = replace(fakeFiles(), 'village_gp_map.csv', '99992111,99993111,', '99992111,99993119,');
    f = replace(f, 'village_ulb_map.csv', '99992111,99994101,', '99992111,99994109,');
    f = replace(f, 'wards.csv', '99995101,99994101,', '99995101,99994109,');
    expect(errorsFor(f)).toEqual(
      expect.arrayContaining([
        'village_gp_map.csv:2: gp_lgd_code "99993119" not in gram_panchayats.csv',
        'village_ulb_map.csv:2: ulb_lgd_code "99994109" not in ulbs.csv',
        'wards.csv:2: ulb_lgd_code "99994109" not in ulbs.csv',
      ]),
    );
  });

  test('a ward cannot use another city’s zone, and zone keys must exist', () => {
    let f = replace(fakeFiles(), 'wards.csv', '99995201,99994201,TEST Ward 2-1,,', '99995201,99994201,TEST Ward 2-1,,Z1');
    f = replace(f, 'wards.csv', '99995301,99994301,TEST Ward 3-1,,', '99995301,99994301,TEST Ward 3-1,,Z9');
    expect(errorsFor(f)).toEqual(
      expect.arrayContaining([
        'wards.csv:5: zone "Z1" belongs to ULB "99994101", not "99994201"',
        'wards.csv:8: zone_key "Z9" not in zones.csv',
      ]),
    );
  });

  test('wards and zones only for Nagar Nigams; one Nagar Nigam per district', () => {
    let f = replace(fakeFiles(), 'wards.csv', '99995101,99994101,', '99995101,99994102,');
    f = replace(f, 'ulbs.csv', '99994501,99990005,TEST Nagar Nigam 5,,nagar_nigam', '99994501,99990005,TEST Nagar Nigam 5,,nagar_palika_parishad');
    expect(errorsFor(f)).toEqual(
      expect.arrayContaining([
        'wards.csv:2: wards are only loaded for Nagar Nigams; "99994102" is nagar_panchayat',
        'ulbs.csv: district "Kanpur Nagar" must have exactly one nagar_nigam row, found 0',
      ]),
    );
  });

  test('duplicate codes and non-numeric codes', () => {
    let f = replace(fakeFiles(), 'villages.csv', '99992112,', '99992111,');
    f = replace(f, 'blocks.csv', '99991101,', 'B1,');
    const e = errorsFor(f);
    expect(e).toEqual(
      expect.arrayContaining([
        'villages.csv:3: duplicate lgd_code "99992111" (first on line 2)',
        'blocks.csv:2: lgd_code "B1" must be a numeric LGD code',
      ]),
    );
  });

  test('wrong header, wrong field count, unknown file, dependent file missing', () => {
    let f = replace(fakeFiles(), 'gram_panchayats.csv', 'lgd_code,block_lgd_code,name_en,name_hi', 'code,block,name');
    f = replace(f, 'villages.csv', '99992111,99990001,99991101,TEST Village 1-1-1,', '99992111,99990001,99991101,');
    f = { ...f, 'extra.csv': 'x\n1\n' };
    f = without(f, 'ulbs.csv');
    expect(errorsFor(f)).toEqual(
      expect.arrayContaining([
        'gram_panchayats.csv:1: header must be exactly "lgd_code,block_lgd_code,name_en,name_hi"',
        'villages.csv:2: expected 6 fields, found 5',
        expect.stringMatching(/^extra\.csv: unknown file/),
        'wards.csv: requires ulbs.csv',
        'village_ulb_map.csv: requires ulbs.csv',
      ]),
    );
  });
});

describe('fixture guard for the real seed command', () => {
  test('the fake fixture is refused for three independent reasons', () => {
    const dir = writeDataset(fakeFiles());
    const ds = readDataset(dir, { today: '2026-10-21' });
    expect(fixtureReasons(ds, dir)).toEqual([
      'manifest.json marks this dataset as a test fixture',
      expect.stringMatching(/reserved fake LGD code/),
    ]);
    expect(fixtureReasons(ds, '/repo/services/api/test/fixtures/geo')).toContainEqual(expect.stringMatching(/inside a test folder/));
  });

  test('fake codes are refused even when the fixture flag is removed', () => {
    const dir = writeDataset(withManifest(fakeFiles(), (m) => delete m.fixture));
    const ds = readDataset(dir, { today: '2026-10-21' });
    expect(fixtureReasons(ds, dir)).toEqual([expect.stringMatching(/reserved fake LGD code/)]);
  });
});
