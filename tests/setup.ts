import { existsSync } from 'node:fs'

// Für den Supabase-Check gegen die echte DB; ohne .env.local wird er übersprungen.
if (existsSync('.env.local')) process.loadEnvFile('.env.local')
