// Läuft einmal beim Serverstart: startet die Hintergrund-Jobs (Bay-Vergabe für Termine, Whitelist-Abgleich).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startBackgroundJobs } = await import('./lib/background')
    startBackgroundJobs()
  }
}
