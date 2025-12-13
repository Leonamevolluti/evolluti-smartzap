# SmartZap — Guia de Configuração

Este guia existe para uma coisa: colocar o SmartZap funcionando.

Você tem dois caminhos:

- **Vercel + Wizard (recomendado para produção):** siga o passo a passo abaixo.
- **Localhost (desenvolvimento):** vá para **[Rodar localmente](#rodar-localmente-localhost)**.

> **Nota de segurança:** as imagens deste guia são **sanitizadas** (tokens/chaves/e-mail/telefone ficam mascarados). Se você adicionar prints novos, não comite segredos.

---

## Sumário

- [Pré-requisitos](#pre-requisitos)
- [Vercel + Wizard (recomendado)](#vercel--wizard-recomendado)
    - [1. Fork no GitHub](#1-fork-no-github)
    - [2. Deploy na Vercel](#2-deploy-na-vercel)
    - [3. Coletar credenciais](#3-coletar-credenciais)
    - [4. Rodar o Wizard](#4-rodar-o-wizard)
    - [5. Finalizar e logar](#5-finalizar-e-logar)
    - [6. Prova de vida](#6-prova-de-vida)
- [Rodar localmente (localhost)](#rodar-localmente-localhost)
- [Troubleshooting](#troubleshooting)
- [Apêndice: prints](#apendice-prints)

---

<a id="pre-requisitos"></a>

## Pré-requisitos

Crie conta (gratuita) e deixe aberto em outra aba:

| Serviço | Para quê | Link |
| --- | --- | --- |
| GitHub | Código / fork | <https://github.com> |
| Vercel | Deploy | <https://vercel.com> |
| Supabase | Banco de dados | <https://supabase.com> |
| Upstash (QStash) | Fila/workflows | <https://upstash.com> |

---

<a id="vercel--wizard-recomendado"></a>

## Vercel + Wizard (recomendado)

### 1. Fork no GitHub

Faça o fork:

- <https://github.com/thaleslaray/smartzap/fork>

<details>
    <summary><strong>Manter seu fork atualizado (opcional)</strong></summary>

1. Abra seu repositório `smartzap` no GitHub.
2. Clique em **Sincronizar fork** → **Atualizar branch**.

Se você já alterou arquivos e ocorrer conflito, resolva com calma (ou peça ajuda) antes de continuar.

</details>

---

### 2. Deploy na Vercel

1. Acesse <https://vercel.com> e faça login.
2. **Add New → Project**.
3. Selecione o repositório `smartzap` (seu fork).
4. Clique em **Deploy**.

<details>
    <summary><strong>Ver prints do deploy (opcional)</strong></summary>

1. **Add New Project**
     ![Vercel — Add New Project (print sanitizado)](./image.png)

2. **Importar repositório**
     ![Vercel — selecionar repositório (print sanitizado)](./image-1.png)

3. **Deploy**
     ![Vercel — Deploy (print sanitizado)](./image-2.png)

4. **Dashboard**
     ![Vercel — Continue to Dashboard (print sanitizado)](./image-3.png)

5. **Domains (copiar URL)**
     ![Vercel — Domains (print sanitizado)](./image-4.png)

</details>

---

### 3. Coletar credenciais

Você vai usar estas chaves no Wizard.

#### Supabase

1. Supabase → **Project Settings → API**.
2. Copie:
     - `Project URL` (ex.: `https://abc123.supabase.co`)
     - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...` (ou `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`)
     - `SUPABASE_SECRET_KEY=sb_secret_...`

<details>
    <summary><strong>Ver print (opcional)</strong></summary>

![Supabase — API keys (print sanitizado)](./image-12.png)

Se o Supabase pedir connection string, use “Transaction pooler”:

![Supabase — Transaction pooler (print sanitizado)](./image-13.png)

</details>

#### QStash (Upstash)

1. Upstash → **QStash**.
2. No bloco **Quickstart**, copie `QSTASH_TOKEN`.

<details>
    <summary><strong>Ver print (opcional)</strong></summary>

![QStash — Quickstart (print sanitizado)](./image-16.png)

</details>

> **Importante:** para este setup você só precisa do `QSTASH_TOKEN`.

#### Token da Vercel

1. Vercel → **Settings → Tokens**.
2. Crie um token com **Scope: Full Account**.
3. Copie o token (ele aparece uma única vez).

<details>
    <summary><strong>Ver prints (opcional)</strong></summary>

![Vercel — Tokens (print sanitizado)](./image-5.png)
![Vercel — Create Token (print sanitizado)](./image-6.png)
![Vercel — Token Created (print sanitizado)](./image-7.png)

</details>

#### WhatsApp (opcional)

Se você já tiver Meta/WhatsApp Cloud API:

- `WHATSAPP_TOKEN`
- `WHATSAPP_PHONE_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`

---

### 4. Rodar o Wizard

1. Abra: `https://SEU-PROJETO.vercel.app/setup`
2. Cole o token da Vercel.
3. Siga os passos.

> **Crítico:** no passo do Supabase, clique em **Verificar e Migrar**.

<details>
    <summary><strong>Ver prints do Wizard (opcional)</strong></summary>

![Wizard — confirmar projeto (print sanitizado)](./image-8.png)

![Wizard — senha mestra (print sanitizado)](./image-9.png)

![Wizard — Supabase (dados) (print sanitizado)](./image-14.png)

![Wizard — Supabase (connect/migrar) (print sanitizado)](./image-10.png)

![Wizard — framework do app (print sanitizado)](./image-11.png)

![Wizard — continuar (print sanitizado)](./image-15.png)

![QStash — etapa no Wizard (print sanitizado)](./image-17.png)

![Wizard — WhatsApp Cloud API (print sanitizado)](./image-20.png)

![Wizard — seus dados (finalização) (print sanitizado)](./image-22.png)

</details>

---

### 5. Finalizar e logar

Depois do Wizard, a Vercel faz um novo deploy. Ao finalizar, você cai no `/login`.

---

### 6. Prova de vida

1. **Contatos** → crie um contato (use seu número para teste).
2. **Campanhas** → crie uma campanha e envie uma mensagem curta.

---

## Rodar localmente (localhost)

1. `npm install`
2. `cp .env.example .env.local`
3. Preencha no `.env.local`:
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (ou `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`)
     - `SUPABASE_SECRET_KEY`
4. No Supabase (SQL Editor): rode `lib/migrations/0001_initial_schema.sql`
5. `npm run dev` e abra `http://localhost:3000`

---

<a id="troubleshooting"></a>

## Troubleshooting

### Supabase 403 (42501) “permission denied for table”

Isso costuma acontecer quando as tabelas foram criadas, mas os **GRANTs** não foram aplicados.

**Solução:** no Supabase (SQL Editor), execute `lib/migrations/0001_initial_schema.sql` até o final (inclui a seção **PERMISSIONS**).

### App abre, mas rotas falham / tabelas não existem

Você não migrou.

- No Vercel/Wizard: volte no `/setup` e clique em **Verificar e Migrar**.
- No local: rode `lib/migrations/0001_initial_schema.sql`.

### Campanhas não disparam

Checklist:

- `QSTASH_TOKEN` configurado no ambiente correto (Production vs Preview vs Local).
- Depois de alterar variáveis de ambiente na Vercel, faça redeploy (ou aguarde o deploy disparado pelo Wizard).
- Se você está em localhost: reinicie o servidor após alterar `.env.local`.

---

<a id="apendice-prints"></a>

## Apêndice: prints

As imagens ficam em `docs/`.

### Vercel — Deploy

![Vercel — Add New Project (print sanitizado)](./image.png)
![Vercel — selecionar repositório (print sanitizado)](./image-1.png)
![Vercel — Deploy (print sanitizado)](./image-2.png)
![Vercel — Continue to Dashboard (print sanitizado)](./image-3.png)
![Vercel — Domains (print sanitizado)](./image-4.png)

### Vercel — Token

![Vercel — Tokens (print sanitizado)](./image-5.png)
![Vercel — Create Token (print sanitizado)](./image-6.png)
![Vercel — Token Created (print sanitizado)](./image-7.png)

### Supabase

![Supabase — API keys (print sanitizado)](./image-12.png)
![Supabase — Transaction pooler (print sanitizado)](./image-13.png)

### QStash

![QStash — Quickstart (print sanitizado)](./image-16.png)
![QStash — etapa no Wizard (print sanitizado)](./image-17.png)

### Wizard

![Wizard — confirmar projeto (print sanitizado)](./image-8.png)
![Wizard — senha mestra (print sanitizado)](./image-9.png)
![Wizard — Supabase (dados) (print sanitizado)](./image-14.png)
![Wizard — Supabase (connect/migrar) (print sanitizado)](./image-10.png)
![Wizard — framework do app (print sanitizado)](./image-11.png)
![Wizard — continuar (print sanitizado)](./image-15.png)
![Wizard — WhatsApp Cloud API (print sanitizado)](./image-20.png)
![Wizard — seus dados (finalização) (print sanitizado)](./image-22.png)

---

## Suporte

- Grupo: <https://chat.whatsapp.com/K24Xek8pinPBwzOU7H4DCg?mode=hqrt1>

_Versão 4.0 — 12/2025_
