export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  const barcode = String(req.query?.barcode || '').trim();
  if (!barcode) {
    return res.status(400).json({ error: 'Missing barcode parameter' });
  }

  try {
    const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(barcode)}.json`);
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Open Food Facts lookup failed' });
    }

    const data = await response.json();
    if (data.status === 1 && data.product) {
      const p = data.product;
      const ingredients = p.ingredients_text
        ? p.ingredients_text.split(/,|\n/).map(i => i.trim()).filter(i => i && !i.includes(':')).slice(0, 15)
        : [];

      return res.status(200).json({
        product_found: true,
        product_name: p.product_name || p.product_name_en || null,
        brand: p.brands || null,
        barcode,
        category: p.categories_tags?.[0]?.replace('en:', '') || null,
        mrp: null,
        selling_price: null,
        quantity: p.quantity || null,
        unit: p.quantity ? p.quantity.replace(/[0-9]|\s/g, '') : null,
        manufacture_date: null,
        expiry_date: null,
        batch_number: null,
        ingredients,
        image_url: p.image_url || p.image_front_url || null,
        confidence: 100
      });
    }

    return res.status(200).json({
      product_found: false,
      message: 'Product not found in Open Food Facts database'
    });
  } catch (error) {
    console.error('[Product Lookup API]', error);
    return res.status(500).json({ error: 'Failed to fetch from Open Food Facts database' });
  }
}
