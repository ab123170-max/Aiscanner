/**
 * Barcode Scanner module.
 * Leverages native browser Barcode Detection API when available,
 * and falls back to ZXing BrowserMultiFormatReader.
 */

let nativeDetector = null;
let zxingReader = null;

/**
 * Initializes the barcode detectors.
 */
export async function initBarcodeDetectors() {
  // Check if native Barcode Detection API is supported
  if ('BarcodeDetector' in window) {
    try {
      const supportedFormats = await BarcodeDetector.getSupportedFormats();
      if (supportedFormats && supportedFormats.length > 0) {
        // Native detector supported!
        nativeDetector = new BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code']
        });
        console.log('Native Barcode & QR Detector initialized.');
        return;
      }
    } catch (e) {
      console.warn('Native BarcodeDetector support check failed, using fallback.');
    }
  }

  // Use ZXing as fallback
  try {
    if (window.ZXing) {
      zxingReader = new window.ZXing.BrowserMultiFormatReader();
      console.log('ZXing Barcode Fallback initialized.');
    } else {
      console.warn('ZXing library not loaded in window. Trying to lazy load or wait for script.');
    }
  } catch (e) {
    console.error('Failed to initialize ZXing fallback reader:', e);
  }
}

/**
 * Detects a barcode from an active video element or a canvas.
 * @param {HTMLVideoElement|HTMLCanvasElement} element The media source
 * @returns {Promise<Object|null>} Returns { format: string, value: string } or null
 */
export async function detectBarcode(element) {
  if (!nativeDetector && !zxingReader) {
    await initBarcodeDetectors();
  }

  // 1. Try Native Barcode Detector
  if (nativeDetector) {
    try {
      const barcodes = await nativeDetector.detect(element);
      if (barcodes && barcodes.length > 0) {
        const detection = barcodes[0];
        console.log('Barcode detected natively:', detection.rawValue);
        return {
          format: detection.format.toUpperCase(),
          value: detection.rawValue
        };
      }
    } catch (error) {
      // Don't crash, let it fallback
      console.warn('Native barcode detection failed, falling back:', error);
    }
  }

  // 2. Try ZXing Browser Fallback
  if (zxingReader) {
    try {
      let result = null;
      if (element instanceof HTMLVideoElement) {
        result = await zxingReader.decodeFromVideoElement(element);
      } else if (element instanceof HTMLCanvasElement) {
        result = await zxingReader.decodeFromCanvas(element);
      }

      if (result) {
        console.log('Barcode detected via ZXing fallback:', result.text);
        return {
          format: result.barcodeFormat ? result.barcodeFormat.toString() : 'UNKNOWN',
          value: result.text
        };
      }
    } catch (error) {
      // ZXing throws an exception when no barcode is found in the current frame,
      // which is expected during live video scanning. So we ignore errors quietly.
    }
  }

  return null;
}
