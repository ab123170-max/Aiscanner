import * as THREE from 'three';

/**
 * Creates a beautiful programmatically generated "NOT CAPTURED" matte texture
 * with carbon-look background and watermark text.
 */
function createNotCapturedTexture(label) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Background - Dark metallic grid
  ctx.fillStyle = '#16191E';
  ctx.fillRect(0, 0, 512, 512);

  // Diagonal warning lines
  ctx.strokeStyle = '#2A2D35';
  ctx.lineWidth = 8;
  for (let i = -512; i < 512; i += 40) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 512, 512);
    ctx.stroke();
  }

  // Border
  ctx.strokeStyle = '#FF4444';
  ctx.lineWidth = 16;
  ctx.strokeRect(0, 0, 512, 512);

  // Warning text
  ctx.fillStyle = '#6B7280';
  ctx.font = 'bold 24px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ESTIMATED GEOMETRY', 256, 180);

  ctx.fillStyle = '#FF4444';
  ctx.font = 'bold 36px monospace';
  ctx.fillText('NOT CAPTURED', 256, 256);

  ctx.fillStyle = '#6B7280';
  ctx.font = '18px monospace';
  ctx.fillText(label.toUpperCase(), 256, 320);

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

/**
 * Loads a base64 image string into a THREE.Texture.
 */
function loadBase64Texture(base64Data) {
  const texture = new THREE.Texture();
  const img = new Image();
  img.referrerPolicy = 'no-referrer';
  img.onload = () => {
    texture.image = img;
    texture.needsUpdate = true;
  };
  img.src = base64Data;
  return texture;
}

/**
 * Builds and renders the interactive 3D model in the target container.
 * @param {HTMLElement} container - Target container div
 * @param {Array} capturedImages - Array of up to 6 captured image objects { data, label }
 * @param {string} category - Product category
 * @returns {Object} Control methods (reset, toggleAutoRotate, zoomIn, zoomOut, destroy)
 */
