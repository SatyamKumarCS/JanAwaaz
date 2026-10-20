import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENUMS } from '../src/enums';

test('committed enums.json matches the zod schemas', () => {
  const committed = JSON.parse(readFileSync(join(__dirname, '..', 'enums.json'), 'utf8'));
  expect(committed).toEqual(ENUMS);
});
