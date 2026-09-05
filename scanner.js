/**
 * Scanner module for accessing the device camera and capturing high-quality frames.
 */

let activeStream = null;
let currentFacingMode = 'environment'; // default to rear camera

/**
 * Request camera access and start live video stream.
 * @param {HTMLVideoElement} videoElement The video tag to bind the stream to
 * @returns {Promise<MediaStream>} The active media stream
 */
export async function startCamera(videoElement) {
  // Stop any active streams first
  stopCamera();

  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: currentFacingMode },
      width: { ideal: 1920 }, // Prefer full HD for clear barcode & text recognition
      height: { ideal: 1080 }
    }
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    activeStream = stream;
    videoElement.srcObject = stream;
    // Set play attribute to handle iOS webview constraints
    videoElement.setAttribute('playsinline', true);
    videoElement.setAttribute('muted', true);
    await videoElement.play();
    return stream;
  } catch (error) {
    console.error('Camera startup failed:', error);
    
    // Fallback if environment (rear) camera is unavailable or blocks
    if (currentFacingMode === 'environment') {
      console.log('Environment camera failed, retrying with generic user/default constraints.');
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: true
        });
        activeStream = fallbackStream;
        videoElement.srcObject = fallbackStream;
        await videoElement.play();
        return fallbackStream;
      } catch (fallbackError) {
        throw handleCameraError(fallbackError);
      }
    }
    
    throw handleCameraError(error);
  }
}

/**
 * Toggle between front and rear cameras
 * @param {HTMLVideoElement} videoElement The video element to rebind
 * @returns {Promise<MediaStream>} The updated camera stream
 */
export async function toggleCamera(videoElement) {
  currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
  return startCamera(videoElement);
}

/**
 * Stops the camera video streams cleanly.
 */
export function stopCamera() {
  if (activeStream) {
    activeStream.getTracks().forEach(track => {
      track.stop();
    });
    activeStream = null;
    console.log('Camera stream stopped.');
  }
}

/**
 * Captures a single frame from the live video, crops it to the target scanning area,
 * resizes/compresses it, and returns a high-quality base64 image data URL.
 * 
 * @param {HTMLVideoElement} video The live video element
 * @param {HTMLElement} scanAreaElem The scanner overlay element for relative bounding cropping
 * @returns {string} Base64 encoded JPEG data URL
 */
export function captureFrame(video, scanAreaElem) {
  if (!video || !video.srcObject) {
    throw new Error("No active video feed to capture from");
  }

  // Create a canvas with the video source dimensions
  const captureCanvas = document.createElement('canvas');
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  captureCanvas.width = videoWidth;
  captureCanvas.height = videoHeight;

  const ctx = captureCanvas.getContext('2d');
  ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

  // If scanAreaElem is provided, crop the canvas to represent just the scan area
  // This drastically increases barcode recognition rates and speeds up AI vision analysis.
  let finalCanvas = captureCanvas;
  
  if (scanAreaElem) {
    const videoRect = video.getBoundingClientRect();
    const areaRect = scanAreaElem.getBoundingClientRect();

    // Calculate relative percentages of scan area inside the video container
    const relativeLeft = (areaRect.left - videoRect.left) / videoRect.width;
    const relativeTop = (areaRect.top - videoRect.top) / videoRect.height;
    const relativeWidth = areaRect.width / videoRect.width;
    const relativeHeight = areaRect.height / videoRect.height;

    // Map these relative coordinates to actual native video pixel coordinates
    const sourceX = Math.max(0, Math.floor(relativeLeft * videoWidth));
    const sourceY = Math.max(0, Math.floor(relativeTop * videoHeight));
    const sourceWidth = Math.min(videoWidth - sourceX, Math.floor(relativeWidth * videoWidth));
    const sourceHeight = Math.min(videoHeight - sourceY, Math.floor(relativeHeight * videoHeight));

    // Crop it to a new canvas
    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = sourceWidth;
    croppedCanvas.height = sourceHeight;
    const croppedCtx = croppedCanvas.getContext('2d');
    croppedCtx.drawImage(captureCanvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
    finalCanvas = croppedCanvas;
  }

  // Optimize, compress and resize image for Gemini AI (ideal size around 800-1024px wide)
  // This maintains enough resolution for text reading but saves massive amounts of bandwidth.
  const optimizedCanvas = document.createElement('canvas');
  const MAX_WIDTH = 1024;
  let targetWidth = finalCanvas.width;
  let targetHeight = finalCanvas.height;

  if (targetWidth > MAX_WIDTH) {
    const ratio = MAX_WIDTH / targetWidth;
    targetWidth = MAX_WIDTH;
    targetHeight = targetHeight * ratio;
  }

  optimizedCanvas.width = targetWidth;
  optimizedCanvas.height = targetHeight;

  const optimizedCtx = optimizedCanvas.getContext('2d');
  optimizedCtx.drawImage(finalCanvas, 0, 0, targetWidth, targetHeight);

  // Compress to medium-high quality JPEG
  return optimizedCanvas.toDataURL('image/jpeg', 0.85);
}

/**
 * Handles camera access permission and availability errors.
 * @param {Error} error The standard browser error thrown by getUserMedia
 * @returns {Error} Custom simplified error message for user UI display
 */
function handleCameraError(error) {
  let friendlyMsg = 'An unexpected camera error occurred.';
  
  if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
    friendlyMsg = 'Camera permission denied. Please allow camera access in your browser settings to scan products.';
  } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
    friendlyMsg = 'No camera found on this device. Please use a device with a working camera.';
  } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
    friendlyMsg = 'Camera is already in use by another application. Please close other camera apps and retry.';
  } else if (error.name === 'OverconstrainedError') {
    friendlyMsg = 'Requested camera resolution constraints cannot be satisfied by this device.';
  }

  return new Error(friendlyMsg);
}
