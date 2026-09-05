/**
 * Main Vite application entry point.
 * Imports global styles and initializes the App controller.
 */

import './styles.css';
import './App.js';

// Verify and log Supabase environment variable integration support
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log('[Vite Engine] Supabase variables initialized:', {
  urlConfigured: !!supabaseUrl,
  keyConfigured: !!supabaseAnonKey
});

// Export them for any future/current integration code to read directly
export const supabaseConfig = {
  url: supabaseUrl || null,
  anonKey: supabaseAnonKey || null
};
