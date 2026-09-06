/**
 * Storage module for the Product Scanner app.
 * Persists scanned products in localStorage.
 */

const STORAGE_KEY = 'scanned_products_history';

/**
 * Get all scanned products from localStorage
 * @returns {Array} List of products, sorted by scan timestamp (newest first)
 */
export function getProducts() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    const products = JSON.parse(data);
    return products.sort((a, b) => b.scanTimestamp - a.scanTimestamp);
  } catch (error) {
    console.error('Error reading from localStorage:', error);
    return [];
  }
}

/**
 * Save a new product to history
 * @param {Object} product Product data to save
 * @returns {Object} The saved product with generated ID
 */
export function saveProduct(product) {
  try {
    const products = getProducts();
    
    const newProduct = {
      id: 'prod_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      product_name: product.product_name || 'Unknown Product',
      brand: product.brand || null,
      barcode: product.barcode || null,
      category: product.category || 'General',
      mrp: product.mrp || null,
      selling_price: product.selling_price || null,
      quantity: product.quantity || null,
      unit: product.unit || null,
      manufacture_date: product.manufacture_date || null,
      expiry_date: product.expiry_date || null,
      best_before: product.best_before || null,
      batch_number: product.batch_number || null,
      manufacturer: product.manufacturer || null,
      country_of_origin: product.country_of_origin || null,
      product_description: product.product_description || null,
      nutrition_information: product.nutrition_information || null,
      allergens: product.allergens || null,
      storage_instructions: product.storage_instructions || null,
      warnings: product.warnings || null,
      ingredients: Array.isArray(product.ingredients) ? product.ingredients : [],
      product_image: product.product_image || null,
      _capturedImages: product._capturedImages || null,
      processed_images: product.processed_images || null,
      three_d_model: product.three_d_model || null,
      dimensions: product.dimensions || null,
      confidence: product.confidence || null,
      source_images: product.source_images || null,
      created_at: product.created_at || new Date().toISOString(),
      scanTimestamp: Date.now()
    };

    products.push(newProduct);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
    return newProduct;
  } catch (error) {
    console.error('Error saving product to localStorage:', error);
    throw new Error('Failed to save product locally');
  }
}

/**
 * Update an existing product in history
 * @param {string} id Product ID to update
 * @param {Object} updatedFields Fields to update
 * @returns {Object|null} The updated product, or null if not found
 */
export function updateProduct(id, updatedFields) {
  try {
    const products = getProducts();
    const index = products.findIndex(p => p.id === id);
    if (index === -1) return null;

    products[index] = {
      ...products[index],
      ...updatedFields,
      // Retain ID and original scan timestamp unless overridden
      id: id,
      scanTimestamp: products[index].scanTimestamp
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
    return products[index];
  } catch (error) {
    console.error('Error updating product in localStorage:', error);
    throw new Error('Failed to update product');
  }
}

/**
 * Delete a product from history
 * @param {string} id Product ID to delete
 * @returns {boolean} True if successfully deleted
 */
export function deleteProduct(id) {
  try {
    const products = getProducts();
    const filtered = products.filter(p => p.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    return true;
  } catch (error) {
    console.error('Error deleting product from localStorage:', error);
    return false;
  }
}

/**
 * Helper to get products expiring soon (within 30 days)
 * @returns {Array} Products expiring soon
 */
export function getExpiringSoonProducts(days = 30) {
  const products = getProducts();
  const now = new Date();
  const futureLimit = new Date();
  futureLimit.setDate(now.getDate() + days);

  return products.filter(p => {
    if (!p.expiry_date) return false;
    const expDate = new Date(p.expiry_date);
    // Ensure valid date, in the future, and within threshold
    return !isNaN(expDate.getTime()) && expDate > now && expDate <= futureLimit;
  });
}

/**
 * Helper to get already expired products
 * @returns {Array} Expired products
 */
export function getExpiredProducts() {
  const products = getProducts();
  const now = new Date();

  return products.filter(p => {
    if (!p.expiry_date) return false;
    const expDate = new Date(p.expiry_date);
    // Ensure valid date and in the past
    return !isNaN(expDate.getTime()) && expDate <= now;
  });
}

/**
 * Helper to search scanned products by name, brand, or barcode
 * @param {string} query Search term
 * @returns {Array} Matched products
 */
export function searchProducts(query) {
  if (!query || typeof query !== 'string') return getProducts();
  
  const products = getProducts();
  const lowerQuery = query.toLowerCase().trim();

  return products.filter(p => {
    const nameMatch = p.product_name && p.product_name.toLowerCase().includes(lowerQuery);
    const brandMatch = p.brand && p.brand.toLowerCase().includes(lowerQuery);
    const barcodeMatch = p.barcode && p.barcode.includes(lowerQuery);
    const categoryMatch = p.category && p.category.toLowerCase().includes(lowerQuery);
    return nameMatch || brandMatch || barcodeMatch || categoryMatch;
  });
}
