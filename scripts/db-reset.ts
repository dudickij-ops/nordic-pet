import { spawnSync } from 'node:child_process'

import { projectDatabaseUrl } from '../lib/db-url.ts'

/**
 * Пересоздание базы. Обёртка вокруг `supabase db reset` нужна ровно за одним:
 * адрес проходит проверку до того, как команда что-нибудь снесёт.
 */
let url: string
try {
  url = projectDatabaseUrl()
} catch (error) {
  console.error(`пересоздание базы отменено: ${(error as Error).message}`)
  process.exit(1)
}

const result = spawnSync('supabase', ['db', 'reset', '--yes', '--db-url', url], {
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
