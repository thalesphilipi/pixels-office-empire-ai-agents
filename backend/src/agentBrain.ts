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
    let end = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < s.length; i++) {
        const ch = s[i];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }

        if (ch === '{') {
            if (depth === 0) {
                start = i;
            }
            depth++;
        } else if (ch === '}') {
            if (depth > 0) {
                depth--;
                if (depth === 0) {
                    end = i;
                    break;
                }
            }
        }
    }

    if (start >= 0 && end >= 0) {
        return s.substring(start, end + 1);
    }

    // Fallback: try to find the last closing brace if parsing failed halfway
    if (start >= 0 && depth > 0) {
        let lastBrace = s.lastIndexOf('}');
        if (lastBrace > start) {
            return s.substring(start, lastBrace + 1) + '}'.repeat(depth - 1); // rough attempt to balance
        }
    }

    return null;
}

function repairJsonStringNewlines(jsonText: string): string {
    if (!jsonText) return '';
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
    private consecutiveFailures: number = 0;
    private lastFailedTool: string | null = null;
    private readonly MAX_SHORT_MEMORY = 20;

    constructor(config: AgentConfig) {
        this.config = config;
    }

    public incrementFailure(toolName?: string) {
        this.consecutiveFailures++;
        if (toolName) this.lastFailedTool = toolName;
    }

    public resetFailure() {
        this.consecutiveFailures = 0;
        this.lastFailedTool = null;
    }

    public getFailures() {
        return { count: this.consecutiveFailures, tool: this.lastFailedTool };
    }

    public updateConfig(config: AgentConfig): void {
        this.config = config;
    }

    private buildSystemPrompt(): string {
        const rolePrompt = ROLE_PROMPTS[this.config.role] || `Você é um ${this.config.role}.`;
        const customPrompt = this.config.system_prompt || '';

        // Sumário ultra-compacto das ferramentas para o agente "Lembrar" que elas existem
        const availableTools = toolManager.getAvailableTools()
            .map(t => {
               const args = t.parameters?.required ? `(${t.parameters.required.join(', ')})` : '()';
               return `- ${t.name}${args}`;
            }).join('\n');

        return `${rolePrompt} ${customPrompt}`.trim() + `
Regras OBRIGATÓRIAS:
1. Responda APENAS um JSON válido. Sem Markdown, sem crases, sem tags HTML ou XML (NÃO use <think>).
2. Se "action": "use_tool", OBRIGATÓRIO informar "tool_name" e "tool_args".
3. NÃO gere arquivos de código gigantes. Use "mcp_scaffold_project" para iniciar. Se precisar editar, crie partes pequenas (< 90 linhas).
4. No campo "thought", seja extremamente breve e foque no Próximo Passo para atingir o objetivo (1 frase).
5. Se falhar na mesma ação 3 vezes, retorne action: "idle".

📚 Ferramentas Disponíveis (Tool Manifest):
${availableTools}

Formato esperado:
{"action":"[use_tool|send_message|complete_task|idle]","thought":"...","content":"...","tool_name":"...","tool_args":{...}}`;
    }

    private buildUserPrompt(inbox: Message[]): string {
        let prompt = `Identidade: ${this.config.name} (${this.config.role})\n`;
        if (inbox.length > 0) {
            prompt += "Inbox:\n";
            const maxInbox = 3;
            for (const msg of inbox.slice(0, maxInbox)) {
                // Diminuindo o tamanho do slice para economizar contexto
                const content = String(msg.content || '').replace(/\s+/g, ' ').trim().slice(0, 180);
                prompt += `> [De: ${msg.from_name}] ${content}\n`;
            }
            if (inbox.length > maxInbox) prompt += `(+${inbox.length - maxInbox} antigas)\n`;
        }
        try {
            // Task priority logic:
            // - pending
            // - no dependencies (depends_on IS NULL) OR dependency is completed.
            const task = db.prepare(`
                SELECT t.id, t.description
                FROM tasks t
                LEFT JOIN tasks dep ON t.depends_on = dep.id
                WHERE t.agent_id = ? AND t.status = 'pending'
                AND (t.depends_on IS NULL OR t.depends_on = '' OR dep.status = 'completed')
                ORDER BY t.created_at ASC LIMIT 1
            `).get(this.config.id) as any;

            if (task?.id && task?.description) {
                const desc = String(task.description || '').trim();
                // Task description limits for small local models
                const descPreview = desc.length > 800 ? (desc.slice(0, 800) + '...') : desc;
                prompt += `\nTask Ativa (${task.id}):\n${descPreview}\n`;

                // --- RAG Semântico Avançado (TF-IDF / BM25 Simulado) ---
                try {
                    const allDocs = db.prepare("SELECT title, content FROM knowledge_base").all() as any[];
                    if (allDocs.length > 0) {
                        const tokenize = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 3);
                        const queryTokens = tokenize(desc);

                        if (queryTokens.length > 0) {
                            let bestDoc = null;
                            let maxScore = 0;

                            // Calculate Inverse Document Frequency (IDF)
                            const df = new Map<string, number>();
                            allDocs.forEach(doc => {
                                const seen = new Set<string>();
                                tokenize(doc.title + " " + doc.content).forEach(t => seen.add(t));
                                seen.forEach(t => df.set(t, (df.get(t) || 0) + 1));
                            });

                            // Score each document against query using TF-IDF logic
                            for (const doc of allDocs) {
                                const docTokens = tokenize(doc.title + " " + doc.content);
                                let score = 0;

                                for (const q of queryTokens) {
                                    // Term Frequency (TF)
                                    const tf = docTokens.filter(t => t === q).length;
                                    if (tf > 0) {
                                        // Inverse Document Frequency (IDF)
                                        const docFreq = df.get(q) || 1;
                                        const idf = Math.log(allDocs.length / docFreq) + 1;
                                        score += (tf * idf);
                                    }
                                }

                                if (score > maxScore && score > 1.5) { // Minimum threshold to prevent noise
                                    maxScore = score;
                                    bestDoc = doc;
                                }
                            }

                            if (bestDoc) {
                                prompt += `\n💡 Memória Semântica (Dica Interna da Empresa):\n[${bestDoc.title}]: ${bestDoc.content.substring(0, 300)}...\n`;
                            }
                        }
                    }
                } catch (kbError) {
                    // ignore if knowledge_base table doesn't exist or query fails
                }
            }
        } catch (e) { }
        prompt += "\nSaída (JSON):";
        return prompt;
    }

    async think(inbox: Message[]): Promise<ThinkResult> {
        // --- NUVEM HÍBRIDA (LOCAL + CLOUD POR AGENTE) ---
        let apiKey = this.config.llm_api_key || process.env.LLM_API_KEY || null;
        if (!apiKey) {
            // Fallback para OpenRouter se disponível no Cofre
            try {
                const row = db.prepare("SELECT key_value FROM vault WHERE key_id = 'openrouter_key' OR service = 'openrouter' LIMIT 1").get() as any;
                apiKey = row?.key_value || null;
            } catch (e) {}
        }

        const model = this.config.llm_model || TIERS.PRIORITY_LOCAL;
        const baseUrl = this.config.llm_base_url || (
             (model.includes('gpt') || model.includes('claude') || model.includes('gemini') || model.includes('anthropic') || model.includes('openai'))
             ? 'https://openrouter.ai/api/v1'
             : (process.env.LLM_BASE_URL || 'http://host.docker.internal:1234/v1')
        );

        const isLocal = !baseUrl.includes('openrouter') && !baseUrl.includes('openai');

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

        for (let i = 0; i < 1; i++) {
            try {
                const badge = isLocal ? 'LOCAL 🏠' : 'NUVEM ☁️';
                console.log(`[${this.config.name}] Usando Inteligência ${badge} (${model})`);

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
                finalMessages.push({ role: 'user', content: user || "Analise a situação e decida o próximo passo. Retorne apenas JSON." });

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
                        let extracted = extractFirstJsonObject(cand);
                        if (!extracted) extracted = cand;

                        // Try to fix common trailing commas before brace
                        extracted = extracted.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');

                        const attempts = [
                            extracted,
                            repairJsonStringNewlines(extracted),
                            // agressive newline cleanup inside content if the above failed
                            extracted.replace(/\n/g, '\\n').replace(/\r/g, '')
                        ];

                        const t = extracted.trim();
                        if (t.startsWith('{\\\"') || t.startsWith('[{\\\"')) {
                            const unescaped = t.replace(/\\"/g, '"');
                            attempts.push(unescaped);
                            attempts.push(repairJsonStringNewlines(unescaped));
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
                            `Atenção: Sua última saída não foi um JSON válido (erro: "${lastParseError}"). Por favor, corrija seu erro.\nRetorne estritamente um objeto JSON com chaves: "action", "thought" (opcional), "tool_name", "tool_args" e "content".\nSe for escrever código HTML/JS/CSS, use "\\n" para quebras de linha ou mantenha o código compacto.\n\nJSON CORRIGIDO:`
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
                            `Você está tentando gerar um JSON muito grande e o modelo está cortando no meio. \nPARE de gerar arquivos enormes de uma vez. Mude sua estratégia: crie arquivos menores ou use mcp_scaffold_project.\nResponda agora com um JSON muito simples informando seu novo plano em "thought".`
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

            // Execução paralela com controle simples de concorrência (ex: max 2 ou 3 por vez para não derreter o LM Studio Local)
            const CONCURRENCY_LIMIT = 3;
            for (let i = 0; i < ids.length; i += CONCURRENCY_LIMIT) {
                const batch = ids.slice(i, i + CONCURRENCY_LIMIT);
                await Promise.all(batch.map(id => this.process(id)));
            }

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

            // Circuit Breaker: prevent stuck agents
            const fails = brain.getFailures();
            if (fails.count >= 3) {
                console.log(`[${agent.name}] 🛑 CIRCUIT BREAKER ATIVADO (3 falhas seguidas na tool: ${fails.tool || 'desconhecida'}). Pedindo ajuda.`);
                this.callbacks.onAskHuman?.(agent.name, `Estou travado! Falhei 3 vezes seguidas tentando usar a ferramenta "${fails.tool || 'desconhecida'}". Preciso de ajuda ou que mude minha tarefa.`);

                brain.addIncomingMessage('SYSTEM', `Você falhou 3 vezes seguidas. Pare de tentar a mesma coisa. O Dono foi notificado.`);
                db.prepare('INSERT INTO messages (id, from_agent_id, to_agent_id, content) VALUES (?, ?, ?, ?)').run(`m_${Date.now()}`, id, 'HUMAN', `Estou preso em loop tentando executar ${fails.tool || 'uma ação'}.`);
                brain.resetFailure();

                // Let the agent skip this turn and wait for human input
                this.callbacks.onStatus?.(id, 'waiting');
                this.callbacks.onActivity?.(id, 'circuit_breaker', 'circuit_breaker');
                return;
            }

            const inbox = db.prepare(`SELECT m.*, COALESCE(a.name, 'USER') as from_name FROM messages m LEFT JOIN agents a ON m.from_agent_id = a.id WHERE m.to_agent_id = ? AND m.read = 0`).all(id) as any[];
            const pendingTask = db.prepare(`
                SELECT t.id, t.description
                FROM tasks t
                LEFT JOIN tasks dep ON t.depends_on = dep.id
                WHERE t.agent_id = ? AND t.status = 'pending'
                AND (t.depends_on IS NULL OR t.depends_on = '' OR dep.status = 'completed')
                ORDER BY t.created_at ASC LIMIT 1
            `).get(id) as any;

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

                // Emit activity for visual feedback before execution
                let act = 'coding';
                if (res.tool_name.includes('search') || res.tool_name.includes('browser')) act = 'searching';
                if (res.tool_name.includes('finance') || res.tool_name.includes('blockchain')) act = 'finance';
                this.callbacks.onActivity?.(id, act, res.tool_name);

                const tres = await toolManager.executeTool(res.tool_name, res.tool_args || {}, { agentId: id, agentName: agent.name });
                const outPreview = safeJsonPreview(tres, 500);
                const outText = (typeof tres === 'string' ? tres : JSON.stringify(tres));
                const toolFailed = typeof outText === 'string' && /^(Erro\b|❌)/.test(outText.trim());

                if (toolFailed) {
                    console.log(`[${agent.name}] ❌ TOOL FAIL: ${res.tool_name} output=${outPreview}`);
                    brain.addIncomingMessage('SYSTEM', `Falha em ${res.tool_name}: ${outText}`);
                    brain.incrementFailure(res.tool_name);

                    if (outText.includes('Erro de Sintaxe') || outText.includes('SINTAXE')) {
                       this.callbacks.onActivity?.(id, 'circuit_breaker', 'Erro de Sintaxe');
                    }
                } else {
                    console.log(`[${agent.name}] ✅ TOOL OK: ${res.tool_name} output=${outPreview}`);
                    brain.addIncomingMessage('SYSTEM', `Resultado de ${res.tool_name}: ${outText}`);
                    brain.resetFailure();
                }

                try {
                    if (toolFailed) return;
                    const current = db.prepare(`
                        SELECT t.id, t.description
                        FROM tasks t
                        LEFT JOIN tasks dep ON t.depends_on = dep.id
                        WHERE t.agent_id = ? AND t.status = 'pending'
                        AND (t.depends_on IS NULL OR t.depends_on = '' OR dep.status = 'completed')
                        ORDER BY t.created_at ASC LIMIT 1
                    `).get(id) as any;

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
                const current = db.prepare(`
                    SELECT t.id
                    FROM tasks t
                    LEFT JOIN tasks dep ON t.depends_on = dep.id
                    WHERE t.agent_id = ? AND t.status = 'pending'
                    AND (t.depends_on IS NULL OR t.depends_on = '' OR dep.status = 'completed')
                    ORDER BY t.created_at ASC LIMIT 1
                `).get(id) as any;
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
