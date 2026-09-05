import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Allow large image uploads
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Serve static assets from root directory
app.use(express.static(__dirname));

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

// REST API for AI Product analysis
app.post('/api/analyze-product', async (req, res) => {
  try {
    const { image, mimeType } = req.body;
    if (!image) {
      return res.status(400).json({ error: "Missing image data" });
    }

    const ai = getAIClient();

    const imagePart = {
      inlineData: {
        mimeType: mimeType || 'image/jpeg',
        data: image
      }
    };

    const promptText = `Analyze the provided product package image. Carefully extract the following fields. Do NOT guess or invent data. If any field is not clearly visible or legible, return null for it.

Fields to extract:
- product_name: Full name of the product
- brand: Manufacturer or brand name
- barcode: The text digits of the barcode if visible
- category: Product category (e.g., Food, Beverage, Cosmetic, Medicine, Electronics, Household, etc.)
- mrp: Maximum Retail Price if printed (e.g. "Rs. 50", "$1.99")
- selling_price: Any specific discounted or selling price if printed
- quantity: Numerical quantity (e.g. 500, 1.5, 10)
- unit: Measurement unit (e.g. ml, g, kg, L, pcs)
- manufacture_date: Manufacture date as readable text or ISO format
- expiry_date: Expiry date as readable text or ISO format
- batch_number: Batch or Lot number
- ingredients: List of ingredients in an array (if food/beverage/cosmetic/medicine). Leave empty array if none.
- confidence: Your confidence score between 0 and 100 for this extraction as an integer.

If the product is not identifiable or the image is unreadable, set product_found to false. Otherwise, set product_found to true.`;

    const response = await generateContentWithRetryAndFallback(ai, {
      contents: [imagePart, promptText],
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
            mrp: { type: Type.STRING, nullable: true },
            selling_price: { type: Type.STRING, nullable: true },
            quantity: { type: Type.STRING, nullable: true },
            unit: { type: Type.STRING, nullable: true },
            manufacture_date: { type: Type.STRING, nullable: true },
            expiry_date: { type: Type.STRING, nullable: true },
            batch_number: { type: Type.STRING, nullable: true },
            ingredients: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            confidence: { type: Type.INTEGER }
          },
          required: ["product_found"]
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

// Fallback all other routes to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Product Scanner backend running on port ${PORT}`);
});
