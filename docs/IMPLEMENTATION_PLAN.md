# 🏢 SEO Life — Self-Executive Office
## Plano de Implementação Completo

---

## 📋 Visão Geral

Um escritório virtual pixelado onde **agentes de IA autônomos** gerenciam a vida do dono.
Cada agente tem uma profissão, personalidade, memória, e pode operar no mundo real
(código, finanças, blockchain, design, comunicação).

---

## 🏛️ Organograma do Escritório (18 funcionários)

### Diretoria
| # | Cargo | Sala | Modelo Sugerido |
|---|-------|------|-----------------|
| 1 | **CEO (Chief Executive Officer)** | Privativa | claude-sonnet-4 |
| 2 | **CFO (Chief Financial Officer)** | Privativa | gpt-4o |
| 3 | **CTO (Chief Technology Officer)** | Principal | claude-sonnet-4 |

### Departamento Financeiro
| # | Cargo | Modelo |
|---|-------|--------|
| 4 | **Contador** | gpt-4o-mini |
| 5 | **Tesoureiro (Contas a Pagar/Receber)** | gpt-4o-mini |
| 6 | **Gestor de Investimentos / Crypto Trader** | gpt-4o |
| 7 | **Advogado** | gpt-4o |

### Departamento Técnico
| # | Cargo | Modelo |
|---|-------|--------|
| 8 | **Dev Fullstack** | claude-sonnet-4 |
| 9 | **Dev Frontend** | gpt-4o-mini |
| 10 | **DevOps / Infra** | gpt-4o-mini |
| 11 | **QA Tester** | gpt-4o-mini |

### Departamento Criativo
| # | Cargo | Modelo |
|---|-------|--------|
| 12 | **Designer Gráfico** | gpt-4o |
| 13 | **Redator / Copywriter** | gpt-4o-mini |
| 14 | **Social Media Manager** | gpt-4o-mini |

### Suporte
| # | Cargo | Modelo |
|---|-------|--------|
| 15 | **Gerente de Projetos** | gpt-4o-mini |
| 16 | **Assistente Pessoal** | gpt-4o-mini |
| 17 | **Pesquisador Web** | gpt-4o-mini |
| 18 | **Gerente de Compromissos** | gpt-4o-mini |

---

## 🧠 Arquitetura do Brain Engine

### Ciclo de Vida (Agent Loop) — Roda a cada 30-60s

```
┌─────────────────────────────────────────────────┐
│                  AGENT LOOP                      │
│                                                  │
│  1. 📥 PERCEBER                                  │
│     - Checar inbox (mensagens de outros agentes) │
│     - Checar tarefas pendentes                   │
│     - Checar eventos/agenda                      │
│                                                  │
│  2. 🧠 PENSAR (LLM Call via OpenRouter)          │
│     - System Prompt (personalidade + role)        │
│     - Context: memória + inbox + tarefas          │
│     - Output: JSON com ação a tomar               │
│                                                  │
│  3. 📤 AGIR                                      │
│     - Executar ferramenta (tool)                  │
│     - Enviar mensagem para outro agente           │
│     - Solicitar aprovação humana se necessário    │
│     - Criar sub-tarefa para subordinado           │
│                                                  │
│  4. 💾 MEMORIZAR                                  │
│     - Salvar resultado na memória curta           │
│     - Periodicamente: resumir em memória longa    │
│                                                  │
│  5. 💬 REPORTAR                                   │
│     - Atualizar status visual (balãozinho)        │
│     - Enviar relatório ao superior se necessário  │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Níveis de Permissão

| Nível | Descrição | Exemplos |
|-------|-----------|----------|
| 🟢 **AUTO** | Pode fazer sozinho | Pesquisar, escrever, calcular |
| 🟡 **NOTIFY** | Faz e avisa o dono | Enviar email, criar arquivo |
| 🔴 **APPROVE** | Precisa de aprovação | Transação crypto, deploy, gasto > $50 |

---

## 🛠️ Sistema de Ferramentas (Tools)

### Ferramentas Básicas (Fase 1)
- `think` — Refletir internamente
- `send_message` — Enviar mensagem para outro agente
- `ask_human` — Pedir algo ao dono (aparece como notificação)
- `create_task` — Criar tarefa para si ou subordinado
- `search_web` — Pesquisar na internet
- `read_file` / `write_file` — Ler/escrever arquivos

### Ferramentas Avançadas (Fase 2)
- `run_code` — Executar código no Docker sandbox
- `send_email` — Enviar email
- `generate_image` — Gerar imagem via DALL-E
- `manage_calendar` — Criar/editar compromissos
- `create_invoice` — Gerar nota fiscal / fatura

### Ferramentas Blockchain (Fase 3)
- `check_balance` — Ver saldo de carteira crypto
- `send_crypto` — Enviar transação (🔴 REQUER APROVAÇÃO)
- `swap_tokens` — Trocar tokens em DEX (🔴 REQUER APROVAÇÃO)  
- `check_portfolio` — Ver alocação de investimentos
- `monitor_market` — Acompanhar preços e tendências

---

## 💬 Sistema de Chat Inter-Agentes

### Tabela: messages
```sql
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    from_agent_id TEXT,
    to_agent_id TEXT,      -- NULL = broadcast
    content TEXT,
    type TEXT DEFAULT 'chat', -- chat, task, approval, report
    read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Fluxo Visual
1. Agente envia mensagem → salva no banco
2. Backend emite WebSocket → frontend recebe
3. Frontend mostra balãozinho sobre o personagem (2-5 seg)
4. Mensagens ficam no histórico acessível pela UI

---

## 📅 Fases de Implementação

### ✅ Fase 0 — Infraestrutura (COMPLETA)
- [x] Backend Express + Socket.IO
- [x] Frontend React desacoplado
- [x] Banco de dados SQLite
- [x] CRUD de agentes via API REST
- [x] Layout do escritório grande com partições
- [x] Multi-idioma (PT padrão)
- [x] Contratar / Demitir agentes

### 🔨 Fase 1 — Brain Engine (PRÓXIMA)
- [ ] Classe `AgentBrain` no backend
- [ ] Integração OpenRouter (LLM call)
- [ ] System prompts por profissão
- [ ] Agent Loop básico (perceber → pensar → agir)
- [ ] Tabela `messages` para chat inter-agentes
- [ ] Balõezinhos de chat no canvas
- [ ] Tool: `send_message`, `think`, `ask_human`
- [ ] Notificações para o dono (pedidos de aprovação)

### 🔨 Fase 2 — Ferramentas Básicas
- [ ] Tool: `search_web`
- [ ] Tool: `run_code` (Docker sandbox)
- [ ] Tool: `read_file` / `write_file`
- [ ] Tool: `send_email`
- [ ] Tool: `generate_image`
- [ ] Tool: `manage_calendar`
- [ ] Sistema de permissões (auto/notify/approve)
- [ ] Memória de longo prazo

### 🔨 Fase 3 — Blockchain & Finanças
- [ ] Integração Web3 (ethers.js)
- [ ] Tool: `check_balance`, `check_portfolio`
- [ ] Tool: `send_crypto` (com aprovação)
- [ ] Tool: `swap_tokens`, `monitor_market`
- [ ] Dashboard financeiro na UI
- [ ] Relatórios automáticos do CFO

### 🔨 Fase 4 — Autonomia Total
- [ ] Agentes pensam e agem sozinhos periodicamente
- [ ] CEO delega automaticamente baseado em prioridades
- [ ] Relatório diário automático para o dono
- [ ] Agentes aprendem com feedback (memória adaptativa)
- [ ] Criação autônoma de novos projetos
---
