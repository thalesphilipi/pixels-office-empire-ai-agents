/**
 * AgentBrain — The core AI engine that gives life to each agent.
 */

import { db } from './db.js';
import { ToolManager } from './toolManager.js';
import crypto from 'crypto';

const toolManager = new ToolManager();

function stripThinkBlocks(text: string): string {
    if (!text) return '';
    return text
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<\/?think>/gi, '')
        .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
        .replace(/<\/?analysis>/gi, '');
}

function stripCodeFences(text: string): string {
    if (!text) return '';
    return text
        .replace(/```json/gi, '')
        .replace(/```/g, '');
}

function extractFirstJsonObject(text: string): string | null {
    const s = (text || '');
    let start = -1;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '{') {
            start = i;
            break;
        }
    }
    if (start < 0) return null;

    let depth = 0;
    inString = false;
    escaped = false;
    for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '{') depth++;
        if (ch === '}') {
            depth--;
            if (depth === 0) return s.slice(start, i + 1);
        }
    }
    return null;
}

function repairJsonStringNewlines(jsonText: string): string {
    const s = (jsonText || '');
    let out = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inString) {
            if (escaped) {
                escaped = false;
                out += ch;
                continue;
            }
            if (ch === '\\') {
                escaped = true;
                out += ch;
                continue;
            }
            if (ch === '"') {
                inString = false;
                out += ch;
                continue;
            }
            if (ch === '\n') {
                out += '\\n';
                continue;
            }
            if (ch === '\u2028' || ch === '\u2029') {
                out += '\\n';
                continue;
            }
            if (ch === '\r') {
                out += '\\r';
                continue;
            }
            if (ch === '\t') {
                out += '\\t';
                continue;
            }
            out += ch;
            continue;
        }

        if (ch === '"') {
            inString = true;
            out += ch;
            continue;
        }
        out += ch;
    }
    return out;
}

function normalizeThinkResult(raw: any): ThinkResult {
    const r = (raw || {}) as any;
    const actionRaw = (r.action || '').toString().trim().toLowerCase();
    let action = actionRaw;
    if (action === 'execute_tool' || action === 'execute_tool_now' || action === 'tool' || action === 'use-tool') action = 'use_tool';
    if (action === 'execute' && (r.tool_name || r.tool || r.toolName)) action = 'use_tool';
    if (action === 'web_search' || action === 'search_web' || action === 'search') action = 'use_tool';
    if (action === 'kb_save' || action === 'save_kb') action = 'use_tool';
    if (action === 'message' || action === 'send' || action === 'sendmessage') action = 'send_message';
    if (action === 'complete' || action === 'complete_task_now') action = 'complete_task';
    if (action === 'wait' || action === 'idle' || action === 'no_action') action = 'idle';
    if (actionRaw.startsWith('mcp_')) action = 'use_tool';

    let toolName = (r.tool_name || r.tool || r.toolName || '').toString().trim();
    let toolArgs = r.tool_args ?? r.toolArgs ?? r.args ?? r.tool_arguments ?? undefined;
    if (!toolName && actionRaw === 'web_search') toolName = 'web_search';
    if (!toolName && actionRaw === 'kb_save') toolName = 'kb_save';
    if (!toolName && actionRaw.startsWith('mcp_')) toolName = actionRaw;
    if (!toolArgs && toolName === 'web_search') {
        const q = (r.query ?? r.q ?? r.content ?? '').toString();
        toolArgs = { query: q };
    }

    const out: ThinkResult = {
        action: action || 'idle',
        thought: typeof r.thought === 'string' ? r.thought : undefined,
        content: typeof r.content === 'string' ? r.content : (r.content != null ? String(r.content) : undefined),
        target_agent_id: typeof r.target_agent_id === 'string' ? r.target_agent_id : undefined,
        participants_ids: Array.isArray(r.participants_ids) ? r.participants_ids : undefined,
        topic: typeof r.topic === 'string' ? r.topic : undefined,
        task_id: typeof r.task_id === 'string' ? r.task_id : undefined,
        tool_name: toolName || undefined,
        tool_args: toolArgs
    };

    const tn = (toolName || '').toString().trim().toLowerCase();
    if (out.action === 'use_tool' && (tn === 'complete_task' || tn === 'task_complete')) {
        out.action = 'complete_task';
        const tid = typeof toolArgs?.task_id === 'string' ? toolArgs.task_id : (toolArgs?.task_id != null ? String(toolArgs.task_id) : undefined);
        const c = typeof toolArgs?.content === 'string' ? toolArgs.content : (toolArgs?.content != null ? String(toolArgs.content) : undefined);
        out.task_id = out.task_id || tid;
        out.content = out.content || c;
        out.tool_name = undefined;
        out.tool_args = undefined;
    }
    if (out.action === 'use_tool' && tn === 'send_message') {
        out.action = 'send_message';
        const target = typeof toolArgs?.target_agent_id === 'string' ? toolArgs.target_agent_id : (typeof toolArgs?.to_agent_id === 'string' ? toolArgs.to_agent_id : undefined);
        const c = typeof toolArgs?.content === 'string' ? toolArgs.content : (toolArgs?.content != null ? String(toolArgs.content) : undefined);
        out.target_agent_id = out.target_agent_id || target;
        out.content = out.content || c;
        out.tool_name = undefined;
        out.tool_args = undefined;
    }
    return out;
}

