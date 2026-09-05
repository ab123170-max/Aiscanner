/**
 * AI Product Scanner App Controller
 * Orchestrates views, camera scanner, barcode reader, product lookup and local storage history.
 */

import { startCamera, stopCamera, captureFrame, toggleCamera } from './scanner.js';
import { initBarcodeDetectors, detectBarcode } from './barcode.js';
import { analyzeProductImage } from './ai.js';
import { lookupProductByBarcode, mergeProductData } from './product-api.js';
import { 
  getProducts, 
  saveProduct, 
  updateProduct, 
  deleteProduct, 
  searchProducts, 
  getExpiringSoonProducts, 
  getExpiredProducts 
} from './storage.js';

class App {
  constructor() {
    this.currentView = 'dashboard';
    this.currentFilter = 'all';
    
    // Scan states
    this.activeBarcode = null;
    this.activeBarcodeFormat = null;
    this.capturedImageBase64 = null;
    this.isScanningActive = false;
    this.detectionInterval = null;
    
    // Modal state
    this.editingProductId = null;
    this.activeViewingProduct = null;

    // Elements
    this.initElements();
    this.initEventListeners();
    
    // Startup
    this.initApp();
  }

  initElements() {
    this.views = {
      dashboard: document.getElementById('view-dashboard'),
      scanner: document.getElementById('view-scanner'),
      verify: document.getElementById('view-verify')
    };

    // Video, Canvas overlays
    this.videoElem = document.getElementById('scanner-video');
    this.scanAreaElem = document.getElementById('scan-target-area');
    this.barcodeStatusText = document.getElementById('barcode-status-text');
    this.barcodeIndicator = document.getElementById('barcode-indicator');
    this.barcodeIndicatorRing = document.getElementById('barcode-indicator-ring');
    this.barcodeResultBadge = document.getElementById('barcode-result-badge');

    // Verification preview and form elements
    this.verifyPreviewImg = document.getElementById('verify-preview-img');
    this.verifyForm = document.getElementById('verify-form');
    this.aiConfidencePanel = document.getElementById('ai-confidence-panel');
    this.aiConfidenceValue = document.getElementById('ai-confidence-value');
    this.aiConfidenceBar = document.getElementById('ai-confidence-bar');
    this.aiConfidenceWarning = document.getElementById('ai-confidence-warning');

    // Loading overlay
    this.loadingBackdrop = document.getElementById('loading-backdrop');
    this.loadingTitle = document.getElementById('loading-title');
    this.loadingDesc = document.getElementById('loading-desc');

    // History grid and stats
    this.historyGrid = document.getElementById('history-grid');
    this.emptyState = document.getElementById('empty-state');
    this.statTotal = document.getElementById('stat-total');
    this.statExpiring = document.getElementById('stat-expiring');
    this.statExpired = document.getElementById('stat-expired');
    this.searchInput = document.getElementById('search-input');

    // Detail Modal Elements
    this.detailModal = document.getElementById('product-detail-modal');
    this.modalContent = document.getElementById('modal-content');
    this.modalBtnDelete = document.getElementById('modal-btn-delete');
    this.modalBtnEdit = document.getElementById('modal-btn-edit');
  }

