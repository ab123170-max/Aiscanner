import { GoogleGenAI, Type } from '@google/genai';

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

function sendJson(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed. Use POST.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const image = body?.image;
    const mimeType = body?.mimeType || 'image/jpeg';

    if (!image) {
      return sendJson(res, 400, { error: 'Missing image data' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return sendJson(res, 500, {
        error: 'GEMINI_API_KEY is not configured on the server.'
      });
    }

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `Analyze the provided product package image. Extract only information that is clearly visible and readable. NEVER guess, infer, fabricate, or invent product information or barcode digits. If a field is not clearly visible, return null.

Return these fields:
- product_found: true only when a real product is identifiable
- product_name: full visible product name
- brand: visible brand/manufacturer
- barcode: barcode digits only when actually readable in the image
- category: product category
- mrp: printed maximum retail price
- selling_price: printed selling/discounted price
- quantity: numeric quantity as printed
- unit: unit such as g, kg, ml, L, pcs
- manufacture_date: visible manufacturing date
- expiry_date: visible expiry/best-before date
- batch_number: visible batch/lot number
- ingredients: visible ingredients as an array; [] if none or unreadable
- confidence: integer 0-100 representing confidence in the extraction

For dates, preserve the printed text when the exact date format is uncertain. If the image is not a product or is too unclear to identify, set product_found to false and use null/empty values.`;

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          inlineData: {
            mimeType,
            data: image
          }
        },
        prompt
      ],
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
          required: ['product_found']
        }
      }
    });

    const text = response.text;
    if (!text) {
      return sendJson(res, 502, { error: 'Gemini returned an empty response.' });
    }

    let result;
    try {
      result = JSON.parse(text);
    } catch {
      return sendJson(res, 502, { error: 'Gemini returned invalid JSON.' });
    }

    return sendJson(res, 200, result);
  } catch (error) {
    console.error('[AI Vision API]', error);
    return sendJson(res, 500, {
      error: error?.message || 'AI Vision request failed.'
    });
  }
}
