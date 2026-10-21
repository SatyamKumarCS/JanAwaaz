// The real seed command must never load test fixtures (I-03a). Fixtures are recognisable three ways:
// the manifest says `"fixture": true`, they use reserved fake codes, or they live under a test folder.
import { sep } from 'node:path';
import { allCodes, type Dataset, RESERVED_FAKE_CODE } from './dataset';

export function fixtureReasons(ds: Dataset, dir: string): string[] {
  const reasons: string[] = [];
  if (ds.manifest.fixture === true) reasons.push('manifest.json marks this dataset as a test fixture');
  const fake = allCodes(ds).filter((c) => RESERVED_FAKE_CODE.test(c));
  if (fake.length) reasons.push(`${fake.length} reserved fake LGD code(s), e.g. ${fake[0]}`);
  const parts = dir.split(sep);
  if (parts.includes('test') || parts.includes('test-db') || parts.includes('fixtures')) {
    reasons.push(`dataset path is inside a test folder (${dir})`);
  }
  return reasons;
}
