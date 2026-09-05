/**
 * Product Database Lookup API layer.
 * Queries our secure server proxy to search products by barcode in real databases like Open Food Facts.
 */

/**
 * Searches the product database by barcode.
 * @param {string} barcode The verified product barcode
 * @returns {Promise<Object>} Object with success status, data, and source details
 */
export async function lookupProductByBarcode(barcode) {
  if (!barcode) {
    return {
      product_found: false,
      message: "No barcode provided"
    };
  }

  try {
    // Call our server proxy endpoint to lookup product by barcode
    const response = await fetch(`/api/lookup-product?barcode=${encodeURIComponent(barcode)}`);
    
    if (!response.ok) {
      throw new Error(`Server returned status ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error looking up barcode in product database:", error);
    return {
      product_found: false,
      message: `Product lookup failed: ${error.message || "Network or server error"}`
    };
  }
}

/**
 * Merges verified database information with AI-detected visual information.
 * Prioritizes database information for standard fields (e.g., name, brand, ingredients)
 * but retains AI-detected fields that are item-specific (like expiry dates, batch number, MRP/price).
 * 
 * Each field's source will be tracked for verification transparency.
 * 
 * @param {Object} dbData Information retrieved from lookupProductByBarcode
 * @param {Object} aiData Information retrieved from analyzeProductImage
 * @returns {Object} Combined and verified product details with source metadata
 */
export function mergeProductData(dbData, aiData) {
  const merged = {
    product_found: dbData?.product_found || aiData?.product_found || false,
    product_name: dbData?.product_name || aiData?.product_name || null,
    brand: dbData?.brand || aiData?.brand || null,
    barcode: dbData?.barcode || aiData?.barcode || null,
    category: dbData?.category || aiData?.category || null,
    mrp: aiData?.mrp || null, // MRP is rarely on public databases; prefer AI visual
    selling_price: aiData?.selling_price || null, // Prefer AI printed price
    quantity: dbData?.quantity || aiData?.quantity || null,
    unit: dbData?.unit || aiData?.unit || null,
    manufacture_date: aiData?.manufacture_date || null, // Specific to this item
    expiry_date: aiData?.expiry_date || null, // Specific to this item
    batch_number: aiData?.batch_number || null, // Specific to this item
    ingredients: (dbData?.ingredients && dbData.ingredients.length > 0) 
      ? dbData.ingredients 
      : (aiData?.ingredients || []),
    product_image: dbData?.image_url || aiData?.product_image || null,
    confidence: aiData?.confidence || 0,
    
    // Metadata sources for each field
    sources: {
      product_name: dbData?.product_name ? 'Database' : (aiData?.product_name ? 'AI Vision' : 'Not Verified'),
      brand: dbData?.brand ? 'Database' : (aiData?.brand ? 'AI Vision' : 'Not Verified'),
      barcode: dbData?.barcode ? 'Barcode Scanner' : (aiData?.barcode ? 'AI Vision' : 'Not Verified'),
      category: dbData?.category ? 'Database' : (aiData?.category ? 'AI Vision' : 'Not Verified'),
      mrp: aiData?.mrp ? 'AI Vision' : 'Not Verified',
      selling_price: aiData?.selling_price ? 'AI Vision' : 'Not Verified',
      quantity: dbData?.quantity ? 'Database' : (aiData?.quantity ? 'AI Vision' : 'Not Verified'),
      unit: dbData?.unit ? 'Database' : (aiData?.unit ? 'AI Vision' : 'Not Verified'),
      manufacture_date: aiData?.manufacture_date ? 'AI Vision' : 'Not Verified',
      expiry_date: aiData?.expiry_date ? 'AI Vision' : 'Not Verified',
      batch_number: aiData?.batch_number ? 'AI Vision' : 'Not Verified',
      ingredients: (dbData?.ingredients && dbData.ingredients.length > 0) ? 'Database' : (aiData?.ingredients?.length > 0 ? 'AI Vision' : 'Not Verified')
    }
  };

  return merged;
}