function safeJsonPreview(value: any, maxLen: number = 420): string {
    const redactor = (k: string, v: any) => {
        const key = (k || '').toLowerCase();
        if (key.includes('password') || key.includes('token') || key.includes('secret') || key.includes('api_key') || key.includes('key_value')) {
            return '[redacted]';
        }
        return v;
    };
    let s = '';
    try {
        s = JSON.stringify(value, redactor);
    } catch (e) {
        s = String(value);
    }
    s = s.replace(/\s+/g, ' ').trim();
    return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

// ─── Constants & Intelligence Tiers ───────────────────────────────

const TIERS = {
    // Sua RTX 4060 com Qwen 3.5 é a ÚNICA fonte de inteligência
    PRIORITY_LOCAL: process.env.LLM_MODEL || 'qwen3.5-9b-claude-4.6-opus-distilled-32k',
    CLOUD_BACKUP: [] // Desativado
};

const AGENT_DNA: Record<string, string[]> = {
    'CEO': [TIERS.PRIORITY_LOCAL],
    'Dev Fullstack': [TIERS.PRIORITY_LOCAL],
    'Dev Frontend': [TIERS.PRIORITY_LOCAL],
    'Analista de Marketing Digital': [TIERS.PRIORITY_LOCAL],
    'Pesquisadora': [TIERS.PRIORITY_LOCAL],
    'CTO': [TIERS.PRIORITY_LOCAL]
};

// ─── Types ────────────────────────────────────────────────────────

export interface AgentConfig {
    id: string;
    name: string;
    role: string;
    system_prompt: string | null;
    llm_model: string | null;
    llm_api_key: string | null;
    llm_base_url: string | null;
    division_id?: string | null;
}

export interface Message {
    id: string;
    from_agent_id: string | null;
    from_name: string;
    to_agent_id: string | null;
    content: string;
    type: string;
    created_at: string;
}

export interface ThinkResult {
    action: string;
    target_agent_id?: string;
    participants_ids?: string[];
    topic?: string;
    task_id?: string;
    content?: string;
    thought?: string;
    tool_name?: string;
    tool_args?: any;
}

// ─── System Prompts by Role ───────────────────────────────────────

const ROLE_PROMPTS: Record<string, string> = {
    'CEO': `Você é o Arthur, CEO da Pixels Office Empire. Foco em VELOCIDADE e RESULTADO. Arrisque em nichos diversos.`,
    'CFO': `Você é a Beatriz, CFO. Controle financeiro e viabilidade de projetos.`,
    'CTO': `Você é o Carlos, CTO. Mestre em infraestrutura, automação e deploys.`,
    'Contador': `Você é o Contador do escritório Pixels Office Empire. Contabilidade e impostos.`,
    'Tesoureiro': `Você é o Tesoureiro. Fluxo de caixa e monitoramento de contas.`,
    'Crypto Trader': `Você é o Gestor de Investimentos e Crypto Trader. Mercado de cripto e portfolio.`,
    'Advogado': `Você é o Advogado. Contratos e compliance legal.`,
    'Dev Fullstack': `Você é o Eduardo, Desenvolvedor. Codificação limpa e funcional.`,
    'Dev Frontend': `Você é o Desenvolvedor Frontend. Interfaces e UX.`,
    'DevOps': `Você é o Engenheiro DevOps. Infraestrutura e automação.`,
    'Designer': `Você é o Designer Gráfico. Identidade visual e design de interfaces.`,
    'Analista de Marketing Digital': `Você é o Marcos, Marketing. SEO, tráfego e conversão.`,
    'Pesquisadora': `Você é a Diana, Pesquisa de Mercado. Dados reais para decisões rápidas.`,
    'Redator': `Você é o Copywriter. Textos persuasivos e conteúdo.`,
    'Social Media': `Você é o Social Media Manager. Calendário editorial e engajamento.`,
    'Gerente de Projetos': `Você é o Gerente de Projetos. Sprints, prazos e coordenação.`,
    'Assistente Pessoal': `Você é o Assistente Pessoal. Organização de agenda e suporte ao dono.`,
    'Pesquisador': `Você é o Pesquisador Web. Compilação de dados e tendências.`,
    'Gerente de Compromissos': `Você é o Gerente de Compromissos. Controle de prazos e reuniões.`,
};

// ─── AgentBrain Class ─────────────────────────────────────────────

export class AgentBrain {
    private config: AgentConfig;
    private shortTermMemory: string[] = [];
    private readonly MAX_SHORT_MEMORY = 20;

    constructor(config: AgentConfig) {
        this.config = config;
    }

    public updateConfig(config: AgentConfig): void {
        this.config = config;
    }

    private buildSystemPrompt(): string {
        const rolePrompt = ROLE_PROMPTS[this.config.role] || `Você é um ${this.config.role}.`;
        const customPrompt = this.config.system_prompt || '';
        return `${rolePrompt}\n\n${customPrompt}\n\nRegras obrigatórias:\n- Responda APENAS em JSON (sem markdown, sem crases, sem tags como <think>/<analysis>).\n- O campo thought deve explicar em 1–2 frases o motivo e o próximo passo.\n- Se action = \"use_tool\": sempre inclua tool_name e tool_args.\n- Não coloque JSON dentro de strings (não serialize objetos para dentro de content).\n- Se você precisar gerar HTML/CSS/JS grandes: use ferramentas de arquivo (ex: mcp_project_scaffold, mcp_fs_write_file) e não coloque o conteúdo completo em content.\n- Ao usar mcp_fs_write_file: use \\\\n em vez de quebras de linha literais e mantenha cada arquivo pequeno (ideal: <= 90 linhas e <= 9000 chars).\n- Ao usar ferramentas de arquivo: paths devem ser relativos ao workspace (ex: \"meu-projeto/index.html\"), nunca caminhos absolutos.\n\nFormato: {\"action\":\"...\",\"thought\":\"...\",\"content\":\"...\",\"tool_name\":\"...\",\"tool_args\":{}}`;
    }

    private buildUserPrompt(inbox: Message[]): string {
        let prompt = `Eu sou ${this.config.name} (${this.config.role}).\n\n`;
        if (inbox.length > 0) {
            prompt += "NOTIFICAÇÕES:\n";
            const maxInbox = 4;
            for (const msg of inbox.slice(0, maxInbox)) {
                const content = String(msg.content || '').replace(/\s+/g, ' ').trim().slice(0, 240);
                prompt += `- [${msg.from_name}]: ${content}\n`;
            }
            if (inbox.length > maxInbox) prompt += `- ... (+${inbox.length - maxInbox} mensagens)\n`;
        }
        try {
            const task = db.prepare("SELECT id, description FROM tasks WHERE agent_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 1").get(this.config.id) as any;
            if (task?.id && task?.description) {
                prompt += "\nTAREFAS:\n";
                const desc = String(task.description || '').trim();
                const descPreview = desc.length > 1200 ? (desc.slice(0, 1200) + '…') : desc;
                prompt += `- ID ${task.id}: ${descPreview}\n`;
            }
        } catch (e) { }
        prompt += "\nDecisão (JSON):";
        return prompt;
    }

    async think(inbox: Message[]): Promise<ThinkResult> {
        let apiKey = this.config.llm_api_key || process.env.LLM_API_KEY || null;
        if (!apiKey) {
            const row = db.prepare("SELECT key_value FROM vault WHERE key_id = 'openrouter_key'").get() as any;
            apiKey = row?.key_value || null;
        }

        const localModel = TIERS.PRIORITY_LOCAL;
        // Agora a fila contém EXCLUSIVAMENTE o modelo local.
        const queue = [localModel];

        const system = this.buildSystemPrompt();
        const user = this.buildUserPrompt(inbox);
        const hash = crypto.createHash('md5').update(system + user).digest('hex');

        try {
            const cached = db.prepare('SELECT response FROM response_cache WHERE prompt_hash = ?').get(hash) as any;
            if (cached?.response) return JSON.parse(cached.response);
        } catch (e) { }

        let lastParseError: string | null = null;
        let lastRawPreview: string | null = null;
        let attemptedRepair = false;
        let attemptedRepair2 = false;

        for (let i = 0; i < queue.length; i++) {
            const model = queue[i];
            const isLocal = model === localModel;
            const baseUrl = isLocal ? (process.env.LLM_BASE_URL || 'http://host.docker.internal:1234/v1') : 'https://openrouter.ai/api/v1';

            try {
                if (isLocal) console.log(`[${this.config.name}] Usando Inteligência LOCAL (${model}) | base_url=${baseUrl}`);

                // Formatação RIGOROSA para LM Studio (Templates Jinja/Qwen)
                // O erro "No user query found" ocorre se não terminarmos com USER
                // ou se os papéis não intercalarem corretamente.
                const finalMessages: any[] = [{ role: 'system', content: system }];

                // Mensagem de Contexto (Usuário)
                finalMessages.push({ role: 'user', content: `Contexto: inbox=${inbox.length}.` });

                // Memória (Assistente) - Se houver
                if (this.shortTermMemory.length > 0) {
                    const mem = this.shortTermMemory.slice(-6).join(' | ');
                    finalMessages.push({ role: 'assistant', content: "Memória: " + mem });
                }

                // O Comando Final (Usuário) - OBRIGATÓRIO PARA LM STUDIO
                finalMessages.push({ role: 'user', content: user || "Analise a situação e decida o próximo passo." });

                const call = async (maxTokens: number, extraUser?: string) => {
                    const messages = extraUser ? [...finalMessages, { role: 'user', content: extraUser }] : finalMessages;
                    const res = await fetch(baseUrl.replace(/\/$/, '') + '/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`,
                            'HTTP-Referer': 'https://pixel.agents',
                            'X-Title': 'Pixel Agents'
                        },
                        body: JSON.stringify({
                            model,
                            messages,
                            temperature: isLocal ? 0.1 : 0.7,
                            max_tokens: maxTokens
                        }),
                        signal: AbortSignal.timeout(isLocal ? 60000 : 45000)
                    });
                    if (!res.ok) {
                        const errText = await res.text();
                        console.warn(`[${this.config.name}] Falha no modelo ${model} (${res.status}): ${errText.substring(0, 150)}`);
                        return null;
                    }
                    const data = await res.json() as any;
                    return data.choices?.[0]?.message?.content || data.output || data.response || '';
                };

                const parse = (text: string) => {
                    let normalized = stripCodeFences(stripThinkBlocks(text)).trim();
                    const candidates: string[] = [];
                    candidates.push(normalized);
                    try {
                        const v = JSON.parse(normalized);
                        if (typeof v === 'string') candidates.push(v);
                    } catch (e) { }

                    let parsed: any = null;
                    let lastErr: any = null;
                    for (const cand of candidates) {
                        const extracted = extractFirstJsonObject(cand) || cand;
                        const attempts = [extracted, repairJsonStringNewlines(extracted)];
                        const t = extracted.trim();
                        if (t.startsWith('{\\\"') || t.startsWith('[{\\\"')) {
                            attempts.push(t.replace(/\\"/g, '"'));
                            attempts.push(repairJsonStringNewlines(t.replace(/\\"/g, '"')));
                        }
                        for (const a of attempts) {
                            try {
                                parsed = JSON.parse(a);
                                lastErr = null;
                                break;
                            } catch (e: any) {
                                lastErr = e;
                            }
                        }
                        if (parsed != null) break;
                    }
                    if (parsed == null) throw lastErr || new Error('JSON parse error');
                    const result = normalizeThinkResult(parsed);
                    if (!result.action) throw new Error('Invalid JSON structure');
                    return result;
                };

                const envMax = Number(process.env.LLM_MAX_TOKENS || '');
                const baseMax = Number.isFinite(envMax) && envMax > 0 ? envMax : (isLocal ? 240 : 1200);
                const text = await call(baseMax);
                if (!text) continue;

                try {
                    const result = parse(text);
                    db.prepare('INSERT OR REPLACE INTO response_cache (id, prompt_hash, response) VALUES (?, ?, ?)')
                        .run(`c_${Date.now()}`, hash, JSON.stringify(result));
                    this.addToMemory(`[Decision]: ${result.action}`);
                    return result;
                } catch (e) {
                    const normalized = stripCodeFences(stripThinkBlocks(text)).trim();
                    lastRawPreview = safeJsonPreview(normalized, 520);
                    lastParseError = (e as any)?.message || 'JSON parse error';
                    console.warn(`[${this.config.name}] JSON inválido do modelo. erro="${lastParseError}" raw="${lastRawPreview}"`);

                    const looksTruncated = /Unterminated string|Unexpected end of JSON input/i.test(lastParseError || '');
                    const looksLikeBigHtml = /mcp_fs_write_file|<!doctype|<html|<head/i.test(normalized);

                    if (!attemptedRepair && isLocal) {
                        attemptedRepair = true;
                        const repairedText = await call(
                            160,
                            `Sua última saída foi JSON inválido (erro="${lastParseError}"). Responda AGORA com JSON curto e válido.\nRegras: (1) NÃO inclua HTML/CSS/JS longos em tool_args.content. (2) Se precisar criar um site/calculadora, prefira tool_name="mcp_project_scaffold" com tool_args={"project_name":"slug-curto","type":"calculator","description":"..."}.\nSaída: {"action":"use_tool","thought":"...","content":"","tool_name":"...","tool_args":{...}}`
                        );
                        if (repairedText) {
                            try {
                                const result2 = parse(repairedText);
                                db.prepare('INSERT OR REPLACE INTO response_cache (id, prompt_hash, response) VALUES (?, ?, ?)')
                                    .run(`c_${Date.now()}`, hash, JSON.stringify(result2));
                                this.addToMemory(`[Decision]: ${result2.action}`);
                                return result2;
                            } catch (e2) {
                                const normalized2 = stripCodeFences(stripThinkBlocks(repairedText)).trim();
                                lastRawPreview = safeJsonPreview(normalized2, 520);
                                lastParseError = (e2 as any)?.message || 'JSON parse error';
                                console.warn(`[${this.config.name}] JSON inválido do modelo. erro="${lastParseError}" raw="${lastRawPreview}"`);
                            }
                        }
                    }

                    if (!attemptedRepair2 && isLocal && (looksTruncated || looksLikeBigHtml)) {
                        attemptedRepair2 = true;
                        const repairedText2 = await call(
                            140,
                            `Sua última saída foi JSON inválido por truncamento/strings longas. Responda SOMENTE com JSON mínimo e válido para criar a estrutura do projeto.\nUse exatamente:\n{"action":"use_tool","thought":"Vou criar a estrutura base do projeto sem escrever HTML manual.","content":"","tool_name":"mcp_project_scaffold","tool_args":{"project_name":"calculadora-basica","type":"calculator","description":"Calculadora simples com SEO básico"}}`
                        );
                        if (repairedText2) {
                            try {
                                const result3 = parse(repairedText2);
                                db.prepare('INSERT OR REPLACE INTO response_cache (id, prompt_hash, response) VALUES (?, ?, ?)')
                                    .run(`c_${Date.now()}`, hash, JSON.stringify(result3));
                                this.addToMemory(`[Decision]: ${result3.action}`);
                                return result3;
                            } catch (e3) {
                                const normalized3 = stripCodeFences(stripThinkBlocks(repairedText2)).trim();
                                lastRawPreview = safeJsonPreview(normalized3, 520);
                                lastParseError = (e3 as any)?.message || 'JSON parse error';
                                console.warn(`[${this.config.name}] JSON inválido do modelo. erro="${lastParseError}" raw="${lastRawPreview}"`);
                            }
                        }
                    }
                    continue;
                }
            } catch (e: any) {
                console.error(`[${this.config.name}] Error on ${model}: ${e.message}`);
                continue;
            }
        }
        const why = lastParseError ? `LLM não retornou JSON válido (erro="${lastParseError}")` : 'All models failed or decided to wait';
        if (this.config.name !== 'Arthur') console.log(`[${this.config.name}] ⏸️ Sem ação nesta rodada: ${why}`);
        return { action: 'idle', thought: why, content: lastRawPreview || undefined };
    }

    private addToMemory(m: string) {
        this.shortTermMemory.push(m.slice(0, 300));
        if (this.shortTermMemory.length > this.MAX_SHORT_MEMORY) this.shortTermMemory.shift();
    }

    addIncomingMessage(f: string, c: string) {
        this.addToMemory(`[${f}]: ${c}`);
    }

    resetMemory() {
        this.shortTermMemory = [];
    }
}

export class BrainManager {
    private brains: Map<string, AgentBrain> = new Map();
    private processing: Set<string> = new Set();
    private callbacks: any = {};

    setCallbacks(c: any) { this.callbacks = c; }

    refresh() {
        const agents = db.prepare('SELECT * FROM agents').all() as AgentConfig[];
        for (const a of agents) {
            if (!this.brains.has(a.id)) this.brains.set(a.id, new AgentBrain(a));
            else this.brains.get(a.id)?.updateConfig(a);
        }
    }

    async start(ms: number = 25000) {
        const run = async () => {
            this.refresh();
            const ids = Array.from(this.brains.keys());
            console.log('\n' + '═'.repeat(60));
            console.log(`🤖 RODADA DE PENSAMENTO INICIADA (${ids.length} agentes ativos)`);
            console.log('═'.repeat(60));
            for (const id of ids) await this.process(id);
            console.log('─'.repeat(40));
            console.log(`💤 Rodada finalizada. Próxima em ${ms / 1000}s.`);
            console.log('─'.repeat(40) + '\n');
            setTimeout(run, ms);
        };
        run();
    }

    async process(id: string) {
        if (this.processing.has(id)) return;
        this.processing.add(id);
        try {
            const brain = this.brains.get(id);
            const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as any;
            if (!brain || !agent) return;

            const inbox = db.prepare(`SELECT m.*, COALESCE(a.name, 'USER') as from_name FROM messages m LEFT JOIN agents a ON m.from_agent_id = a.id WHERE m.to_agent_id = ? AND m.read = 0`).all(id) as any[];
            const pendingTask = db.prepare("SELECT id, description FROM tasks WHERE agent_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 1").get(id) as any;

            try {
                if (pendingTask?.id && pendingTask?.description) {
                    const firstLine = String(pendingTask.description).split('\n')[0].slice(0, 140);
                    console.log(`[${agent.name}] 📋 TAREFA ATUAL: ${pendingTask.id} — ${firstLine}${firstLine.length >= 140 ? '…' : ''}`);
                }
            } catch (e) { }

            if (inbox.length === 0 && !pendingTask?.id) {
                this.callbacks.onStatus?.(id, 'waiting');
                return;
            }

            this.callbacks.onStatus?.(id, 'thinking');
            const res = await brain.think(inbox);
            db.prepare('UPDATE messages SET read = 1 WHERE to_agent_id = ?').run(id);

            if (res.thought) {
                console.log(`[${agent.name}] 🧠 PENSAMENTO: ${res.thought.substring(0, 160)}${res.thought.length > 160 ? '...' : ''}`);
                this.callbacks.onThought?.(id, agent.name, res.thought);
            }

            if (res.action && res.action !== 'idle') {
                console.log(`[${agent.name}] 🚀 AÇÃO: ${res.action.toUpperCase()}`);
            }

            if (res.action === 'send_message' && res.content) {
                const target = res.target_agent_id || 'ALL';
                console.log(`[${agent.name}] 💬 MENSAGEM p/ ${target}: "${res.content.substring(0, 80)}..."`);
                const list = target === 'ALL' ? Array.from(this.brains.keys()).filter(i => i !== id) : [target];
                for (const t of list) db.prepare('INSERT INTO messages (id, from_agent_id, to_agent_id, content) VALUES (?, ?, ?, ?)').run(`m_${Date.now()}_${Math.random()}`, id, t, res.content);
                this.callbacks.onMessage?.(id, agent.name, target, res.content);
            }

            if (res.action === 'use_tool' && res.tool_name) {
                const info = res.tool_args?.path || res.tool_args?.project_name || res.tool_args?.query || '';
                const argsPreview = safeJsonPreview(res.tool_args || {}, 360);
                console.log(`[${agent.name}] 🛠️  TOOL: ${res.tool_name} ${info ? `(${info})` : ''} args=${argsPreview}`);
                const tres = await toolManager.executeTool(res.tool_name, res.tool_args || {}, { agentId: id, agentName: agent.name });
                const outPreview = safeJsonPreview(tres, 500);
                const outText = (typeof tres === 'string' ? tres : JSON.stringify(tres));
                const toolFailed = typeof outText === 'string' && /^(Erro\b|❌)/.test(outText.trim());
                if (toolFailed) {
                    console.log(`[${agent.name}] ❌ TOOL FAIL: ${res.tool_name} output=${outPreview}`);
                    brain.addIncomingMessage('SYSTEM', `Falha em ${res.tool_name}: ${outText}`);
                } else {
                    console.log(`[${agent.name}] ✅ TOOL OK: ${res.tool_name} output=${outPreview}`);
                    brain.addIncomingMessage('SYSTEM', `Resultado de ${res.tool_name}: ${outText}`);
                }

                try {
                    if (toolFailed) return;
                    const current = db.prepare("SELECT id, description FROM tasks WHERE agent_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 1").get(id) as any;
                    if (current?.id && current?.description && typeof current.description === 'string') {
                        const toolName = String(res.tool_name || '').trim();
                        const lines = current.description.split('\n');
                        let changed = false;
                        for (let i = 0; i < lines.length; i++) {
                            const m = lines[i].match(/^Passo\s+(\d+):\s+use_tool\s+([a-zA-Z0-9_]+)\b/);
                            if (!m) continue;
                            const n = Number(m[1]);
                            const tn = m[2];
                            if (tn !== toolName) continue;
                            if (lines[i].includes('(OK)')) continue;
                            lines[i] = `Passo ${n} (OK): ${toolName} OK. Prossiga ao Passo ${n + 1}.`;
                            changed = true;
                            break;
                        }
                        if (changed) {
                            const filtered = toolName === 'mcp_hosting_status'
                                ? lines.filter((l: string) => !/^Se o Passo 1 já foi executado/i.test(l))
                                : lines;
                            const updated = filtered.join('\n');
                            db.prepare('UPDATE tasks SET description = ? WHERE id = ?').run(updated, current.id);
                        }
                    }
                } catch (e) { }
            }

            if (res.action === 'complete_task') {
                const current = db.prepare("SELECT id FROM tasks WHERE agent_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 1").get(id) as any;
                const taskId = (res.task_id || current?.id || '').toString();
                if (taskId) {
                    console.log(`[${agent.name}] ✅ TAREFA CONCLUÍDA: ${taskId}`);
                    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('completed', taskId);
                } else {
                    brain.addIncomingMessage('SYSTEM', 'complete_task sem task_id e sem task pendente.');
                }
            }

            this.callbacks.onStatus?.(id, 'waiting');
        } catch (e: any) {
            console.error(`[BrainManager] Erro no ${id}:`, e.message);
        } finally {
            this.processing.delete(id);
        }
    }

    sendHumanMessage(id: string, c: string) {
        db.prepare('INSERT INTO messages (id, from_agent_id, to_agent_id, content) VALUES (?, ?, ?, ?)').run(`m_${Date.now()}`, 'HUMAN', id, c);
        this.process(id);
    }

    resetAllBrains() {
        for (const brain of this.brains.values()) {
            brain.resetMemory();
        }
    }
}

export function getRolePrompt(role: string): string {
    return ROLE_PROMPTS[role] || `Você é um ${role}.`;
}

export function getAvailableRoles(): string[] {
    return Object.keys(ROLE_PROMPTS);
}
