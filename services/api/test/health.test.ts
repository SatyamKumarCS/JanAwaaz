import request from 'supertest';
import { createApp } from '../src/app';

test('GET /health returns 200', async () => {
  const res = await request(createApp()).get('/health');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ status: 'ok', service: 'api', statuses: 8 });
});
