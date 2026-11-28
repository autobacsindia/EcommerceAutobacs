/**
 * Show a downloaded PDF.
 *   Android  hand it to the phone's PDF viewer (VIEW intent on a content:// uri,
 *            read permission granted just for that app); no viewer → share sheet
 *   iOS      the share sheet opens Quick Look, which previews the PDF
 *   web      not supported (preview surface only)
 */
import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { getContentUriAsync } from 'expo-file-system/legacy';

const FLAG_GRANT_READ_URI_PERMISSION = 1;

export async function openPdf(uri: string, title: string): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      const data = await getContentUriAsync(uri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data,
        type: 'application/pdf',
        flags: FLAG_GRANT_READ_URI_PERMISSION,
      });
      return;
    } catch {
      // No PDF app installed: fall back to "open with / share".
    }
  }
  if (Platform.OS !== 'web' && (await Sharing.isAvailableAsync())) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: title });
  }
}
