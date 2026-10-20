import { createApp } from './app';

const port = Number(process.env.API_PORT ?? 4000);
// Bind to loopback only; devices reach it via `adb reverse` (D-18).
createApp().listen(port, '127.0.0.1', () => {
  console.log(`api listening on http://127.0.0.1:${port}`);
});
