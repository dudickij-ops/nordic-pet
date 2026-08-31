import { resolveCommit } from '@/lib/commit'

export default function HealthPage() {
  return (
    <main>
      <h1>Состояние</h1>
      <p>
        Коммит: <code>{resolveCommit()}</code>
      </p>
    </main>
  )
}
