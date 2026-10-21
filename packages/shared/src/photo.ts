// Photo upload contract shared by the API and the mobile app (FR-1.2 "<500 KB", I-09/I-12).
// The API rejects larger uploads; the app's compression loop must get every photo to at most this size.
export const PHOTO_MAX_BYTES = 512_000;
