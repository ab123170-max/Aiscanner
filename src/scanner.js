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
 * Automatically fits, crops backgrounds, corrects ratios, and centers the captured product image.
 * Uses pixel analysis and a centered aspect-safe padding/letterbox canvas.
 * @param {string} base64Image Standard raw base64 image data string
 * @returns {Promise<string>} Fitted high-quality base64 image string
 */
export function fitAndCropProductImage(base64Image) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Image;
    img.onload = () => {
      try {
        const w = img.width;
        const h = img.height;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w;
        tempCanvas.height = h;
        const ctx = tempCanvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;

        // Sample background color from corners
        const cornerSampleCount = 4;
        const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
        let bgR = 0, bgG = 0, bgB = 0;
        corners.forEach(([cx, cy]) => {
          const idx = (cy * w + cx) * 4;
          bgR += data[idx];
          bgG += data[idx + 1];
          bgB += data[idx + 2];
        });
        bgR /= cornerSampleCount;
        bgG /= cornerSampleCount;
        bgB /= cornerSampleCount;

        let minX = w, maxX = 0, minY = h, maxY = 0;
        // Step with stride 4 for rapid pixel boundary scan
        for (let y = 0; y < h; y += 4) {
          for (let x = 0; x < w; x += 4) {
            const idx = (y * w + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const diff = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);

            if (diff > 40) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        // Handle fallback limits safely
        if (maxX <= minX || maxY <= minY || (maxX - minX) < 15 || (maxY - minY) < 15) {
          minX = 0; maxX = w; minY = 0; maxY = h;
        } else {
          // Add standard 6% safe margins to ensure text & labels remain readable
          const marginX = Math.floor((maxX - minX) * 0.06);
          const marginY = Math.floor((maxY - minY) * 0.06);
          minX = Math.max(0, minX - marginX);
          maxX = Math.min(w, maxX + marginX);
          minY = Math.max(0, minY - marginY);
          maxY = Math.min(h, maxY + marginY);
        }

        const cropW = maxX - minX;
        const cropH = maxY - minY;

        // Build premium centered square fit to protect original proportions without distortion
        const targetSide = 750;
        const fitCanvas = document.createElement('canvas');
        fitCanvas.width = targetSide;
        fitCanvas.height = targetSide;
        const fitCtx = fitCanvas.getContext('2d');

        // Dark slate neutral backdrop padding
        fitCtx.fillStyle = '#0f0f11';
        fitCtx.fillRect(0, 0, targetSide, targetSide);

        const ratioScale = Math.min(targetSide / cropW, targetSide / cropH);
        const finalDrawW = cropW * ratioScale;
        const finalDrawH = cropH * ratioScale;
        const drawX = (targetSide - finalDrawW) / 2;
        const drawY = (targetSide - finalDrawH) / 2;

        fitCtx.drawImage(img, minX, minY, cropW, cropH, drawX, drawY, finalDrawW, finalDrawH);
        resolve(fitCanvas.toDataURL('image/jpeg', 0.88));
      } catch (err) {
        console.warn("Auto fit exception, fallback to raw source:", err);
        resolve(base64Image);
      }
    };
    img.onerror = () => resolve(base64Image);
  });
}

/**
 * Analyzes the captured base64 image for quality issues (darkness, blur, glare).
 * @param {string} base64Image The image to check
 * @returns {Promise<Object>} Quality result: { passes: boolean, reasons: string[], averageBrightness: number, blurScore: number }
 */
export function analyzeImageQuality(base64Image) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Image;
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        // Small canvas size for rapid synchronous scanning without lag
        canvas.width = 120;
        canvas.height = 90;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 120, 90);
        
        const imgData = ctx.getImageData(0, 0, 120, 90);
        const data = imgData.data;
        
        let totalBrightness = 0;
        let glareCount = 0;
        let edgeSum = 0;
        
        for (let y = 1; y < 89; y++) {
          for (let x = 1; x < 119; x++) {
            const idx = (y * 120 + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            
            const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
            totalBrightness += brightness;
            
            if (r > 242 && g > 242 && b > 242) {
              glareCount++;
            }
            
            // Edge gradient checking
            const idxRight = (y * 120 + (x + 1)) * 4;
            const rRight = data[idxRight];
            const gRight = data[idxRight + 1];
            const bRight = data[idxRight + 2];
            const brightnessRight = 0.299 * rRight + 0.587 * gRight + 0.114 * bRight;
            
            edgeSum += Math.abs(brightness - brightnessRight);
          }
        }
        
        const pixelCount = 120 * 90;
        const averageBrightness = totalBrightness / pixelCount;
        const blurScore = edgeSum / pixelCount;
        const glarePercent = (glareCount / pixelCount) * 100;
        
        const reasons = [];
        let passes = true;
        
        // Quality checks
        if (averageBrightness < 45) {
          passes = false;
          reasons.push("Dark Workspace");
        }
        
        if (blurScore < 6.5) {
          passes = false;
          reasons.push("Out of Focus / Blur");
        }
        
        if (glarePercent > 12.0) {
          passes = false;
          reasons.push("Excessive Lens Glare");
        }
        
        resolve({
          passes,
          reasons,
          averageBrightness: Math.round(averageBrightness),
          blurScore: Math.round(blurScore * 10) / 10,
          glarePercent: Math.round(glarePercent)
        });
      } catch (err) {
        console.error("Quality check calculation error:", err);
        resolve({ passes: true, reasons: [] });
      }
    };
    img.onerror = () => {
      resolve({ passes: true, reasons: [] });
    };
  });
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
