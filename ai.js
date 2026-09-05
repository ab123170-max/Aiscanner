/**
 * Client-side AI Scanner interface.
 * Connects to our secure server proxy to analyze captured product images using Gemini Vision.
 */

/**
 * Sends a captured product image to the secure backend AI API for vision analysis.
 * @param {string} base64Image Base64-encoded image data (without the data:image/jpeg;base64 prefix)
 * @param {string} mimeType The mime type of the image (e.g. 'image/jpeg')
 * @returns {Promise<Object>} The parsed and validated JSON response from the AI
 */
export async function analyzeProductImage(base64Image, mimeType = 'image/jpeg') {
  if (!base64Image) {
    throw new Error("No image data provided for AI analysis");
  }

  // Remove data URI prefix if it exists
  const rawBase64 = base64Image.includes('base64,') 
    ? base64Image.split('base64,')[1] 
    : base64Image;

  try {
    const response = await fetch('/api/analyze-product', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image: rawBase64,
        mimeType: mimeType
      })
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

  // Define the strict default template matching user requirement #4
  const normalized = {
    product_found: typeof rawData.product_found === 'boolean' ? rawData.product_found : false,
    product_name: rawData.product_name !== undefined ? rawData.product_name : null,
    brand: rawData.brand !== undefined ? rawData.brand : null,
    barcode: rawData.barcode !== undefined ? rawData.barcode : null,
    category: rawData.category !== undefined ? rawData.category : null,
    mrp: rawData.mrp !== undefined ? rawData.mrp : null,
    selling_price: rawData.selling_price !== undefined ? rawData.selling_price : null,
    quantity: rawData.quantity !== undefined ? rawData.quantity : null,
    unit: rawData.unit !== undefined ? rawData.unit : null,
    manufacture_date: rawData.manufacture_date !== undefined ? rawData.manufacture_date : null,
    expiry_date: rawData.expiry_date !== undefined ? rawData.expiry_date : null,
    batch_number: rawData.batch_number !== undefined ? rawData.batch_number : null,
    ingredients: Array.isArray(rawData.ingredients) ? rawData.ingredients : [],
    confidence: typeof rawData.confidence === 'number' ? rawData.confidence : 0
  };

  // Convert empty strings or 'null' strings to real null values
  const fieldsToClean = [
    'product_name', 'brand', 'barcode', 'category', 'mrp', 
    'selling_price', 'quantity', 'unit', 'manufacture_date', 
    'expiry_date', 'batch_number'
  ];

  for (const field of fieldsToClean) {
    const val = normalized[field];
    if (val === '' || val === 'null' || val === 'none' || val === 'N/A' || val === 'n/a') {
      normalized[field] = null;
    }
  }

  // If the AI didn't find the product name, mark it as not found
  if (normalized.product_found && !normalized.product_name) {
    normalized.product_found = false;
  }

  return normalized;
}
