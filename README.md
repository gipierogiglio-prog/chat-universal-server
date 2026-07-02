# Chat Universal

Chat web em tempo real estilo Telegram — **sem número de celular**. Autenticação por email/usuário + senha, mensagens via WebSocket, envio de arquivos e imagens, grupos, e webhooks para integração com **Hermes Agent** e **OpenClaw**.

## Stack

- **Backend:** Node.js + TypeScript, Express, Socket.IO, Prisma (PostgreSQL)
- **Frontend:** React + TypeScript (Vite), dark mode, layout responsivo
- **Infra:** Docker Compose (app + PostgreSQL)
- **Segurança:** JWT, bcrypt, rate limiting, validação com Zod, API keys para webhooks

## Rodando com Docker (produção)

```bash
cp .env.example .env   # edite JWT_SECRET e as API keys!
docker compose up --build -d
```

Acesse **http://localhost:3001**. O frontend é servido pelo próprio backend.

## Desenvolvimento local

```bash
# 1. Banco (PostgreSQL via Docker)
docker compose up db -d

# 2. Backend
cd server
cp .env.example .env
npm install
npx prisma db push        # cria as tabelas
npm run dev               # http://localhost:3001

# 3. Frontend (outro terminal)
cd client
npm install
npm run dev               # http://localhost:5173 (proxy para o backend)
```

## API REST

Todas as rotas autenticadas exigem o header `Authorization: Bearer <token>`.

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/register` | `{email, username, password, displayName?}` → `{token, user}` |
| POST | `/api/auth/login` | `{identifier, password}` (email ou username) → `{token, user}` |
| GET | `/api/auth/me` | Usuário autenticado |
| GET | `/api/users/search?q=` | Busca usuários por email/username/nome |
| GET | `/api/contacts` | Lista contatos |
| POST | `/api/contacts` | `{userId}` — adiciona contato |
| DELETE | `/api/contacts/:id` | Remove contato |
| GET | `/api/conversations` | Lista conversas (com última mensagem) |
| POST | `/api/conversations` | `{type:"direct", userId}` ou `{type:"group", name, memberIds}` |
| GET | `/api/conversations/:id/messages?cursor=&limit=` | Histórico paginado |
| POST | `/api/conversations/:id/messages` | `{type, content, fileUrl?, fileName?, fileSize?}` — envio programático |
| POST | `/api/conversations/:id/members` | `{userId}` — adiciona membro ao grupo (admin) |
| POST | `/api/uploads` | multipart `file` → `{url, fileName, fileSize, mimeType}` (máx. 20 MB) |
| GET | `/api/health` | Healthcheck |

### Exemplo: enviar mensagem programaticamente

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"alice","password":"senha1234"}' | jq -r .token)

curl -X POST http://localhost:3001/api/conversations/<conv_id>/messages \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"text","content":"Olá via API!"}'
```

## Webhooks de integração

Autenticados pelo header `x-api-key` (valores em `HERMES_API_KEY` / `OPENCLAW_API_KEY`). O bot da integração é criado automaticamente e a mensagem chega ao usuário em tempo real numa conversa direta com o bot.

### Hermes Agent — `POST /api/webhooks/hermes`

```bash
curl -X POST http://localhost:3001/api/webhooks/hermes \
  -H 'x-api-key: hermes-secret-key' -H 'Content-Type: application/json' \
  -d '{"target_user": "alice", "message": "Deploy concluído ✅", "type": "notification"}'
```

### OpenClaw — `POST /api/webhooks/openclaw`

```bash
curl -X POST http://localhost:3001/api/webhooks/openclaw \
  -H 'x-api-key: openclaw-secret-key' -H 'Content-Type: application/json' \
  -d '{"target_user": "alice@example.com", "message": "Nova tarefa atribuída"}'
```

**Payload:** `{target_user, message, type?}` — `target_user` aceita email ou username; `type` é `"text"` (padrão) ou `"notification"`.

**Resposta:** `{ok: true, message_id, conversation_id}` · Erros: `401` API key inválida, `404` usuário não encontrado.

## WebSocket (Socket.IO)

Conexão: `io("/", { auth: { token: "<jwt>" } })`

| Evento | Direção | Payload |
|---|---|---|
| `message:send` | cliente → servidor | `{conversationId, type, content, fileUrl?, ...}` + ack `{ok, message}` |
| `message:new` | servidor → cliente | `Message` (para todos os membros da conversa) |
| `conversation:new` | servidor → cliente | `Conversation` (nova conversa/grupo) |
| `conversation:updated` | servidor → cliente | `Conversation` (membros alterados) |
| `typing` | ambos | `{conversationId}` → `{conversationId, userId}` |

## Segurança

- Senhas com bcrypt (custo 10); JWT expira em 7 dias
- Rate limiting: 300 req/min geral, 30 req/15min em `/api/auth`, 60 req/min em webhooks
- Validação de entrada com Zod em todas as rotas e eventos de socket
- Uploads com nome aleatório (sem path traversal) e limite de 20 MB
- Webhooks exigem API key; bots não podem fazer login

## Estrutura

```
├── docker-compose.yml    # app + PostgreSQL
├── Dockerfile            # build multi-stage (client + server)
├── server/               # Express + Socket.IO + Prisma (TypeScript)
│   ├── prisma/schema.prisma
│   └── src/
│       ├── index.ts      # bootstrap, middlewares, rate limits
│       ├── socket.ts     # eventos WebSocket
│       ├── routes/       # auth, users, contacts, conversations, uploads, webhooks
│       └── lib/          # entrega de mensagens, validação, singleton do io
└── client/               # React + Vite (TypeScript)
    └── src/components/   # AuthPage, ChatApp, Sidebar, ChatPanel, ...
```
