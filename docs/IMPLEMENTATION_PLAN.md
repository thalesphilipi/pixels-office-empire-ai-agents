# 🏢 Pixels Office Empire — AI Agents Virtual Office
## Complete Implementation Plan

---

## 📋 Overview

A pixel-art virtual office where **autonomous AI agents** run the owner’s operations.
Each agent has a profession, personality, and memory, and can act in the real world
(code, finance, blockchain, design, communication).

---

## 🏛️ Office Org Chart (18 roles)

### Executive Team
| # | Role | Room | Suggested Model |
|---|------|------|-----------------|
| 1 | **CEO (Chief Executive Officer)** | Private | claude-sonnet-4 |
| 2 | **CFO (Chief Financial Officer)** | Private | gpt-4o |
| 3 | **CTO (Chief Technology Officer)** | Main | claude-sonnet-4 |

### Finance Department
| # | Role | Model |
|---|------|-------|
| 4 | **Accountant** | gpt-4o-mini |
| 5 | **Treasurer (Accounts Payable/Receivable)** | gpt-4o-mini |
| 6 | **Investments Manager / Crypto Trader** | gpt-4o |
| 7 | **Lawyer** | gpt-4o |

### Engineering Department
| # | Role | Model |
|---|------|-------|
| 8 | **Fullstack Developer** | claude-sonnet-4 |
| 9 | **Frontend Developer** | gpt-4o-mini |
| 10 | **DevOps / Infra** | gpt-4o-mini |
| 11 | **QA Tester** | gpt-4o-mini |

### Creative Department
| # | Role | Model |
|---|------|-------|
| 12 | **Graphic Designer** | gpt-4o |
| 13 | **Writer / Copywriter** | gpt-4o-mini |
| 14 | **Social Media Manager** | gpt-4o-mini |

### Support
| # | Role | Model |
|---|------|-------|
| 15 | **Project Manager** | gpt-4o-mini |
| 16 | **Personal Assistant** | gpt-4o-mini |
| 17 | **Web Researcher** | gpt-4o-mini |
| 18 | **Scheduling Manager** | gpt-4o-mini |

---

## 🧠 Brain Engine Architecture

### Lifecycle (Agent Loop) — Default cycle: 25s

```
┌─────────────────────────────────────────────────┐
│                   AGENT LOOP                     │
│                                                  │
│  1. 📥 PERCEIVE                                  │
│     - Check inbox (messages from other agents)    │
│     - Check pending tasks                         │
│     - Check events/schedule                       │
│                                                  │
│  2. 🧠 THINK (LLM call)                            │
│     - System Prompt (personality + role)          │
│     - Context: memory + inbox + tasks             │
│     - Output: JSON describing the next action     │
│                                                  │
│  3. 📤 ACT                                        │
│     - Run a tool                                  │
│     - Send messages to other agents               │
│     - Ask the human owner for approval if needed  │
│     - Create sub-tasks for other agents           │
│                                                  │
│  4. 💾 REMEMBER                                   │
│     - Save results into short-term memory         │
│     - Periodically summarize into long-term       │
│                                                  │
│  5. 💬 REPORT                                     │
│     - Update visual status (bubble/overlay)       │
│     - Report to a superior when needed            │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Permission Levels

| Level | Description | Examples |
|------:|-------------|----------|
| 🟢 **AUTO** | Can execute autonomously | Research, write, calculate |
| 🟡 **NOTIFY** | Executes and informs the owner | Send email, generate files |
| 🔴 **APPROVE** | Requires approval | Crypto transactions, deploys, spend > $50 |

---

## 🛠️ Tool System

### Core Tools (Phase 1)
- `think` — Internal reasoning
- `send_message` — Message another agent
- `ask_human` — Ask the owner for access/approval (notification)
- `create_task` — Delegate tasks to self or another agent
- `web_search` — Browse/search the web
- `read_file` / `write_file` — File operations

### Advanced Tools (Phase 2)
- `run_code` — Run code inside a sandbox
- `send_email` — Email sending
- `generate_image` — Image generation
- `manage_calendar` — Create/edit calendar events
- `create_invoice` — Generate invoices/receipts

### Blockchain Tools (Phase 3)
- `check_balance` — Check wallet balance
- `send_crypto` — Send a transaction (🔴 APPROVAL REQUIRED)
- `swap_tokens` — Swap tokens on a DEX (🔴 APPROVAL REQUIRED)
- `check_portfolio` — Portfolio allocation
- `monitor_market` — Prices and trend monitoring

---

## 💬 Inter-Agent Chat System

### Table: messages
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

### UI Flow
1. Agent sends a message → persisted in the database
2. Backend emits a WebSocket event → frontend receives it
3. Frontend shows a speech bubble over the character (2–5s)
4. Messages remain accessible in the UI history

---

## 📅 Implementation Phases

### ✅ Phase 0 — Infrastructure (DONE)
- [x] Express + Socket.IO backend
- [x] Decoupled React frontend
- [x] SQLite persistence
- [x] Agent CRUD via REST API
- [x] Large office layout with partitions
- [x] Multi-language (PT default)
- [x] Hire / fire agents

### ✅ Phase 1 — Brain Engine (DONE)
- [x] `AgentBrain` / orchestration in backend
- [x] LLM integration
- [x] Role-based system prompts
- [x] Basic agent loop (perceive → think → act)
- [x] `messages` table for inter-agent chat
- [x] Chat bubbles / real-time messaging
- [x] Owner notifications (human approval flow)

### 🔨 Phase 2 — Core Tools (IN PROGRESS)
- [ ] Web search
- [ ] Sandbox execution
- [ ] File read/write tools
- [ ] Email sending
- [ ] Image generation
- [ ] Calendar management
- [ ] Permission system (auto/notify/approve)
- [ ] Long-term memory

### 🔨 Phase 3 — Blockchain & Finance (PLANNED)
- [ ] Web3 integration
- [ ] `check_balance`, `check_portfolio`
- [ ] `send_crypto` (with approval)
- [ ] `swap_tokens`, `monitor_market`
- [ ] Financial dashboard in the UI
- [ ] Automated CFO reports

### 🔨 Phase 4 — Full Autonomy (PLANNED)
- [ ] Agents think and act periodically without prompts
- [ ] CEO auto-delegates based on priorities
- [ ] Automated daily report to the owner
- [ ] Agents learn from feedback (adaptive memory)
- [ ] Autonomous creation of new projects
---
