# gw-sync-cron — Relógio do GWMS Sync (Cloudflare Worker)

Dispara o `gwms-sync` do GitHub a cada 2 min. Substitui o cron-job.org e o
`schedule` (não-confiável) do GitHub Actions. **Custo: zero** (Cloudflare free).

## O que você precisa antes

Um **PAT do GitHub** (fine-grained) com:
- Repository access: **`ssg-create/ssg-dashboard`**
- Permissão: **Actions → Read and write**

(Pode ser o mesmo `GH_PAT_CROSS_REPO`, desde que tenha Actions: write nesse repo.
Se não tiver, crie um novo em GitHub → Settings → Developer settings →
Fine-grained tokens.)

## Deploy SEM terminal (pela dashboard — recomendado)

1. Crie conta grátis em **dash.cloudflare.com** (não precisa cartão).
2. Menu lateral → **Workers & Pages** → **Create** → **Create Worker**.
3. Dê o nome `gw-sync-cron` → **Deploy** (cria um worker "hello world").
4. **Edit code** → apague tudo → cole o conteúdo de `worker.js` → **Deploy**.
5. **Settings → Variables and Secrets** → **Add** → tipo **Secret**:
   - Name: `GH_DISPATCH_PAT`  ·  Value: (cole o PAT)  → **Save and deploy**.
6. **Settings → Triggers → Cron Triggers** → **Add** → `*/2 * * * *` → **Add**.
7. **Testar:** abra a URL do worker (`https://gw-sync-cron.<seu-subdominio>.workers.dev`).
   Deve responder **"OK — sync disparado (204)"**. Vá no GitHub → Actions → GWMS Sync:
   uma run nova deve aparecer disparada pelo dono do PAT.

## Deploy COM terminal (alternativa)

```
npm i -g wrangler
cd cloudflare-worker
wrangler login
wrangler secret put GH_DISPATCH_PAT   # cola o PAT quando pedir
wrangler deploy
```

## Como verificar que está vivo

- GitHub → Actions → **GWMS Sync**: runs novas a cada ~2 min (Actor = dono do PAT).
- Painel: o rodapé "Sync há N min" fica sempre baixo.
- Cloudflare → Worker → **Logs** (Real-time) mostra cada disparo.

## Se precisar parar

Cloudflare → Worker → Settings → Triggers → remover o Cron. (O Watchdog do
GitHub continua como rede de segurança.)
