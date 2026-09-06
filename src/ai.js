/**
 * Client-side AI Scanner interface.
 * Connects to our secure server proxy to analyze captured product images using Gemini Vision.
 */

/**
 * Sends one or more captured product images to the secure backend AI API for multi-shot vision analysis.
 * @param {Array|string} imagesOrBase64 Either an array of { data, label, mimeType } or a single base64 string
 * @param {string} mimeType The mime type of the image if single (e.g. 'image/jpeg')
 * @returns {Promise<Object>} The parsed and validated JSON response from the AI
 */
export async function analyzeProductImage(imagesOrBase64, mimeType = 'image/jpeg') {
  if (!imagesOrBase64) {
    throw new Error("No image data provided for AI analysis");
  }

  let bodyData = {};

  if (Array.isArray(imagesOrBase64)) {
    // Multi-shot payload
    bodyData = {
      images: imagesOrBase64.map(img => {
        const raw = img.data.includes('base64,') ? img.data.split('base64,')[1] : img.data;
        return {
          data: raw,
          mimeType: img.mimeType || 'image/jpeg',
          label: img.label || 'Shot'
        };
      })
    };
  } else {
    // Fallback single-shot payload
    const rawBase64 = imagesOrBase64.includes('base64,') 
      ? imagesOrBase64.split('base64,')[1] 
      : imagesOrBase64;
    
    bodyData = {
      image: rawBase64,
      mimeType: mimeType
    };
  }

  try {
    const response = await fetch('/api/analyze-product', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bodyData)
    });

    if (!response.ok) {
      let errorMessage = `Server error (Status ${response.status})`;
      try {
        const errorJson = await response.json();
        if (errorJson.error) errorMessage = errorJson.error;
      } catch (e) {
        // Fallback to text
      }
      throw new Error(errorMessage);
    }

    const rawData = await response.json();
    return validateAndNormalizeAIResponse(rawData);
  } catch (error) {
    console.error("AI image analysis failed:", error);
    throw error;
  }
}

/**
 * Validates and normalizes the JSON returned by the AI.
 * Ensures all expected keys are present, matching the required schema, or set to null/empty values.
 * Strictly prevents fake or fabricated data displays.
 * 
 * @param {Object} rawData Response from the backend api
 * @returns {Object} Validated and normalized product data object
 */
function validateAndNormalizeAIResponse(rawData) {
  if (!rawData || typeof rawData !== 'object') {
    throw new Error("Invalid AI response: Expected a JSON object");
  }

  // Define the strict default template matching the extended report fields
  const normalized = {
    product_found: typeof rawData.product_found === 'boolean' ? rawData.product_found : false,
    product_name: rawData.product_name !== undefined ? rawData.product_name : null,
    brand: rawData.brand !== undefined ? rawData.brand : null,
    barcode: rawData.barcode !== undefined ? rawData.barcode : null,
    category: rawData.category !== undefined ? rawData.category : null,
    product_description: rawData.product_description !== undefined ? rawData.product_description : null,
    mrp: rawData.mrp !== undefined ? rawData.mrp : null,
    selling_price: rawData.selling_price !== undefined ? rawData.selling_price : null,
    quantity: rawData.quantity !== undefined ? rawData.quantity : null,
    unit: rawData.unit !== undefined ? rawData.unit : null,
    manufacture_date: rawData.manufacture_date !== undefined ? rawData.manufacture_date : null,
    expiry_date: rawData.expiry_date !== undefined ? rawData.expiry_date : null,
    best_before: rawData.best_before !== undefined ? rawData.best_before : null,
    batch_number: rawData.batch_number !== undefined ? rawData.batch_number : null,
    manufacturer: rawData.manufacturer !== undefined ? rawData.manufacturer : null,
    country_of_origin: rawData.country_of_origin !== undefined ? rawData.country_of_origin : null,
    ingredients: Array.isArray(rawData.ingredients) ? rawData.ingredients : [],
    allergens: rawData.allergens !== undefined ? rawData.allergens : null,
    nutrition_information: rawData.nutrition_information !== undefined ? rawData.nutrition_information : null,
    storage_instructions: rawData.storage_instructions !== undefined ? rawData.storage_instructions : null,
    warnings: rawData.warnings !== undefined ? rawData.warnings : null,
    confidence: typeof rawData.confidence === 'number' ? rawData.confidence : 0,
    information_sources: Array.isArray(rawData.information_sources) ? rawData.information_sources : [],
    conflicting_fields: Array.isArray(rawData.conflicting_fields) ? rawData.conflicting_fields : []
  };

  // Convert empty strings or 'null' strings to real null values
  const fieldsToClean = [
    'product_name', 'brand', 'barcode', 'category', 'product_description', 'mrp', 
    'selling_price', 'quantity', 'unit', 'manufacture_date', 'expiry_date', 'best_before', 
    'batch_number', 'manufacturer', 'country_of_origin', 'allergens', 'nutrition_information', 
    'storage_instructions', 'warnings'
  ];

  for (const field of fieldsToClean) {
    const val = normalized[field];
    if (val === '' || val === 'null' || val === 'none' || val === 'N/A' || val === 'n/a' || val === 'undefined') {
      normalized[field] = null;
    }
  }

  // If the AI didn't find the product name, mark it as not found
  if (normalized.product_found && !normalized.product_name) {
    normalized.product_found = false;
  }

  return normalized;
}