export function createProduct3DModel(container, capturedImages, category) {
  // Clear any existing contents
  container.innerHTML = '';

  const width = container.clientWidth || 300;
  const height = container.clientHeight || 300;

  // 1. Setup Scene, Camera, Renderer
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0A0B0D');

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(0, 0, 4.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // 2. Add Lighting
  const ambientLight = new THREE.AmbientLight('#ffffff', 0.8);
  scene.add(ambientLight);

  const dirLight1 = new THREE.DirectionalLight('#ffffff', 0.6);
  dirLight1.position.set(5, 5, 5);
  scene.add(dirLight1);

  const dirLight2 = new THREE.DirectionalLight('#00F0FF', 0.3); // Cyber glow light
  dirLight2.position.set(-5, -5, 5);
  scene.add(dirLight2);

  // 3. Map captured images to indexes
  // slots: 0:FRONT, 1:BACK, 2:SIDE, 3:BARCODE, 4:DATE, 5:EXTRA
  const frontImg = capturedImages[0];
  const backImg = capturedImages[1];
  const sideImg = capturedImages[2];
  const barcodeImg = capturedImages[3];
  const dateImg = capturedImages[4];
  const extraImg = capturedImages[5];

  // 4. Construct geometry based on category
  let geometry;
  let materials = [];
  let productMesh;

  const catLower = (category || '').toLowerCase();
  const isCylinder = catLower.includes('beverage') || catLower.includes('cosmetic') || catLower.includes('can') || catLower.includes('bottle');
  const isFlatPacket = catLower.includes('packet') || catLower.includes('envelope') || catLower.includes('pouch');

  if (isCylinder) {
    // CYLINDER GEOMETRY (e.g. Soda Cans, Cosmetic tubes)
    geometry = new THREE.CylinderGeometry(0.8, 0.8, 2.2, 32);

    // For cylinder, we map textures around: side, top, bottom
    const sideTex = frontImg ? loadBase64Texture(frontImg.data) : createNotCapturedTexture('front / side');
    const topTex = extraImg ? loadBase64Texture(extraImg.data) : createNotCapturedTexture('top');
    const bottomTex = barcodeImg ? loadBase64Texture(barcodeImg.data) : createNotCapturedTexture('bottom');

    materials = [
      new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.3, metalness: 0.1 }),   // Cylinder side
      new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.4, metalness: 0.5 }),    // Cylinder top cap
      new THREE.MeshStandardMaterial({ map: bottomTex, roughness: 0.5, metalness: 0.5 })  // Cylinder bottom cap
    ];
    productMesh = new THREE.Mesh(geometry, materials);
  } else {
    // BOX GEOMETRY (Standard or Flat Packet)
    const w = 1.4;
    const h = 2.0;
    const d = isFlatPacket ? 0.25 : 0.9;
    geometry = new THREE.BoxGeometry(w, h, d);

    // Box has 6 faces: Right, Left, Top, Bottom, Front, Back
    // THREE.BoxGeometry material index mapping:
    // 0: Right (+X), 1: Left (-X), 2: Top (+Y), 3: Bottom (-Y), 4: Front (+Z), 5: Back (-Z)
    
    const rightTex = sideImg ? loadBase64Texture(sideImg.data) : createNotCapturedTexture('right side');
    const leftTex = sideImg ? loadBase64Texture(sideImg.data) : createNotCapturedTexture('left side');
    const topTex = extraImg ? loadBase64Texture(extraImg.data) : createNotCapturedTexture('top');
    const bottomTex = dateImg ? loadBase64Texture(dateImg.data) : createNotCapturedTexture('bottom');
    const frontTex = frontImg ? loadBase64Texture(frontImg.data) : createNotCapturedTexture('front');
    const backTex = backImg ? loadBase64Texture(backImg.data) : createNotCapturedTexture('back');

    materials = [
      new THREE.MeshStandardMaterial({ map: rightTex, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ map: leftTex, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ map: bottomTex, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ map: frontTex, roughness: 0.3 }), // Glossy front
      new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.4 })
    ];
    productMesh = new THREE.Mesh(geometry, materials);
  }

  scene.add(productMesh);

  // 5. Interactive Drag & Touch Rotations
  let isDragging = false;
  let previousMousePosition = { x: 0, y: 0 };
  let autoRotateActive = true;
  let scaleFactor = 1;

  let lastTouchDist = null;

  const onPointerDown = (x, y) => {
    isDragging = true;
    autoRotateActive = false;
    previousMousePosition = { x, y };
  };

  const onPointerMove = (x, y) => {
    if (!isDragging) return;

    const deltaMove = {
      x: x - previousMousePosition.x,
      y: y - previousMousePosition.y
    };

    productMesh.rotation.y += deltaMove.x * 0.008;
    productMesh.rotation.x += deltaMove.y * 0.008;

    // Limit X rotation to avoid flips
    productMesh.rotation.x = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, productMesh.rotation.x));

    previousMousePosition = { x, y };
  };

  const onPointerUp = () => {
    isDragging = false;
  };

  // Mouse listeners
  renderer.domElement.addEventListener('mousedown', (e) => onPointerDown(e.clientX, e.clientY));
  window.addEventListener('mousemove', (e) => onPointerMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', onPointerUp);

  // Touch listeners
  renderer.domElement.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      onPointerDown(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2) {
      // Pinch touch start tracking
      isDragging = false;
      lastTouchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  });

  window.addEventListener('touchmove', (e) => {
    if (isDragging && e.touches.length === 1) {
      onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2 && lastTouchDist) {
      // Pinch touch scaling zoom
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = dist / lastTouchDist;
      lastTouchDist = dist;

      camera.position.z = Math.max(2, Math.min(8, camera.position.z / factor));
    }
  });

  window.addEventListener('touchend', () => {
    isDragging = false;
    lastTouchDist = null;
  });

  // Wheel zoom
  renderer.domElement.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.position.z = Math.max(2, Math.min(8, camera.position.z + e.deltaY * 0.004));
  }, { passive: false });

  // 6. Animation Loop
  let reqId;
  const tick = () => {
    if (autoRotateActive) {
      productMesh.rotation.y += 0.006;
    }
    renderer.render(scene, camera);
    reqId = requestAnimationFrame(tick);
  };
  tick();

  // 7. Resize Observer
  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const w = entry.contentRect.width || container.clientWidth;
      const h = entry.contentRect.height || container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
  });
  resizeObserver.observe(container);

  // Control APIs
  return {
    reset: () => {
      productMesh.rotation.set(0, 0, 0);
      camera.position.set(0, 0, 4.5);
      autoRotateActive = false;
    },
    toggleAutoRotate: (forceState) => {
      autoRotateActive = forceState !== undefined ? forceState : !autoRotateActive;
      return autoRotateActive;
    },
    zoomIn: () => {
      camera.position.z = Math.max(2, camera.position.z - 0.5);
    },
    zoomOut: () => {
      camera.position.z = Math.min(8, camera.position.z + 0.5);
    },
    destroy: () => {
      cancelAnimationFrame(reqId);
      resizeObserver.disconnect();
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);
      materials.forEach(mat => {
        if (mat.map) mat.map.dispose();
        mat.dispose();
      });
      geometry.dispose();
      renderer.dispose();
    }
  };
}
