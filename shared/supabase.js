// ═══════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════
export const SUPABASE_URL = 'https://oklglgvhlqixzxngbsvw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rbGdsZ3ZobHFpeHp4bmdic3Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MzMxMjEsImV4cCI6MjA5NzEwOTEyMX0.o7f97GDLFxFQiZyEvFjDlMhNeCkpnFIr-YLC3gpH5F8';
export const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