  initEventListeners() {
    // Esc key closes modal
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeModal();
      }
    });

    // Close modal on clicking backdrop
    this.detailModal.addEventListener('click', (e) => {
      if (e.target === this.detailModal) {
        this.closeModal();
      }
    });
  }

  async initApp() {
    try {
      // Setup icons
      lucide.createIcons();
      
      // Load products list
      this.refreshDashboard();

      // Lazy load barcode reader
      await initBarcodeDetectors();
    } catch (e) {
      console.warn('App initialization warning:', e);
    }
  }

  // ==============================================
  // VIEW ROUTING & TRANSITIONS
  // ==============================================
  switchView(targetView) {
    Object.keys(this.views).forEach(viewName => {
      if (viewName === targetView) {
        this.views[viewName].classList.remove('hidden');
      } else {
        this.views[viewName].classList.add('hidden');
      }
    });
    this.currentView = targetView;
    
    // Stop camera if we navigate away from scanner
    if (targetView !== 'scanner') {
      this.stopScannerLoop();
    }
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ==============================================
  // DASHBOARD MANAGEMENT
  // ==============================================
  refreshDashboard() {
    let products = [];
    
    if (this.currentFilter === 'all') {
      products = getProducts();
    } else if (this.currentFilter === 'expiring') {
      products = getExpiringSoonProducts(30);
    } else if (this.currentFilter === 'expired') {
      products = getExpiredProducts();
    }

    // Refresh stats
    const allProducts = getProducts();
    this.statTotal.textContent = allProducts.length;
    this.statExpiring.textContent = getExpiringSoonProducts(30).length;
    this.statExpired.textContent = getExpiredProducts().length;

    // Render list
    this.renderProductsList(products);
    lucide.createIcons();
  }

  renderProductsList(products) {
    if (!products || products.length === 0) {
      this.historyGrid.classList.add('hidden');
      this.emptyState.classList.remove('hidden');
      return;
    }

    this.historyGrid.classList.remove('hidden');
    this.emptyState.classList.add('hidden');

    this.historyGrid.innerHTML = '';
    
    products.forEach(p => {
      // Determine shelf life status
      let statusBadgeHtml = '';
      const now = new Date();
      
      if (p.expiry_date) {
        const expDate = new Date(p.expiry_date);
        if (isNaN(expDate.getTime())) {
          statusBadgeHtml = `<span class="bg-cyber-element border border-cyber-border text-cyber-muted text-[10px] font-bold px-2.5 py-1 rounded">DATE_ERR</span>`;
        } else if (expDate < now) {
          statusBadgeHtml = `<span class="bg-cyber-red/10 border border-cyber-red/30 text-cyber-red text-[10px] font-bold px-2.5 py-1 rounded inline-flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-cyber-red animate-pulse"></span>EXPIRED</span>`;
        } else {
          // Check if expiring in 30 days
          const diffTime = expDate - now;
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          if (diffDays <= 30) {
            statusBadgeHtml = `<span class="bg-cyber-orange/10 border border-cyber-orange/30 text-cyber-orange text-[10px] font-bold px-2.5 py-1 rounded inline-flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-cyber-orange animate-pulse"></span>EXP: ${diffDays}D</span>`;
          } else {
            statusBadgeHtml = `<span class="bg-cyber-green/10 border border-cyber-green/30 text-cyber-green text-[10px] font-bold px-2.5 py-1 rounded inline-flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-cyber-green"></span>SAFE</span>`;
          }
        }
      } else {
        statusBadgeHtml = `<span class="bg-cyber-element border border-cyber-border text-cyber-muted text-[10px] font-bold px-2.5 py-1 rounded">NO_EXPIRY</span>`;
      }

      // Quantity detail
      const qtyStr = p.quantity ? `${p.quantity} ${p.unit || ''}` : '';

      // Image or placeholder
      const imageSrc = p.product_image || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="%236B7280" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 17V7h6v10"/></svg>';

      const card = document.createElement('div');
      card.className = 'bg-cyber-dark border border-cyber-border hover:border-cyber-cyan/50 p-4 rounded transition cursor-pointer flex flex-col justify-between hover:shadow-[0_0_12px_rgba(0,240,255,0.12)]';
      card.onclick = () => this.openProductDetails(p);

      card.innerHTML = `
        <div class="space-y-3">
          <div class="flex gap-3">
            <div class="w-16 h-16 rounded overflow-hidden border border-cyber-border bg-black flex-shrink-0">
              <img class="w-full h-full object-cover" src="${imageSrc}" alt="${p.product_name}" referrerPolicy="no-referrer" />
            </div>
            <div class="space-y-1 min-w-0">
              <p class="text-[9px] text-cyber-muted font-bold tracking-wider uppercase truncate">${p.brand || 'NO BRAND'}</p>
              <h4 class="text-xs font-bold text-cyber-text truncate leading-tight uppercase">${p.product_name}</h4>
              <p class="text-[10px] text-cyber-cyan font-mono">${p.barcode ? `BARCODE: ${p.barcode}` : 'NO_BARCODE'}</p>
            </div>
          </div>
          <div class="flex items-center justify-between text-xs text-cyber-muted pt-2 border-t border-cyber-border">
            <span class="font-bold">${qtyStr}</span>
            ${statusBadgeHtml}
          </div>
        </div>
      `;

      this.historyGrid.appendChild(card);
    });
  }

  handleSearch() {
    const query = this.searchInput.value;
    const filtered = searchProducts(query);
    this.renderProductsList(filtered);
    lucide.createIcons();
  }

  setFilter(filterName) {
    this.currentFilter = filterName;
    ['filter-all', 'filter-expiring', 'filter-expired'].forEach(id => {
      const btn = document.getElementById(id);
      if (id === `filter-${filterName}`) {
        btn.className = 'flex-grow sm:flex-grow-0 bg-cyber-cyan/15 text-cyber-cyan font-bold px-4 py-2 rounded text-xs transition border border-cyber-cyan/30 uppercase tracking-tight';
      } else {
        btn.className = 'flex-grow sm:flex-grow-0 hover:bg-cyber-element text-cyber-muted font-bold px-4 py-2 rounded text-xs transition border border-transparent uppercase tracking-tight';
      }
    });
    this.refreshDashboard();
  }

  // ==============================================
  // SCANNER MANAGEMENT (CAMERA + BARCODE)
  // ==============================================
  async openScanner() {
    this.switchView('scanner');
    this.resetScannerUI();
    
    try {
      this.showToast('Accessing device camera...', 'info');
      await startCamera(this.videoElem);
      this.startScannerLoop();
      this.showToast('Camera feed ready. Align barcode or tap Capture.', 'success');
    } catch (error) {
      this.showToast(error.message || 'Failed to start camera', 'error');
      this.switchView('dashboard');
    }
  }

  closeScanner() {
    this.stopScannerLoop();
    stopCamera();
    this.switchView('dashboard');
    this.refreshDashboard();
  }

  async toggleCameraStream() {
    try {
      this.showToast('Switching camera...', 'info');
      await toggleCamera(this.videoElem);
    } catch (e) {
      this.showToast(e.message || 'Camera toggle failed', 'error');
    }
  }

  resetScannerUI() {
    this.activeBarcode = null;
    this.activeBarcodeFormat = null;
    this.capturedImageBase64 = null;
    this.barcodeStatusText.textContent = "Barcode: Detecting...";
    this.barcodeStatusText.className = "text-xs text-white font-medium";
    this.barcodeIndicator.className = "relative inline-flex rounded-full h-3.5 w-3.5 bg-amber-500";
    this.barcodeIndicatorRing.className = "animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75";
    this.barcodeResultBadge.classList.add('hidden');
  }

  startScannerLoop() {
    this.isScanningActive = true;
    
    // Background scanning loop: grab frame every 300ms for barcode analysis
    const scanFrame = async () => {
      if (!this.isScanningActive) return;

      try {
        const result = await detectBarcode(this.videoElem);
        if (result && this.isScanningActive) {
          this.activeBarcode = result.value;
          this.activeBarcodeFormat = result.format;
          
          // Try to play a quick subtle beep/buzz
          if (navigator.vibrate) {
            navigator.vibrate(100);
          }

          // Update UI
          this.barcodeStatusText.textContent = `Barcode detected: ${result.value}`;
          this.barcodeStatusText.className = "text-xs text-emerald-400 font-extrabold";
          this.barcodeIndicator.className = "relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500";
          this.barcodeIndicatorRing.className = "animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75";
          this.barcodeResultBadge.textContent = result.format;
          this.barcodeResultBadge.classList.remove('hidden');

          this.showToast(`Decoded ${result.format}: ${result.value}`, 'success');
        }
      } catch (e) {
        // Suppress expected frame grab errors when stream is loading
      }

      if (this.isScanningActive) {
        this.detectionInterval = setTimeout(scanFrame, 300);
      }
    };

    scanFrame();
  }

  stopScannerLoop() {
    this.isScanningActive = false;
    if (this.detectionInterval) {
      clearTimeout(this.detectionInterval);
      this.detectionInterval = null;
    }
  }

  // ==============================================
  // CAPTURE & MULTIMODAL PROXY PROCESSING
  // ==============================================
  async captureAndProcess() {
    try {
      this.stopScannerLoop();
      
      this.showLoading('Preparing image...', 'Optimizing resolution and adjusting format for fast processing...');
      
      // Capture optimized cropped frame from the stream
      const compressedImage = captureFrame(this.videoElem, this.scanAreaElem);
      this.capturedImageBase64 = compressedImage;
      
      // Stop stream as we don't need the camera running in the background during AI analysis
      stopCamera();

      this.updateLoading('Analyzing with AI Vision...', 'Gemini is processing the package text and ingredients. Please wait...');

      // Run AI vision analysis on the server proxy
      let aiResult = { product_found: false };
      try {
        aiResult = await analyzeProductImage(compressedImage);
      } catch (aiError) {
        console.error("AI Analysis route failed:", aiError);
        this.showToast(`AI Vision failed: ${aiError.message}`, 'error');
      }

      this.updateLoading('Database lookup...', 'Cross-referencing verified barcodes in catalog databases...');

      // Run database catalog lookup if we decoded a barcode natively or if the AI read a visible barcode
      const finalBarcode = this.activeBarcode || aiResult?.barcode;
      let dbResult = { product_found: false };

      if (finalBarcode) {
        try {
          dbResult = await lookupProductByBarcode(finalBarcode);
        } catch (dbError) {
          console.warn("Database lookup failed, falling back purely to AI vision:", dbError);
        }
      }

      // Merge verified database details with AI vision data
      const mergedDetails = mergeProductData(dbResult, aiResult);
      mergedDetails.product_image = this.capturedImageBase64; // Use captured picture
      if (finalBarcode && !mergedDetails.barcode) {
        mergedDetails.barcode = finalBarcode;
      }

      this.hideLoading();
      this.openVerification(mergedDetails);
    } catch (e) {
      this.hideLoading();
      this.showToast(e.message || "An error occurred during scanning capture.", "error");
      this.openScanner(); // Re-open scanner if we crash
    }
  }

  // ==============================================
  // VERIFICATION FORM MANAGEMENT
  // ==============================================
  openVerification(data) {
    this.switchView('verify');
    this.editingProductId = null; // We are saving a new scan, not editing

    // Bind image
    this.verifyPreviewImg.src = data.product_image || '';

    // Bind inputs
    document.getElementById('v-name').value = data.product_name || '';
    document.getElementById('v-brand').value = data.brand || '';
    document.getElementById('v-barcode').value = data.barcode || '';
    document.getElementById('v-category').value = data.category || 'General';
    document.getElementById('v-quantity').value = data.quantity || '';
    document.getElementById('v-unit').value = data.unit || '';
    document.getElementById('v-mrp').value = data.mrp || '';
    document.getElementById('v-selling_price').value = data.selling_price || '';
    document.getElementById('v-batch').value = data.batch_number || '';
    
    // Convert array ingredients to comma string
    document.getElementById('v-ingredients').value = data.ingredients && data.ingredients.length > 0 
      ? data.ingredients.join(', ') 
      : '';

    // Date binding (Attempt parsing AI date strings into standard YYYY-MM-DD input format)
    document.getElementById('v-mfg').value = this.parseDateString(data.manufacture_date);
    document.getElementById('v-exp').value = this.parseDateString(data.expiry_date);

    // Confidence Level binding
    if (data.confidence && data.confidence > 0) {
      this.aiConfidencePanel.classList.remove('hidden');
      this.aiConfidenceValue.textContent = `${data.confidence}%`;
      this.aiConfidenceBar.style.width = `${data.confidence}%`;
      
      // Color adjustment based on confidence
      if (data.confidence < 60) {
        this.aiConfidenceBar.className = "bg-amber-500 h-2.5 rounded-full";
        this.aiConfidenceWarning.classList.remove('hidden');
      } else {
        this.aiConfidenceBar.className = "bg-emerald-500 h-2.5 rounded-full";
        this.aiConfidenceWarning.classList.add('hidden');
      }
    } else {
      this.aiConfidencePanel.classList.add('hidden');
    }

    // Bind verification sources badges
    const sources = data.sources || {};
    Object.keys(sources).forEach(field => {
      const sourceIndicator = document.getElementById(`source-${field}`);
      if (sourceIndicator) {
        const src = sources[field];
        if (src === 'Database') {
          sourceIndicator.textContent = '✓ Product Database';
          sourceIndicator.className = 'badge-source badge-db';
        } else if (src === 'Barcode Scanner') {
          sourceIndicator.textContent = '✓ Barcode Scanner';
          sourceIndicator.className = 'badge-source badge-barcode';
        } else if (src === 'AI Vision') {
          sourceIndicator.textContent = '✓ AI Vision';
          sourceIndicator.className = 'badge-source badge-ai';
        } else {
          sourceIndicator.textContent = '⚠ Not Verified';
          sourceIndicator.className = 'badge-source badge-unverified';
        }
      }
    });

    lucide.createIcons();
  }

  cancelVerification() {
    this.switchView('dashboard');
    this.refreshDashboard();
    this.showToast('Scan result discarded.', 'info');
  }

  saveVerification() {
    const nameInput = document.getElementById('v-name');
    if (!nameInput.value.trim()) {
      this.showToast('Product Name is required to save.', 'error');
      nameInput.focus();
      return;
    }

    // Build product schema to save
    const ingText = document.getElementById('v-ingredients').value;
    const ingredientsArray = ingText 
      ? ingText.split(',').map(i => i.trim()).filter(i => i.length > 0) 
      : [];

    const payload = {
      product_name: nameInput.value.trim(),
      brand: document.getElementById('v-brand').value.trim() || null,
      barcode: document.getElementById('v-barcode').value.trim() || null,
      category: document.getElementById('v-category').value,
      quantity: document.getElementById('v-quantity').value.trim() || null,
      unit: document.getElementById('v-unit').value.trim() || null,
      mrp: document.getElementById('v-mrp').value.trim() || null,
      selling_price: document.getElementById('v-selling_price').value.trim() || null,
      manufacture_date: document.getElementById('v-mfg').value || null,
      expiry_date: document.getElementById('v-exp').value || null,
      batch_number: document.getElementById('v-batch').value.trim() || null,
      ingredients: ingredientsArray,
      product_image: this.capturedImageBase64
    };

    try {
      if (this.editingProductId) {
        // Update
        updateProduct(this.editingProductId, payload);
        this.showToast('Product updated successfully', 'success');
      } else {
        // Save new
        saveProduct(payload);
        this.showToast('Product logged in shelf history', 'success');
      }
      this.switchView('dashboard');
      this.refreshDashboard();
    } catch (e) {
      this.showToast('Failed to save product locally', 'error');
    }
  }

  // Helper to parse messy date strings from AI into standard ISO date (YYYY-MM-DD) for HTML5 input
  parseDateString(dateStr) {
    if (!dateStr) return '';
    
    // Check if it's already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return dateStr;
    }

    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    return '';
  }

  // ==============================================
  // VIEW DETAILS MODAL VIEWER
  // ==============================================
  openProductDetails(p) {
    this.activeViewingProduct = p;
    this.detailModal.classList.remove('hidden');

    const mfgDateText = p.manufacture_date ? new Date(p.manufacture_date).toLocaleDateString() : 'N/A';
    const expDateText = p.expiry_date ? new Date(p.expiry_date).toLocaleDateString() : 'N/A';
    
    let statusBadgeHtml = '';
    const now = new Date();
    if (p.expiry_date) {
      const expDate = new Date(p.expiry_date);
      if (expDate < now) {
        statusBadgeHtml = `<span class="bg-cyber-red/15 border border-cyber-red/30 text-cyber-red text-xs font-bold px-3 py-1 rounded">EXPIRED</span>`;
      } else {
        const diffDays = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
        statusBadgeHtml = diffDays <= 30
          ? `<span class="bg-cyber-orange/15 border border-cyber-orange/30 text-cyber-orange text-xs font-bold px-3 py-1 rounded font-bold">EXPIRING: ${diffDays}D</span>`
          : `<span class="bg-cyber-green/15 border border-cyber-green/30 text-cyber-green text-xs font-bold px-3 py-1 rounded">SHELF SAFE</span>`;
      }
    } else {
      statusBadgeHtml = `<span class="bg-cyber-element border border-cyber-border text-cyber-muted text-xs font-bold px-3 py-1 rounded">NO_EXPIRY</span>`;
    }

    const imageSrc = p.product_image || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="%236B7280" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 17V7h6v10"/></svg>';

    const ingredientsHtml = p.ingredients && p.ingredients.length > 0
      ? p.ingredients.map(ing => `<span class="bg-cyber-element border border-cyber-border text-cyber-text text-[10px] px-2.5 py-1 rounded font-bold uppercase">${ing}</span>`).join('')
      : '<p class="text-[10px] text-cyber-muted uppercase">Composition register empty</p>';

    this.modalContent.innerHTML = `
      <div class="flex flex-col sm:flex-row gap-4 items-start sm:items-center font-mono">
        <div class="w-24 h-24 rounded overflow-hidden border border-cyber-border bg-black flex-shrink-0 mx-auto sm:mx-0">
          <img class="w-full h-full object-cover" src="${imageSrc}" alt="${p.product_name}" referrerPolicy="no-referrer" />
        </div>
        <div class="space-y-1.5 text-center sm:text-left w-full min-w-0">
          <p class="text-[10px] text-cyber-muted font-bold uppercase tracking-wider">${p.brand || 'NO BRAND'}</p>
          <h4 class="text-sm font-bold text-cyber-text leading-tight truncate uppercase">${p.product_name}</h4>
          <div class="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
            ${statusBadgeHtml}
            <span class="text-[10px] bg-cyber-cyan/15 text-cyber-cyan border border-cyber-cyan/30 px-2.5 py-1 rounded font-bold uppercase">${p.category || 'GENERAL'}</span>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4 border-t border-cyber-border pt-4 text-xs font-mono">
        <div>
          <p class="text-[10px] text-cyber-muted font-bold uppercase">Barcode Registry</p>
          <p class="font-mono text-cyber-cyan font-bold pt-1">${p.barcode || 'N/A'}</p>
        </div>
        <div>
          <p class="text-[10px] text-cyber-muted font-bold uppercase">Net Contents</p>
          <p class="text-cyber-text font-bold pt-1">${p.quantity ? `${p.quantity} ${p.unit || ''}` : 'N/A'}</p>
        </div>
        <div>
          <p class="text-[10px] text-cyber-muted font-bold uppercase">MRP</p>
          <p class="text-cyber-text font-bold pt-1">${p.mrp || 'N/A'}</p>
        </div>
        <div>
          <p class="text-[10px] text-cyber-muted font-bold uppercase">Acquisition Price</p>
          <p class="text-cyber-text font-bold pt-1">${p.selling_price || 'N/A'}</p>
        </div>
        <div>
          <p class="text-[10px] text-cyber-muted font-bold uppercase">Manufactured Date</p>
          <p class="text-cyber-text font-bold pt-1">${mfgDateText}</p>
        </div>
        <div>
          <p class="text-[10px] text-cyber-muted font-bold uppercase">Expiry Date</p>
          <p class="text-cyber-text font-bold pt-1">${expDateText}</p>
        </div>
        <div class="col-span-2">
          <p class="text-[10px] text-cyber-muted font-bold uppercase">Batch / Lot Index</p>
          <p class="text-cyber-text font-bold pt-1">${p.batch_number || 'N/A'}</p>
        </div>
      </div>

      <div class="border-t border-cyber-border pt-4 space-y-2 font-mono">
        <p class="text-[10px] text-cyber-muted font-bold uppercase">Chemical Matrix Composition</p>
        <div class="flex flex-wrap gap-1.5 pt-1">
          ${ingredientsHtml}
        </div>
      </div>
    `;

    // Hook buttons
    this.modalBtnDelete.onclick = () => this.deleteRecord(p.id);
    this.modalBtnEdit.onclick = () => this.editRecord(p);

    lucide.createIcons();
  }

  closeModal() {
    this.detailModal.classList.add('hidden');
    this.activeViewingProduct = null;
  }

  deleteRecord(id) {
    if (confirm('Are you sure you want to permanently delete this product history record?')) {
      deleteProduct(id);
      this.closeModal();
      this.refreshDashboard();
      this.showToast('Product record deleted.', 'info');
    }
  }

  editRecord(p) {
    this.closeModal();
    this.editingProductId = p.id;
    this.capturedImageBase64 = p.product_image;

    // Fake a source profile where everything editable belongs to AI/DB profile
    const fakeData = {
      ...p,
      sources: {
        product_name: p.product_name ? 'Database' : 'Not Verified',
        brand: p.brand ? 'Database' : 'Not Verified',
        barcode: p.barcode ? 'Barcode Scanner' : 'Not Verified',
        category: p.category ? 'Database' : 'Not Verified',
        mrp: p.mrp ? 'AI Vision' : 'Not Verified',
        selling_price: p.selling_price ? 'AI Vision' : 'Not Verified',
        quantity: p.quantity ? 'Database' : 'Not Verified',
        unit: p.unit ? 'Database' : 'Not Verified',
        manufacture_date: p.manufacture_date ? 'AI Vision' : 'Not Verified',
        expiry_date: p.expiry_date ? 'AI Vision' : 'Not Verified',
        batch_number: p.batch_number ? 'AI Vision' : 'Not Verified',
        ingredients: p.ingredients?.length > 0 ? 'Database' : 'Not Verified'
      }
    };

    this.openVerification(fakeData);
  }

  // ==============================================
  // OFFLINE DEV TEST TRIGGER
  // ==============================================
  triggerTestScan() {
    this.showToast('Loading clearly marked Development Mock Scan...', 'info');
    this.showLoading('Simulating test image processing...', 'Development Sandbox Mode • Preparing simulated image frame');
    
    setTimeout(() => {
      this.updateLoading('Querying sandbox mock data...', 'Fetching sample product details...');
      
      setTimeout(() => {
        // Return a clearly marked mock product as requested in rule #16
        const mockData = {
          product_found: true,
          product_name: "SANDBOX MOCK: Organic Almond Milk",
          brand: "Healthy Earth Foods Ltd",
          barcode: "8901030752538",
          category: "Beverage",
          mrp: "$3.99",
          selling_price: "$3.49",
          quantity: "1",
          unit: "L",
          manufacture_date: "2026-08-01",
          expiry_date: "2026-12-31",
          batch_number: "MOCK-90823",
          ingredients: ["Almond Milk", "Sea Salt", "Calcium Carbonate", "Gellan Gum", "Vitamin E Acetate"],
          product_image: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="%233b82f6" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
          confidence: 95,
          sources: {
            product_name: 'Database',
            brand: 'Database',
            barcode: 'Barcode Scanner',
            category: 'Database',
            mrp: 'AI Vision',
            selling_price: 'AI Vision',
            quantity: 'Database',
            unit: 'Database',
            manufacture_date: 'AI Vision',
            expiry_date: 'AI Vision',
            batch_number: 'AI Vision',
            ingredients: 'Database'
          }
        };

        this.hideLoading();
        this.openVerification(mockData);
        this.showToast('Test scan ready! Verify and click save.', 'success');
      }, 1000);
    }, 1000);
  }

  // ==============================================
  // CORE UTILS (LOADING & TOASTS)
  // ==============================================
  showLoading(title, desc) {
    this.loadingTitle.textContent = title;
    this.loadingDesc.textContent = desc;
    this.loadingBackdrop.classList.remove('hidden');
  }

  updateLoading(title, desc) {
    this.loadingTitle.textContent = title;
    this.loadingDesc.textContent = desc;
  }

  hideLoading() {
    this.loadingBackdrop.classList.add('hidden');
  }

  showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toast-container');
    const toast = document.createElement('div');
    
    let bgClass = 'bg-cyber-dark text-cyber-text border border-cyber-border';
    let icon = 'info';

    if (type === 'success') {
      bgClass = 'bg-cyber-dark text-cyber-green border border-cyber-green/40 shadow-[0_0_10px_rgba(0,255,65,0.15)]';
      icon = 'check-circle';
    } else if (type === 'error') {
      bgClass = 'bg-cyber-dark text-cyber-red border border-cyber-red/40 shadow-[0_0_10px_rgba(255,68,68,0.15)]';
      icon = 'alert-octagon';
    } else if (type === 'info') {
      bgClass = 'bg-cyber-dark text-cyber-cyan border border-cyber-cyan/40 shadow-[0_0_10px_rgba(0,240,255,0.15)]';
      icon = 'info';
    }

    toast.className = `${bgClass} flex items-center gap-2.5 px-4 py-3 rounded text-xs font-bold font-mono max-w-sm w-max transition duration-300 transform translate-y-2 opacity-0 pointer-events-auto`;
    toast.innerHTML = `
      <i data-lucide="${icon}" class="w-4 h-4"></i>
      <span class="uppercase tracking-tight">${message}</span>
    `;

    toastContainer.appendChild(toast);
    lucide.createIcons();

    // Trigger transition
    setTimeout(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
    }, 10);

    // Fade out and remove
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-[-8px]');
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 3500);
  }
}

// Instantiate and expose globally
window.app = new App();
export default window.app;
