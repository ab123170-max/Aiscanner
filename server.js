import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from 'vite';

dotenv.config();

const app = express();
const PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Allow large image uploads
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Lazy initialized AI client helper
let aiClient = null;
function getAIClient() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not defined in the environment variables.");
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// Robust content generation helper with exponential backoff retries and model fallback
async function generateContentWithRetryAndFallback(ai, params) {
  const modelsToTry = [
    'gemini-3.8-flash',
    'gemini-flash-latest',
  ];

  let lastError = null;

  for (const modelName of modelsToTry) {
    let attempts = 3;
    let delay = 1000; // start with 1000ms delay

    while (attempts > 0) {
      try {
        console.log(`[Gemini API] Attempting generateContent with model: ${modelName} (${attempts} attempts remaining)`);
        const response = await ai.models.generateContent({
          ...params,
          model: modelName
        });
        return response;
      } catch (error) {
        lastError = error;
        const errorMessage = error.message || '';
        const isRetriable = errorMessage.includes('503') || 
                            errorMessage.includes('temporary') || 
                            errorMessage.includes('demand') || 
                            errorMessage.includes('UNAVAILABLE') ||
                            (error.status && error.status === 503);

        if (isRetriable && attempts > 1) {
          console.warn(`[Gemini API] Encountered retriable error/503: ${errorMessage}. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // exponential backoff
          attempts--;
        } else {
          console.error(`[Gemini API] Model ${modelName} attempt failed with error: ${errorMessage}.`);
          break; // Try the next model
        }
      }
    }
  }

  throw lastError || new Error("All attempts and fallback models exhausted");
}

// REST API for Multi-Shot AI Product Analysis
app.post('/api/analyze-product', async (req, res) => {
  try {
    const { image, mimeType, images } = req.body;
    
    // Support either single image or array of images
    let imageList = [];
    if (images && Array.isArray(images)) {
      imageList = images;
    } else if (image) {
      imageList = [{ data: image, mimeType: mimeType || 'image/jpeg', label: 'Single Shot' }];
    }

    if (imageList.length === 0) {
      return res.status(400).json({ error: "Missing image data" });
    }

    const ai = getAIClient();

    // Convert base64 images into Gemini format parts
    const imageParts = imageList.map((img, idx) => {
      const rawBase64 = img.data.includes('base64,') 
        ? img.data.split('base64,')[1] 
        : img.data;
      
      return {
        inlineData: {
          mimeType: img.mimeType || 'image/jpeg',
          data: rawBase64
        }
      };
    });

    // Detailed description of each shot to pass to the model
    const shotDetails = imageList.map((img, idx) => {
      return `Image ${idx + 1}: Labelled as "${img.label || 'Unknown Shot'}"`;
    }).join('\n');

    const promptText = `You are a high-precision, industrial product intelligence scanner.
Analyze the provided product package images as a SINGLE set belonging to ONE product. Do NOT treat them as separate or unrelated products.

Details of the images uploaded:
${shotDetails}

Carefully extract and merge information across all photos.
Guidelines for extraction:
1. Compare information across all images to form a single, cohesive, consolidated report.
2. If the same field appears in multiple images, prefer the clearer and more detailed text.
3. Resolve duplicate information.
4. If there are contradictions or conflicts between images (e.g. different expiry dates, or conflicting nutrition facts):
   - Prefer the clearest readable info.
   - If unresolved, mark it in the 'conflicting_fields' array, and return the most reliable readable value in the field.
5. Do NOT guess or fabricate missing information. If a field is not clearly visible or readable in any image, return null.
6. Barcode digits must only be returned if they are clearly readable. Never guess barcode digits.

Extract the following fields strictly matching the JSON schema:
- product_found: Boolean indicating if a product is clearly identified in the pictures.
- product_name: Full product name.
- brand: Manufacturer or brand name.
- barcode: Exact barcode text digits (ONLY if clearly legible).
- category: Food, Beverage, Cosmetic, Medicine, Electronics, Household, General, etc.
- product_description: A brief paragraph describing the product's attributes, marketing claims, and visual properties as seen.
- mrp: Maximum Retail Price (e.g. "$1.99", "Rs. 250").
- selling_price: Direct discounted or retail selling price if printed.
- quantity: Numerical quantity value only (e.g., 500, 1.5, 12).
- unit: Measurement unit (e.g., ml, g, kg, L, oz, count).
- manufacture_date: Manufacture date as readable text or ISO format.
- expiry_date: Expiry date as readable text or ISO format.
- best_before: Best before details if printed.
- batch_number: Batch, Lot, or SKU index.
- manufacturer: Full manufacturer company name.
- country_of_origin: Country where manufactured (e.g. "Made in India", "Product of USA").
- ingredients: Array of strings listing ingredients (if applicable). Leave as empty array if not.
- allergens: Allergen warnings (e.g. "Contains nuts", "Gluten-free").
- nutrition_information: Key nutrition info (calories, fats, proteins, etc.) as a summary.
- storage_instructions: Specific storage directives (e.g. "Keep refrigerated", "Store in cool dry place").
- warnings: Any safety warnings or side effects.
- confidence: Your overall confidence score (0-100) based on image quality and data legibility.
- information_sources: For every field extracted, specify which image (e.g. "Image 1: Front", "Image 3: Side") verified it.
- conflicting_fields: List any fields where different images showed conflicting or contradicting information, along with a description of the conflict.`;

    const response = await generateContentWithRetryAndFallback(ai, {
      contents: [...imageParts, promptText],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            product_found: { type: Type.BOOLEAN },
            product_name: { type: Type.STRING, nullable: true },
            brand: { type: Type.STRING, nullable: true },
            barcode: { type: Type.STRING, nullable: true },
            category: { type: Type.STRING, nullable: true },
            product_description: { type: Type.STRING, nullable: true },
            mrp: { type: Type.STRING, nullable: true },
            selling_price: { type: Type.STRING, nullable: true },
            quantity: { type: Type.STRING, nullable: true },
            unit: { type: Type.STRING, nullable: true },
            manufacture_date: { type: Type.STRING, nullable: true },
            expiry_date: { type: Type.STRING, nullable: true },
            best_before: { type: Type.STRING, nullable: true },
            batch_number: { type: Type.STRING, nullable: true },
            manufacturer: { type: Type.STRING, nullable: true },
            country_of_origin: { type: Type.STRING, nullable: true },
            ingredients: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            allergens: { type: Type.STRING, nullable: true },
            nutrition_information: { type: Type.STRING, nullable: true },
            storage_instructions: { type: Type.STRING, nullable: true },
            warnings: { type: Type.STRING, nullable: true },
            confidence: { type: Type.INTEGER },
            information_sources: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  field: { type: Type.STRING },
                  source: { type: Type.STRING }
                },
                required: ["field", "source"]
              }
            },
            conflicting_fields: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  field: { type: Type.STRING },
                  description: { type: Type.STRING }
                },
                required: ["field", "description"]
              }
            }
          },
          required: ["product_found", "confidence"]
        }
      }
    });

    const text = response.text;
    if (!text) {
      return res.status(500).json({ error: "Empty response from Gemini AI Model" });
    }

    const parsedData = JSON.parse(text);
    return res.json(parsedData);
  } catch (error) {
    console.error("Error analyzing product image:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
});

// Proxy route for Product Lookup by Barcode (Open Food Facts API)
app.get('/api/lookup-product', async (req, res) => {
  const { barcode } = req.query;
  if (!barcode) {
    return res.status(400).json({ error: "Missing barcode parameter" });
  }

  try {
    const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
    if (!response.ok) {
      return res.status(response.status).json({ error: "Open Food Facts lookup failed" });
    }

    const data = await response.json();
    if (data.status === 1 && data.product) {
      const p = data.product;
      // Extract ingredients as an array
      let ingredients = [];
      if (p.ingredients_text) {
        ingredients = p.ingredients_text
          .split(/,|\n/)
          .map(i => i.trim())
          .filter(i => i.length > 0 && !i.includes(':'));
      }

      const mappedProduct = {
        product_found: true,
        product_name: p.product_name || p.product_name_en || null,
        brand: p.brands || null,
        barcode: barcode,
        category: p.categories_tags && p.categories_tags.length > 0 ? p.categories_tags[0].replace('en:', '') : null,
        mrp: null, // Open Food Facts doesn't have prices/MRPs
        selling_price: null,
        quantity: p.quantity || null,
        unit: p.quantity ? p.quantity.replace(/[0-9]|\s/g, '') : null,
        manufacture_date: null,
        expiry_date: null,
        batch_number: null,
        ingredients: ingredients.slice(0, 15), // Limit ingredients for UI
        image_url: p.image_url || p.image_front_url || null,
        confidence: 100
      };
      return res.json(mappedProduct);
    } else {
      return res.json({ product_found: false, message: "Product not found in Open Food Facts database" });
    }
  } catch (error) {
    console.error("Error in product lookup:", error);
    return res.status(500).json({ error: "Failed to fetch from Open Food Facts database" });
  }
});

// Setup Vite middleware for development or static file serving for production
async function setupFrontend() {
  if (process.env.NODE_ENV !== "production") {
    console.log('[Vite Engine] Initializing Vite middleware for development...');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log('[Vite Engine] Initializing static files serving for production...');
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Product Scanner full-stack app running on port ${PORT}`);
  });
}

setupFrontend().catch(err => {
  console.error('[Vite Engine] Failed to start server:', err);
});
