/**
 * Reels — which picked phone videos we accept, and the words for picker errors.
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reelVideoType, pickerErrorText, UNSUPPORTED_VIDEO_MESSAGE } from '../videoType.ts';

const v = (o) => ({ uri: 'file:///x', ...o });

test('takes the videos phones actually record or pick', () => {
  const cases = [
    // iPhone (camera + gallery). The picker hands back an H.264 copy of HEVC clips.
    [{ mimeType: 'video/quicktime', fileName: 'IMG_0412.MOV' }, 'video/quicktime'],
    [{ mimeType: null, fileName: 'IMG_0412.MOV' }, 'video/quicktime'],
    [{ mimeType: 'video/mp4', fileName: 'IMG_0412.mp4' }, 'video/mp4'],
    [{ mimeType: 'video/mov' }, 'video/quicktime'],
    // Android
    [{ mimeType: 'video/mp4', fileName: 'VID_20261128_101500.mp4' }, 'video/mp4'],
    [{ mimeType: 'video/3gpp', fileName: 'VID_0001.3gp' }, 'video/3gpp'],
    [{ mimeType: 'audio/3gpp' }, 'video/3gpp'],
    [{ mimeType: 'video/3gpp2' }, 'video/3gpp2'],
    [{ mimeType: '', fileName: 'clip.3g2' }, 'video/3gpp2'],
    [{ mimeType: 'video/x-m4v', fileName: 'a.m4v' }, 'video/x-m4v'],
    [{ mimeType: 'video/mp4; codecs="avc1"' }, 'video/mp4'],
    // Generic labels: go by the name.
    [{ mimeType: 'application/octet-stream', fileName: 'a.MP4' }, 'video/mp4'],
    [{ mimeType: 'video/*', uri: 'file:///cache/ImagePicker/abc.mov' }, 'video/quicktime'],
    [{ mimeType: undefined, uri: 'file:///cache/abc.mp4?x=1' }, 'video/mp4'],
    // No label and no extension (Android content:// picks): try MP4, server checks the bytes.
    [{ mimeType: null, fileName: null, uri: 'content://media/external/video/media/1234' }, 'video/mp4'],
    [{ mimeType: 'application/octet-stream', uri: 'content://media/external/video/media/1234' }, 'video/mp4'],
  ];
  for (const [input, want] of cases) assert.equal(reelVideoType(v(input)), want, JSON.stringify(input));
});

test('refuses formats iPhones (or Android) cannot play', () => {
  const cases = [
    { mimeType: 'video/webm', fileName: 'screen.webm' },
    { mimeType: null, fileName: 'screen.webm' },
    { mimeType: 'video/x-matroska', fileName: 'a.mkv' },
    { mimeType: '', fileName: 'a.mkv' },
    { mimeType: 'video/x-msvideo', fileName: 'a.avi' },
    { mimeType: 'video/avi' },
    { mimeType: 'image/jpeg', fileName: 'a.jpg' },
    { mimeType: 'application/octet-stream', fileName: 'a.avi' },
  ];
  for (const input of cases) assert.equal(reelVideoType(v(input)), null, JSON.stringify(input));
});

test('picker errors become plain words, never raw native text or an empty alert', () => {
  assert.equal(pickerErrorText(new Error('Failed to export the video')), UNSUPPORTED_VIDEO_MESSAGE);
  assert.match(pickerErrorText(new Error('Missing camera roll permission')), /allow Autobacs/);
  assert.match(pickerErrorText(new Error('ERR_SOMETHING_NATIVE 0x1f')), /couldn't open that video/);
  for (const e of [undefined, null, {}, 'boom', 42]) assert.ok(pickerErrorText(e).length > 10);
});
