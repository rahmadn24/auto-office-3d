# ADR 0009 — Driver LLM OpenAI-compatible + budget harian & estimasi biaya

- Status: Accepted (Fase 13)
- Konteks: strategi model = tier gratis/termurah dulu (bench gate ≥80%).
  Banyak provider murah memakai format OpenAI chat completions, bukan
  Anthropic; guardrail lama hanya 250k token per run sehingga pemakaian
  harian bisa membengkak tanpa terasa. Angka biaya per run tak terlihat.
- Keputusan:
  - Tambah `OpenAICompatLLM` (`POST {base}/chat/completions`) dengan env
    `OPENAI_COMPAT_API_KEY/BASE_URL/MODEL`; `LLM_DRIVER=openai-compat`.
  - Key terpisah dari `OPENAI_API_KEY` (embeddings) — embedding tidak pernah
    dipakai sebagai LLM chat tanpa sengaja.
  - Budget harian lintas-run `DAILY_TOKEN_BUDGET` (default 2.000.000, 0 =
    nonaktif): run baru ditolak `DailyBudgetExceededError` dengan pesan jelas
    + ack `ok:false`; status terekspos di `/health`, `system:hello`, dan event
    `budget:update` ke Theater.
  - Estimasi biaya per run dari tabel harga benchmark
    (`brain/src/llm/pricing.ts`) memakai pemisahan token input/output
    `TokenBudget.usage`; tampil di CLI run + `artifacts:ready.costUsd`.
- Konsekuensi: ganti provider murah tanpa mengubah graph; pembengkakan harian
  terlihat dan terhenti otomatis; laporan run menyertakan biaya perkiraan
  (model tanpa harga → `n/a`).
