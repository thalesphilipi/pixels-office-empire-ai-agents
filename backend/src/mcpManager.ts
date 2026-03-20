/**
 * MCP-Like Tools Manager
 * Implements powerful agent capabilities natively without external MCP SDK dependency.
 * These tools give agents filesystem mastery, structured thinking, web page reading,
 * and deployment capabilities — all running inside the Docker container for free.
 */

import { Tool, ToolContext } from './toolManager.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import { chromium, Browser, Page } from 'playwright';

// Browser singleton state
let globalBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
    if (!globalBrowser) {
        globalBrowser = await chromium.launch({ headless: true });
    }
    return globalBrowser;
}

// Em vez de retornar a globalPage (que causa memory leak se não for fechada ou acessada paralelamente)
// Retornamos um objeto context+page isolado e descartável
async function createIsolatedPage() {
    const browser = await getBrowser();
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    return { context, page };
}

const execAsync = promisify(exec);

const WORKSPACE_ROOT = '/data/projects';

async function ensureWorkspace() {
    try {
        await fs.mkdir(WORKSPACE_ROOT, { recursive: true });

        // 📚 Destilação de Conhecimento (Level 500)
        // Auto-gera o manual de habilidades se ele não existir
        const manualPath = path.join(WORKSPACE_ROOT, 'AGENTS_MANUAL.md');
        try {
            await fs.access(manualPath);
        } catch {
            const manualContent = `# 🧠 Manual de Habilidades da Agência (SOP)

Este documento contém o conhecimento destilado da nossa agência para que você (Agente) trabalhe com perfeição. Leia com atenção.

## 1. Regras de Edição de Código (CRÍTICO)
- **NUNCA** use \`mcp_fs_write_file\` ou tente reescrever arquivos grandes (mais de 100 linhas). Modelos LLM truncam o código.
- Para consertar um bug pequeno (1 a 5 linhas), **SEMPRE** use \`mcp_fs_replace_line\`. É cirúrgico e não quebra o arquivo.
- Para substituir funções inteiras ou blocos grandes, **SEMPRE** use \`mcp_fs_replace_block\`. Certifique-se de que a \`old_block\` corresponda **exatamente** ao que está no arquivo (você pode ler o arquivo antes com \`mcp_fs_read_range\` para ter certeza da formatação).

## 2. Regras de Navegação e Terminal
- Está perdido em um projeto grande? Não use múltiplos comandos \`ls\`. Use **UMA VEZ** a ferramenta \`mcp_fs_tree\` para entender a estrutura de pastas instantaneamente.
- O terminal (\`mcp_shell_exec\`) é burro. Ele **não** pode responder a perguntas de [Yes/No]. Se você rodar um comando interativo, ele vai travar e dar timeout. SEMPRE adicione flags como \`-y\`, \`--yes\`, ou \`--non-interactive\`.

## 3. O Fluxo de Trabalho (Pipeline)
1. O **CTO** roda o scaffold.
2. O **Dev Fullstack** programa as regras de negócio editando os arquivos isoladamente.
3. A **QA Tester** roda \`mcp_lint_project\`. Se falhar, ela devolve para o Dev.
4. O **CTO** faz o deploy apenas quando a QA dá o ok final.
`;
            await fs.writeFile(manualPath, manualContent, 'utf-8');
        }
    } catch (e) { }
}

function shellEscapePosix(value: string): string {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

async function vaultGet(keyId: string): Promise<string> {
    const { db } = await import('./db.js');
    const row = db.prepare('SELECT key_value FROM vault WHERE key_id = ?').get(keyId) as any;
    return (row?.key_value ?? '').toString();
}

async function vaultGetFirst(keyIds: string[]): Promise<string> {
    for (const keyId of keyIds) {
        const value = (await vaultGet(keyId)).toString();
        if (value.trim()) return value;
    }
    return '';
}

async function collectFilesRecursive(dirPath: string, relativePrefix: string = ''): Promise<Array<{ fullPath: string; relPath: string }>> {
    const out: Array<{ fullPath: string; relPath: string }> = [];
    const files = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of files) {
        const name = entry.name;
        if (name === 'node_modules' || name === '.git' || name === '.next' || name === 'dist') continue;
        const fullPath = path.join(dirPath, name);
        const relPath = relativePrefix ? `${relativePrefix}/${name}` : name;
        if (entry.isDirectory()) {
            out.push(...await collectFilesRecursive(fullPath, relPath));
        } else if (entry.isFile()) {
            out.push({ fullPath, relPath });
        }
    }
    return out;
}

function normalizeSubdomain(input: string): string {
    const s = (input || '').toString().trim().toLowerCase();
    const cleaned = s.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
    return cleaned.slice(0, 63);
}

function redactSecrets(text: string, secrets: string[]): string {
    let out = (text || '').toString();
    for (const secret of secrets) {
        const s = (secret || '').toString();
        if (s && s.length >= 4) out = out.split(s).join('***');
    }
    return out;
}

/**
 * Helper to call cPanel UAPI
 */
async function callCPanelUAPI(module: string, func: string, params: Record<string, string>): Promise<any> {
    const user = await vaultGet('cpanel_user');
    const pass = await vaultGet('cpanel_pass');
    const host = await vaultGet('cpanel_host');

    if (!user || !pass || !host) throw new Error('Credenciais do cPanel não encontradas no Vault.');

    // Authentication can be done via header or URL, we'll use Header (Basic)
    const url = `https://${host}:2083/execute/${module}/${func}?` + new URLSearchParams(params).toString();
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');

    // Node 18+ global fetch
    const response = await fetch(url, {
        headers: {
            'Authorization': `Basic ${auth}`,
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Erro na API do cPanel (${response.status}): ${text}`);
    }

    return response.json();
}

const mcpTools: Record<string, Tool> = {

    // ═══════════════════════════════════════════════════════════════
    // 📂 FILESYSTEM TOOLS (MCP Filesystem equivalent)
    // ═══════════════════════════════════════════════════════════════

    'mcp_fs_read_file': {
        name: 'mcp_fs_read_file',
        description: '[MCP Filesystem] Lê o conteúdo completo de um arquivo do projeto.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho relativo ao workspace (ex: meu-site/index.html)' }
            },
            required: ['path']
        },
        execute: async (args: any) => {
            try {
                await ensureWorkspace();
                const fullPath = path.join(WORKSPACE_ROOT, args.path);
                // Security: prevent path traversal
                if (!fullPath.startsWith(WORKSPACE_ROOT)) return 'Erro: Caminho inválido.';
                const content = await fs.readFile(fullPath, 'utf-8');

                const maxChars = 3000;
                if (content.length > maxChars) {
                    return `Conteúdo de ${args.path}:\n\n${content.substring(0, maxChars)}\n\n...[TRUNCADO. Use mcp_fs_read_range para ler em partes]`;
                }
                return `Conteúdo de ${args.path}:\n\n${content}`;
            } catch (e: any) {
                return `Erro ao ler arquivo: ${e.message}`;
            }
        }
    },

    'mcp_fs_replace_block': {
        name: 'mcp_fs_replace_block',
        description: '[MCP Filesystem] Substitui um bloco exato de texto em um arquivo. Útil para reescrever funções inteiras ou tags HTML completas sem depender de números de linha que podem mudar.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho relativo ao workspace (ex: js/app.js)' },
                old_block: { type: 'string', description: 'O bloco de código antigo exato a ser procurado e substituído (pode ter várias linhas, mas deve casar exatamente com o conteúdo original)' },
                new_block: { type: 'string', description: 'O novo código que vai entrar no lugar do bloco antigo' }
            },
            required: ['path', 'old_block', 'new_block']
        },
        execute: async (args: any) => {
            try {
                await ensureWorkspace();
                const fullPath = path.join(WORKSPACE_ROOT, args.path);
                if (!fullPath.startsWith(WORKSPACE_ROOT)) return 'Erro: Caminho inválido.';

                const oldBlock = (args.old_block || '').toString();
                const newBlock = (args.new_block || '').toString();

                if (oldBlock.length === 0) return 'Erro: old_block está vazio.';

                let content = await fs.readFile(fullPath, 'utf-8');

                // Normaliza quebras de linha para evitar falhas por LF vs CRLF
                const normalizeNL = (str: string) => str.replace(/\r\n/g, '\n').trim();

                const normalizedContent = content.replace(/\r\n/g, '\n');
                const normalizedOld = normalizeNL(oldBlock);

                const idx = normalizedContent.indexOf(normalizedOld);

                if (idx === -1) {
                     // Tenta uma busca um pouco mais flexível se a exata falhar
                     const linesOld = normalizedOld.split('\n');
                     if (linesOld.length > 1) {
                         return `❌ Falha na substituição: O bloco exato fornecido não foi encontrado no arquivo. Tente usar uma assinatura de função mais específica ou use mcp_fs_replace_line para erros isolados.`;
                     }
                     return `❌ Falha na substituição: Texto exato não encontrado em ${args.path}.`;
                }

                // Conta quantas ocorrências existem para evitar substituir o lugar errado acidentalmente
                let occurrences = 0;
                let searchIdx = normalizedContent.indexOf(normalizedOld);
                while (searchIdx !== -1) {
                    occurrences++;
                    searchIdx = normalizedContent.indexOf(normalizedOld, searchIdx + 1);
                }

                if (occurrences > 1) {
                    return `⚠️ Aviso: Existem ${occurrences} ocorrências deste bloco no arquivo. A substituição de bloco falhou porque a busca é ambígua. Forneça um bloco old_block maior/mais exclusivo.`;
                }

                const newContent = normalizedContent.replace(normalizedOld, newBlock);
                await fs.writeFile(fullPath, newContent, 'utf-8');

                return `✅ Bloco substituído com sucesso no arquivo ${args.path}!\nForam atualizadas ${normalizedOld.split('\n').length} linhas antigas para ${newBlock.split('\n').length} linhas novas.`;
            } catch (e: any) {
                return `Erro na substituição de bloco: ${e.message}`;
            }
        }
    },

    'mcp_fs_replace_line': {
        name: 'mcp_fs_replace_line',
        description: '[MCP Filesystem] Usado para autocorreção focada. Substitui EXATAMENTE UMA LINHA de código onde o linter detectou erro.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho do arquivo (ex: js/app.js)' },
                line_number: { type: 'number', description: 'Número da linha reportada pelo erro (1-indexed)' },
                new_code: { type: 'string', description: 'O código corrigido para essa linha' }
            },
            required: ['path', 'line_number', 'new_code']
        },
        execute: async (args: any) => {
            try {
                await ensureWorkspace();
                const fullPath = path.join(WORKSPACE_ROOT, args.path);
                if (!fullPath.startsWith(WORKSPACE_ROOT)) return 'Erro: Caminho inválido.';
                const lineNum = Math.max(1, Number(args.line_number || 1));
                const newCode = (args.new_code ?? '').toString();

                const content = await fs.readFile(fullPath, 'utf-8');
                const lines = content.split('\n');

                if (lineNum > lines.length) return `Erro: O arquivo tem apenas ${lines.length} linhas. A linha ${lineNum} não existe.`;

                const oldCode = lines[lineNum - 1];
                lines[lineNum - 1] = newCode;

                await fs.writeFile(fullPath, lines.join('\n'), 'utf-8');
                return `✅ Autocorreção na linha ${lineNum} do arquivo ${args.path}.\nDe:   ${oldCode}\nPara: ${newCode}`;
            } catch (e: any) {
                return `Erro na autocorreção: ${e.message}`;
            }
        }
    },

    'mcp_finance_payroll': {
        name: 'mcp_finance_payroll',
        description: '[MCP Business] Processa a folha de pagamento da empresa. Executar apenas 1x por dia útil para deduzir do caixa da empresa e pagar os agentes.',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        },
        execute: async (args: any, context: ToolContext) => {
            try {
                const { db } = await import('./db.js');
                const company = db.prepare("SELECT cash FROM company WHERE id = 'default'").get() as any;
                let cash = Number(company?.cash || 0);

                const agents = db.prepare("SELECT agent_id, salary FROM agent_finance WHERE salary > 0").all() as any[];
                let totalPaid = 0;
                let paidAgents = 0;
                let msgs = [];

                for (const a of agents) {
                    const sal = Number(a.salary || 0);
                    if (sal <= 0) continue;

                    if (cash >= sal) {
                        // Pay agent
                        db.prepare("UPDATE agent_finance SET bank_balance = bank_balance + ?, last_payroll_at = CURRENT_TIMESTAMP WHERE agent_id = ?").run(sal, a.agent_id);
                        db.prepare("UPDATE company SET cash = cash - ? WHERE id = 'default'").run(sal);
                        cash -= sal;
                        totalPaid += sal;
                        paidAgents++;

                        // Register transaction
                        const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                        db.prepare("INSERT INTO agent_transactions (id, agent_id, tx_type, amount, memo) VALUES (?, ?, ?, ?, ?)").run(
                            txId, a.agent_id, 'payroll', sal, 'Salário pago via mcp_finance_payroll'
                        );
                    } else {
                        msgs.push(`⚠️ CAIXA INSUFICIENTE para pagar agente ${a.agent_id} ($${sal}).`);
                    }
                }

                if (msgs.length > 0) {
                    db.prepare('INSERT INTO messages (id, from_agent_id, to_agent_id, content) VALUES (?, ?, ?, ?)').run(`m_${Date.now()}`, context.agentId, 'HUMAN', `🚨 URGENTE CFO: O Caixa da empresa não tem dinheiro para cobrir toda a folha de pagamento! Faltou pagar ${agents.length - paidAgents} agentes. Risco de revolta.`);
                } else if (paidAgents > 0) {
                    db.prepare('INSERT INTO messages (id, from_agent_id, to_agent_id, content) VALUES (?, ?, ?, ?)').run(`m_${Date.now()}`, context.agentId, 'ALL', `💸 O pagamento de vocês caiu na conta! Total distribuído: $${totalPaid.toFixed(2)}. Vejam seus saldos e pensem em investir em upgrades de turno!`);
                }

                return `💸 Folha processada. Pagos: ${paidAgents} agentes. Total: $${totalPaid}. Caixa restante: $${cash.toFixed(2)}.\n${msgs.join('\n')}`;
            } catch (e: any) {
                return `Erro no Payroll: ${e.message}`;
            }
        }
    },

    'mcp_finance_revenue': {
        name: 'mcp_finance_revenue',
        description: '[MCP Business] Simula a entrada de receita ($$$) na empresa de um projeto ou tarefa entregue com sucesso.',
        parameters: {
            type: 'object',
            properties: {
                project_name: { type: 'string', description: 'Nome do projeto ou divisão' },
                amount: { type: 'number', description: 'Valor da receita (USD) entre 10 e 1000' }
            },
            required: ['project_name', 'amount']
        },
        execute: async (args: any, context: ToolContext) => {
            try {
                const { db } = await import('./db.js');
                const amt = Math.max(1, Math.min(10000, Number(args.amount || 50)));
                const proj = (args.project_name || 'Projeto Desconhecido').toString().trim();

                db.prepare("UPDATE company SET cash = cash + ? WHERE id = 'default'").run(amt);

                db.prepare('INSERT INTO messages (id, from_agent_id, to_agent_id, content) VALUES (?, ?, ?, ?)').run(`m_${Date.now()}`, context.agentId, 'ALL', `💰 Boas notícias! Fechamos o projeto "${proj}" e recebemos $${amt.toFixed(2)} de receita. O caixa da empresa agradece!`);

                return `✅ Receita de $${amt.toFixed(2)} computada no caixa da empresa referente ao projeto "${proj}".`;
            } catch (e: any) {
                return `Erro ao computar receita: ${e.message}`;
            }
        }
    },

    'mcp_fs_read_range': {
        name: 'mcp_fs_read_range',
        description: '[MCP Filesystem] Lê um trecho (range de linhas) de um arquivo do projeto.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho relativo ao workspace (ex: meu-site/index.html)' },
                start_line: { type: 'number', description: 'Linha inicial (1-indexed)' },
                line_count: { type: 'number', description: 'Quantidade de linhas a ler (máx 250)' }
            },
            required: ['path', 'start_line', 'line_count']
        },
        execute: async (args: any) => {
            try {
                await ensureWorkspace();
                const fullPath = path.join(WORKSPACE_ROOT, args.path);
                if (!fullPath.startsWith(WORKSPACE_ROOT)) return 'Erro: Caminho inválido.';
                const start = Math.max(1, Number(args.start_line || 1));
                const count = Math.min(250, Math.max(1, Number(args.line_count || 50)));
                const content = await fs.readFile(fullPath, 'utf-8');
                const lines = content.split('\n');
                const end = Math.min(lines.length, start + count - 1);
                const slice = lines.slice(start - 1, end);
                const numbered = slice.map((l, i) => `${start + i}│${l}`).join('\n');
                return `Trecho de ${args.path} (linhas ${start}-${end}):\n\n${numbered}`;
            } catch (e: any) {
                return `Erro ao ler trecho: ${e.message}`;
            }
        }
    },

    'mcp_fs_search': {
        name: 'mcp_fs_search',
        description: '[MCP Filesystem] Busca texto no workspace (arquivos).',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Texto a buscar (substring)' },
                path: { type: 'string', description: 'Subpasta dentro do workspace (opcional)' },
                max_results: { type: 'number', description: 'Máximo de resultados (padrão 25, máx 60)' }
            },
            required: ['query']
        },
        execute: async (args: any) => {
            try {
                await ensureWorkspace();
                const query = (args.query ?? '').toString();
                if (!query.trim()) return 'Erro: query vazia.';
                const maxResults = Math.min(60, Math.max(1, Number(args.max_results || 25)));
                const root = path.join(WORKSPACE_ROOT, (args.path || '').toString());
                if (!root.startsWith(WORKSPACE_ROOT)) return 'Erro: Caminho inválido.';

                const results: Array<{ file: string; line: number; snippet: string }> = [];
                let scannedFiles = 0;

                const walk = async (dir: string, relPrefix: string) => {
                    if (results.length >= maxResults) return;
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (results.length >= maxResults) break;
                        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build') continue;
                        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
                        const full = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            await walk(full, rel);
                        } else {
                            scannedFiles++;
                            if (scannedFiles > 220) return;
                            let stat: any;
                            try { stat = await fs.stat(full); } catch (e) { continue; }
                            if (!stat?.isFile?.() || stat.size > 300_000) continue;
                            let content: string;
                            try { content = await fs.readFile(full, 'utf-8'); } catch (e) { continue; }
                            if (!content.includes(query)) continue;
                            const lines = content.split('\n');
                            for (let i = 0; i < lines.length; i++) {
                                if (results.length >= maxResults) break;
                                if (lines[i].includes(query)) {
                                    results.push({
                                        file: rel,
                                        line: i + 1,
                                        snippet: lines[i].slice(0, 220)
                                    });
                                }
                            }
                        }
                    }
                };

                await walk(root, (args.path || '').toString().replace(/\/+$/, ''));

                if (results.length === 0) return `Sem resultados para "${query}".`;
                const out = results.map(r => `- ${r.file}:${r.line} ${r.snippet}`).join('\n');
                return `Resultados para "${query}" (${results.length}):\n${out}`;
            } catch (e: any) {
                return `Erro ao buscar: ${e.message}`;
            }
        }
    },

    'mcp_fs_grep': {
        name: 'mcp_fs_grep',
        description: '[MCP Filesystem] Grep por regex no workspace (arquivos).',
        parameters: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'Regex (JavaScript) para buscar' },
                flags: { type: 'string', description: 'Flags (ex: i, im)' },
                path: { type: 'string', description: 'Subpasta dentro do workspace (opcional)' },
                max_results: { type: 'number', description: 'Máximo de resultados (padrão 25, máx 60)' }
            },
            required: ['pattern']
        },
        execute: async (args: any) => {
            try {
                await ensureWorkspace();
                const pat = (args.pattern ?? '').toString();
                if (!pat.trim()) return 'Erro: pattern vazio.';
                const flags = (args.flags ?? '').toString().replace(/[^gimsuy]/g, '').slice(0, 5);
                let re: RegExp;
                try { re = new RegExp(pat, flags); } catch (e: any) { return `Erro: regex inválida: ${e.message}`; }
                const maxResults = Math.min(60, Math.max(1, Number(args.max_results || 25)));
                const root = path.join(WORKSPACE_ROOT, (args.path || '').toString());
                if (!root.startsWith(WORKSPACE_ROOT)) return 'Erro: Caminho inválido.';

                const results: Array<{ file: string; line: number; snippet: string }> = [];
                let scannedFiles = 0;

                const walk = async (dir: string, relPrefix: string) => {
                    if (results.length >= maxResults) return;
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (results.length >= maxResults) break;
                        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build') continue;
                        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
                        const full = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            await walk(full, rel);
                        } else {
                            scannedFiles++;
                            if (scannedFiles > 220) return;
                            let stat: any;
                            try { stat = await fs.stat(full); } catch (e) { continue; }
                            if (!stat?.isFile?.() || stat.size > 300_000) continue;
                            let content: string;
                            try { content = await fs.readFile(full, 'utf-8'); } catch (e) { continue; }
                            const lines = content.split('\n');
                            for (let i = 0; i < lines.length; i++) {
                                if (results.length >= maxResults) break;
                                if (re.test(lines[i])) {
                                    results.push({
                                        file: rel,
                                        line: i + 1,
                                        snippet: lines[i].slice(0, 220)
                                    });
                                    re.lastIndex = 0;
                                }
                            }
                        }
                    }
                };

                await walk(root, (args.path || '').toString().replace(/\/+$/, ''));

                if (results.length === 0) return `Sem resultados para /${pat}/${flags}.`;
                const out = results.map(r => `- ${r.file}:${r.line} ${r.snippet}`).join('\n');
                return `Resultados para /${pat}/${flags} (${results.length}):\n${out}`;
            } catch (e: any) {
                return `Erro no grep: ${e.message}`;
            }
        }
    },

    'mcp_fs_patch_file': {
        name: 'mcp_fs_patch_file',
        description: '[MCP Filesystem] Aplica patch por range de linhas em um arquivo do workspace (sem reescrever tudo).',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho relativo ao workspace (ex: meu-site/index.html)' },
                start_line: { type: 'number', description: 'Linha inicial (1-indexed)' },
                end_line: { type: 'number', description: 'Linha final (1-indexed, inclusive)' },
                content: { type: 'string', description: 'Novo conteúdo para substituir o range' }
            },
            required: ['path', 'start_line', 'end_line', 'content']
        },
        execute: async (args: any) => {
            try {
                await ensureWorkspace();
                const fullPath = path.join(WORKSPACE_ROOT, args.path);
                if (!fullPath.startsWith(WORKSPACE_ROOT)) return 'Erro: Caminho inválido.';
                const start = Math.max(1, Number(args.start_line || 1));
                const end = Math.max(start, Number(args.end_line || start));
                const replacement = (args.content ?? '').toString();
                if (replacement.split('\n').length > 120 || replacement.length > 12000) {
                    return 'Erro: Patch muito grande. Divida em partes menores.';
                }
                const content = await fs.readFile(fullPath, 'utf-8');
                const lines = content.split('\n');
                if (start > lines.length + 1) return `Erro: start_line fora do arquivo (linhas=${lines.length}).`;
                const safeEnd = Math.min(lines.length, end);
                const before = lines.slice(0, start - 1);
                const after = lines.slice(safeEnd);
                const next = [...before, ...replacement.split('\n'), ...after].join('\n');
                await fs.writeFile(fullPath, next, 'utf-8');
                return `Patch aplicado em ${args.path} (linhas ${start}-${safeEnd}).`;
            } catch (e: any) {
                return `Erro ao aplicar patch: ${e.message}`;
            }
        }
    },

    'mcp_fs_write_file': {
        name: 'mcp_fs_write_file',
        description: '[MCP Filesystem] Cria ou sobrescreve um arquivo no projeto. Cria diretórios automaticamente.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho relativo ao workspace (ex: meu-site/index.html)' },
                content: { type: 'string', description: 'Conteúdo completo do arquivo' }
            },
            required: ['path', 'content']
        },
        execute: async (args: any) => {
            try {
                await ensureWorkspace();
                const fullPath = path.join(WORKSPACE_ROOT, args.path);
                if (!fullPath.startsWith(WORKSPACE_ROOT)) return 'Erro: Caminho inválido.';
                if (typeof args?.content !== 'string') return 'Erro: content ausente (string) no tool_args.';
                const contentStr = args.content.toString();
                if (!contentStr.trim()) return 'Erro: content vazio.';
                const lineCount = contentStr.split('\n').length;
                if (lineCount > 90 || contentStr.length > 9000) {
                    return `Erro: Conteúdo muito grande para 1 escrita (linhas=${lineCount}, chars=${contentStr.length}). Divida em arquivos menores (ex: index.html, styles.css, app.js) ou em partes (ex: app.part1.js, app.part2.js).`;
                }
                await fs.mkdir(path.dirname(fullPath), { recursive: true });
                await fs.writeFile(fullPath, contentStr, 'utf-8');
                return `Arquivo criado/atualizado com sucesso: ${args.path} (${contentStr.length} bytes)`;
            } catch (e: any) {
                return `Erro ao escrever arquivo: ${e.message}`;
            }
        }
    },

    'mcp_fs_list_directory': {
        name: 'mcp_fs_list_directory',
        description: '[MCP Filesystem] Lista todos os arquivos e pastas de um diretório do projeto recursivamente.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho relativo ao workspace (ex: meu-site/ ou vazio para raiz)' }
            },
            required: ['path']
        },
        execute: async (args: any) => {
            try {
                await ensureWorkspace();
                const targetPath = path.join(WORKSPACE_ROOT, args.path || '');
                if (!targetPath.startsWith(WORKSPACE_ROOT)) return 'Erro: Caminho inválido.';

                const items: string[] = [];
                async function walk(dir: string, prefix: string = '') {
                    try {
                        const entries = await fs.readdir(dir, { withFileTypes: true });
                        for (const entry of entries) {
                            if (entry.name === 'node_modules' || entry.name === '.git') continue;
                            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
                            if (entry.isDirectory()) {
                                items.push(`📁 ${rel}/`);
                                if (items.length < 100) await walk(path.join(dir, entry.name), rel);
                            } else {
                                const stat = await fs.stat(path.join(dir, entry.name));
                                items.push(`📄 ${rel} (${stat.size} bytes)`);
                            }
                        }
                    } catch (e) { }
                }
                await walk(targetPath);

                if (items.length === 0) return `Diretório vazio ou não existe: ${args.path || '/'}`;
                return `Conteúdo de ${args.path || '/'}:\n\n${items.join('\n')}`;
            } catch (e: any) {
                return `Erro ao listar: ${e.message}`;
            }
        }
    },

    'mcp_fs_tree': {
        name: 'mcp_fs_tree',
        description: '[MCP Filesystem] Retorna a estrutura de diretórios e arquivos em formato de árvore (tree). Essencial para entender a arquitetura do projeto rapidamente antes de codar.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho relativo ao workspace (ex: meu-site/ ou vazio para raiz)' },
                max_depth: { type: 'number', description: 'Profundidade máxima da árvore (padrão: 4)' }
            }
        },
        execute: async (args: any) => {
            try {
                await ensureWorkspace();
                const targetPath = path.join(WORKSPACE_ROOT, args.path || '');
                if (!targetPath.startsWith(WORKSPACE_ROOT)) return 'Erro: Caminho inválido.';

                const maxDepth = Math.min(10, Math.max(1, Number(args.max_depth || 4)));
                let treeOutput = `📦 ${args.path || '/'}\n`;
                let fileCount = 0;
                let dirCount = 0;

                async function buildTree(dir: string, prefix: string, currentDepth: number) {
                    if (currentDepth > maxDepth) return;

                    try {
                        const entries = await fs.readdir(dir, { withFileTypes: true });
                        // Sort: directories first, then files
                        entries.sort((a, b) => {
                            if (a.isDirectory() && !b.isDirectory()) return -1;
                            if (!a.isDirectory() && b.isDirectory()) return 1;
                            return a.name.localeCompare(b.name);
                        });

                        const filtered = entries.filter(e => !['node_modules', '.git', 'dist', 'build', '.next', '.turbo'].includes(e.name));

                        for (let i = 0; i < filtered.length; i++) {
                            const entry = filtered[i];
                            const isLast = i === filtered.length - 1;
                            const connector = isLast ? '└── ' : '├── ';

                            if (entry.isDirectory()) {
                                dirCount++;
                                treeOutput += `${prefix}${connector}📁 ${entry.name}\n`;
                                await buildTree(path.join(dir, entry.name), prefix + (isLast ? '    ' : '│   '), currentDepth + 1);
                            } else {
                                fileCount++;
                                treeOutput += `${prefix}${connector}📄 ${entry.name}\n`;
                            }
                        }
                    } catch (e) {
                        treeOutput += `${prefix}└── ❌ Acesso negado ou erro ao ler\n`;
                    }
                }

                await buildTree(targetPath, '', 1);

                return `Árvore de Diretórios (Profundidade: ${maxDepth}):\n${treeOutput}\nResumo: ${dirCount} pastas, ${fileCount} arquivos.`;
            } catch (e: any) {
                return `Erro ao gerar árvore: ${e.message}`;
            }
        }
    },

    'mcp_fs_create_directory': {
        name: 'mcp_fs_create_directory',
        description: '[MCP Filesystem] Cria um diretório (e subdiretórios) no projeto.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho do diretório a criar (ex: meu-site/src/components)' }
            },
            required: ['path']
        },
        execute: async (args: any) => {
            try {
                await ensureWorkspace();
                const fullPath = path.join(WORKSPACE_ROOT, args.path);
                if (!fullPath.startsWith(WORKSPACE_ROOT)) return 'Erro: Caminho inválido.';
                await fs.mkdir(fullPath, { recursive: true });
                return `Diretório criado: ${args.path}`;
            } catch (e: any) {
                return `Erro ao criar diretório: ${e.message}`;
            }
        }
    },

    'mcp_fs_delete': {
        name: 'mcp_fs_delete',
        description: '[MCP Filesystem] Deleta um arquivo ou pasta do projeto.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho a deletar' }
            },
            required: ['path']
        },
        execute: async (args: any) => {
            try {
                await ensureWorkspace();
                const fullPath = path.join(WORKSPACE_ROOT, args.path);
                if (!fullPath.startsWith(WORKSPACE_ROOT)) return 'Erro: Caminho inválido.';
                await fs.rm(fullPath, { recursive: true });
                return `Deletado com sucesso: ${args.path}`;
            } catch (e: any) {
                return `Erro ao deletar: ${e.message}`;
            }
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // 🧠 SEQUENTIAL THINKING (MCP Sequential Thinking equivalent)
    // ═══════════════════════════════════════════════════════════════

    'mcp_think_step_by_step': {
        name: 'mcp_think_step_by_step',
        description: '[MCP Thinking] Analisa um problema complexo passo a passo de forma estruturada. Use para decisões estratégicas, planejamento de projetos e análise de ROI.',
        parameters: {
            type: 'object',
            properties: {
                problem: { type: 'string', description: 'Descrição do problema ou decisão a analisar' },
                context: { type: 'string', description: 'Contexto adicional (orçamento, restrições, objetivos)' },
                num_steps: { type: 'number', description: 'Número de passos de análise (3-7)' }
            },
            required: ['problem']
        },
        execute: async (args: any) => {
            const steps = args.num_steps || 5;
            return `🧠 ANÁLISE ESTRUTURADA:

Problema: ${args.problem}
${args.context ? `Contexto: ${args.context}` : ''}

Analise este problema em ${steps} passos estruturados:
1. ENTENDER: Qual é o verdadeiro problema/oportunidade?
2. DADOS: Que informações já temos vs. o que precisamos?
3. ALTERNATIVAS: Quais são as opções viáveis (mínimo 3)?
4. AVALIAÇÃO: Prós, contras e ROI esperado de cada opção.
5. DECISÃO: Qual ação tomar e por quê?
${steps > 5 ? '6. IMPLEMENTAÇÃO: Passos concretos para executar.' : ''}
${steps > 6 ? '7. MÉTRICAS: Como medir sucesso?' : ''}

Use este framework para organizar seu raciocínio e responda com sua análise completa.`;
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // 🌐 BROWSER AUTOMATION (Playwright / Vision)
    // ═══════════════════════════════════════════════════════════════

    'mcp_browser_goto': {
        name: 'mcp_browser_goto',
        description: '[MCP Browser] Abre uma URL em um navegador Headless ISOLADO e pega o texto da tela (fecha após ler). Ideal para pesquisas ou checar se um site está no ar.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL para acessar (ex: http://localhost:5173 ou https://google.com)' }
            },
            required: ['url']
        },
        execute: async (args: any) => {
            let session;
            try {
                session = await createIsolatedPage();
                await session.page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
                const title = await session.page.title();
                const textContent = await session.page.evaluate(() => document.body.innerText.substring(0, 2000));
                return `✅ Navegou para: ${args.url}\n📌 Título: ${title}\n\n[Trecho Visível]\n${textContent.replace(/\\s+/g, ' ')}`;
            } catch (e: any) {
                return `❌ Erro de navegação: ${e.message}`;
            } finally {
                if (session?.context) await session.context.close();
            }
        }
    },

    'mcp_browser_click': {
        name: 'mcp_browser_click',
        description: '[DEPRECATED] Interação com browser (Click) desativada temporariamente. Devido ao modo isolado sem estado, clique não terá efeito persistente.',
        parameters: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] },
        execute: async () => 'Ferramenta temporariamente desativada. Use mcp_fetch_page ou mcp_browser_goto para inspecionar.'
    },

    'mcp_browser_type': {
        name: 'mcp_browser_type',
        description: '[DEPRECATED] Interação com browser (Type) desativada temporariamente. Devido ao modo isolado sem estado, digitação não terá efeito persistente.',
        parameters: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' } }, required: ['selector', 'text'] },
        execute: async () => 'Ferramenta temporariamente desativada. Use mcp_fetch_page ou mcp_browser_goto para inspecionar.'
    },

    'mcp_browser_screenshot': {
        name: 'mcp_browser_screenshot',
        description: '[MCP Browser] Tira uma screenshot de uma página em um navegador ISOLADO e salva no disco. Ideal para QA visual.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL para capturar (OBRIGATÓRIO)' },
                path: { type: 'string', description: 'Caminho para salvar a imagem (ex: screenshot.png) (OBRIGATÓRIO)' }
            },
            required: ['url', 'path']
        },
        execute: async (args: any) => {
            let session;
            try {
                if (!args.url || !args.path) return 'Erro: url e path são obrigatórios.';

                let savePath = path.join(WORKSPACE_ROOT, args.path);
                if (!savePath.startsWith(WORKSPACE_ROOT)) {
                    return 'Erro: Caminho inválido (Tentativa de path traversal).';
                }

                session = await createIsolatedPage();
                await session.page.goto(args.url, { waitUntil: 'networkidle', timeout: 15000 });
                await session.page.screenshot({ path: savePath, fullPage: true });

                return `📸 Screenshot de ${args.url} salva com sucesso em: ${args.path}`;
            } catch (e: any) {
                return `❌ Erro ao tirar screenshot: ${e.message}`;
            } finally {
                if (session?.context) await session.context.close();
            }
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // 🌐 WEB PAGE READER (MCP Fetch - fallback lightweight)
    // ═══════════════════════════════════════════════════════════════

    'mcp_fetch_page': {
        name: 'mcp_fetch_page',
        description: '[MCP Browser] Faz fetch de uma página web completa e extrai o texto principal. Use para ler documentação, tutoriais, artigos e referências.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL completa da página (ex: https://docs.vercel.com/getting-started)' }
            },
            required: ['url']
        },
        execute: async (args: any) => {
            try {
                const response = await fetch(args.url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'text/html,application/xhtml+xml'
                    },
                    signal: AbortSignal.timeout(10000)
                });
                const html = await response.text();
                const $ = cheerio.load(html);

                // Remove scripts, styles, nav, footer
                $('script, style, nav, footer, header, iframe, noscript').remove();

                // Try to get main content
                let text = '';
                const mainSelectors = ['main', 'article', '.content', '#content', '.post-content', '.entry-content', 'body'];
                for (const sel of mainSelectors) {
                    const el = $(sel);
                    if (el.length > 0) {
                        text = el.text().replace(/\s+/g, ' ').trim();
                        if (text.length > 200) break;
                    }
                }

                if (!text) text = $('body').text().replace(/\s+/g, ' ').trim();

                const title = $('title').text().trim();
                const description = $('meta[name="description"]').attr('content') || '';

                return `📄 Página: ${title}
🔗 URL: ${args.url}
📝 Descrição: ${description}

--- CONTEÚDO ---
${text.substring(0, 4000)}`;
            } catch (e: any) {
                return `Erro ao acessar ${args.url}: ${e.message}`;
            }
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // 🚀 PROJECT SCAFFOLD (Quick project creation)
    // ═══════════════════════════════════════════════════════════════

    'mcp_scaffold_project': {
        name: 'mcp_scaffold_project',
        description: '[MCP Dev] Cria a estrutura base de um projeto web completo (HTML/CSS/JS) pronto para deploy gratuito.',
        parameters: {
            type: 'object',
            properties: {
                project_name: { type: 'string', description: 'Nome do projeto (sem espaços, ex: meu-saas)' },
                type: { type: 'string', description: 'Tipo: landing, saas, blog, api, calculator' },
                description: { type: 'string', description: 'Breve descrição do projeto' }
            },
            required: ['project_name', 'type']
        },
        execute: async (args: any) => {
            try {
                await ensureWorkspace();
                const projectName = (typeof args?.project_name === 'string' ? args.project_name : '').trim();
                const projectType = (typeof args?.type === 'string' ? args.type : '').trim() || 'landing';
                const projectDesc = (args?.description ?? '').toString().trim();
                if (!projectName) {
                    return 'Erro ao criar projeto: project_name ausente. Use tool_args com { "project_name": "meu-projeto", "type": "landing", "description": "..." }.';
                }
                const projectDir = path.join(WORKSPACE_ROOT, projectName);
                try {
                    const existingIndex = path.join(projectDir, 'index.html');
                    await fs.access(existingIndex);
                    return `Projeto já existe: ${projectName}/ (index.html encontrado).`;
                } catch (e) { }
                await fs.mkdir(projectDir, { recursive: true });
                await fs.mkdir(path.join(projectDir, 'css'), { recursive: true });
                await fs.mkdir(path.join(projectDir, 'js'), { recursive: true });
                await fs.mkdir(path.join(projectDir, 'assets'), { recursive: true });

                const type = projectType.toLowerCase();
                const isCalculator = type === 'calculator' || type === 'calc' || type.includes('calcul');
                if (isCalculator) {
                    await fs.mkdir(path.join(projectDir, 'data'), { recursive: true });

                    await fs.writeFile(path.join(projectDir, 'index.html'), `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${projectDesc || projectName}">
    <title>${projectName}</title>
    <meta property="og:title" content="${projectName}">
    <meta property="og:description" content="${projectDesc || projectName}">
    <meta property="og:type" content="website">
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    <header class="topbar">
        <div class="container topbar-inner">
            <div class="brand">
                <div class="brand-mark">∑</div>
                <div class="brand-text">
                    <div class="brand-title">${projectName}</div>
                    <div class="brand-subtitle">${projectDesc || 'Calculadora simples e rápida'}</div>
                </div>
            </div>
            <a class="toplink" href="stats.php" target="_blank" rel="noopener noreferrer">Stats</a>
        </div>
    </header>

    <main class="container">
        <section class="card">
            <h1 class="h1">${projectName}</h1>
            <p class="muted">${projectDesc || 'Preencha os campos e veja o resultado instantaneamente.'}</p>

            <form id="calcForm" class="form" autocomplete="off">
                <div class="field">
                    <label for="a">Valor A</label>
                    <input id="a" name="a" inputmode="decimal" placeholder="Ex: 10" />
                </div>
                <div class="field">
                    <label for="b">Valor B</label>
                    <input id="b" name="b" inputmode="decimal" placeholder="Ex: 5" />
                </div>
                <div class="field">
                    <label for="op">Operação</label>
                    <select id="op" name="op">
                        <option value="add">A + B</option>
                        <option value="sub">A - B</option>
                        <option value="mul">A × B</option>
                        <option value="div">A ÷ B</option>
                    </select>
                </div>
                <button id="btnCalc" type="submit">Calcular</button>
            </form>

            <div class="result" aria-live="polite">
                <div class="result-label">Resultado</div>
                <div id="resultValue" class="result-value">—</div>
                <div id="resultHint" class="result-hint">Dica: edite js/app.js e adapte para o seu tipo de cálculo.</div>
            </div>
        </section>

        <section class="card">
            <h2 class="h2">Como funciona</h2>
            <div class="content">
                <p>Esta página é 100% estática (HTML/CSS/JS) e pronta para deploy via FTP.</p>
                <p>Ela inclui um tracker simples em PHP para contar visitas (track.php) e uma página de stats (stats.php).</p>
            </div>
        </section>
    </main>

    <footer class="footer">
        <div class="container footer-inner">
            <div>© ${new Date().getFullYear()} ${projectName}</div>
            <div class="muted">InstantCalc Factory</div>
        </div>
    </footer>

    <script src="js/app.js"></script>
</body>
</html>`, 'utf-8');

                    await fs.writeFile(path.join(projectDir, 'css', 'style.css'), `*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#0b1020;color:#e6eaff;line-height:1.5}
.container{width:min(980px,92vw);margin:0 auto}
.topbar{position:sticky;top:0;background:rgba(11,16,32,.85);backdrop-filter:blur(10px);border-bottom:1px solid rgba(255,255,255,.08)}
.topbar-inner{display:flex;align-items:center;justify-content:space-between;padding:14px 0;gap:12px}
.brand{display:flex;align-items:center;gap:12px}
.brand-mark{width:34px;height:34px;display:grid;place-items:center;border-radius:10px;background:linear-gradient(135deg,#5cf,#7b2ff7);color:#0b1020;font-weight:900}
.brand-title{font-weight:800;font-size:14px}
.brand-subtitle{font-size:12px;opacity:.75}
.toplink{color:#cfe1ff;text-decoration:none;border:1px solid rgba(255,255,255,.12);padding:8px 10px;border-radius:10px}
.toplink:hover{border-color:rgba(255,255,255,.22)}
.card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);border-radius:16px;padding:18px;margin:18px 0;box-shadow:0 10px 40px rgba(0,0,0,.25)}
.h1{font-size:22px;margin:0 0 6px}
.h2{font-size:16px;margin:0 0 10px}
.muted{opacity:.78}
.form{display:grid;grid-template-columns:1fr;gap:12px;margin-top:14px}
.field{display:flex;flex-direction:column;gap:6px}
label{font-size:12px;opacity:.85}
input,select{width:100%;padding:12px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(5,8,16,.65);color:#e6eaff;outline:none}
input:focus,select:focus{border-color:rgba(92,204,255,.55);box-shadow:0 0 0 4px rgba(92,204,255,.12)}
button{padding:12px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,#5cf,#7b2ff7);color:#0b1020;font-weight:800;cursor:pointer}
button:hover{filter:brightness(1.05)}
.result{margin-top:16px;padding:14px;border-radius:14px;border:1px dashed rgba(255,255,255,.16);background:rgba(0,0,0,.16)}
.result-label{font-size:12px;opacity:.78}
.result-value{font-size:28px;font-weight:900;margin-top:4px}
.result-hint{margin-top:6px;font-size:12px;opacity:.72}
.content{font-size:14px;opacity:.9}
.footer{border-top:1px solid rgba(255,255,255,.08);margin-top:26px;padding:18px 0}
.footer-inner{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;opacity:.85}
@media (min-width:720px){.form{grid-template-columns:repeat(3,1fr)}#btnCalc{grid-column:1 / -1}}`, 'utf-8');

                    await fs.writeFile(path.join(projectDir, 'js', 'app.js'), `function parseNumber(value){const s=(value??'').toString().trim().replace(/\\s+/g,'').replace(',','.');const n=Number(s);return Number.isFinite(n)?n:null}
function formatNumber(n){if(n===null||n===undefined||!Number.isFinite(Number(n)))return '—';const v=Number(n);if(Math.abs(v)>=1e9)return v.toExponential(3);return new Intl.NumberFormat('pt-BR',{maximumFractionDigits:6}).format(v)}

function compute(a,b,op){
    if(a===null||b===null) return { value: null, hint: 'Preencha os dois valores.' };
    if(op==='add') return { value: a + b, hint: '' };
    if(op==='sub') return { value: a - b, hint: '' };
    if(op==='mul') return { value: a * b, hint: '' };
    if(op==='div') return { value: b===0 ? null : a / b, hint: b===0 ? 'Divisão por zero não é permitida.' : '' };
    return { value: null, hint: 'Operação inválida.' };
}

function trackPageView(){
    const u = new URL(window.location.href);
    const p = u.pathname + (u.search || '');
    const url = 'track.php?p=' + encodeURIComponent(p) + '&t=' + Date.now();
    const img = new Image();
    img.src = url;
}

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('calcForm');
    const aEl = document.getElementById('a');
    const bEl = document.getElementById('b');
    const opEl = document.getElementById('op');
    const resultEl = document.getElementById('resultValue');
    const hintEl = document.getElementById('resultHint');

    function render(){
        const a = parseNumber(aEl.value);
        const b = parseNumber(bEl.value);
        const op = opEl.value;
        const out = compute(a,b,op);
        resultEl.textContent = formatNumber(out.value);
        hintEl.textContent = out.hint || 'OK.';
    }

    form.addEventListener('submit', (e) => { e.preventDefault(); render(); });
    aEl.addEventListener('input', render);
    bEl.addEventListener('input', render);
    opEl.addEventListener('change', render);

    trackPageView();
    render();
});`, 'utf-8');

                    await fs.writeFile(path.join(projectDir, 'track.php'), `<?php
$dataDir = __DIR__ . '/data';
if (!is_dir($dataDir)) { @mkdir($dataDir, 0755, true); }
$logFile = $dataDir . '/visits.log';

$p = isset($_GET['p']) ? substr($_GET['p'], 0, 500) : '/';
$ref = isset($_SERVER['HTTP_REFERER']) ? substr($_SERVER['HTTP_REFERER'], 0, 500) : '';
$ua = isset($_SERVER['HTTP_USER_AGENT']) ? substr($_SERVER['HTTP_USER_AGENT'], 0, 300) : '';
$ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '';
$ts = time();

$row = json_encode(array(
  'ts' => $ts,
  'p' => $p,
  'ref' => $ref,
  'ua' => $ua,
  'ip' => $ip
));
@file_put_contents($logFile, $row . \"\\n\", FILE_APPEND | LOCK_EX);

if (@filesize($logFile) > 1048576) {
  $lines = @file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
  if ($lines && count($lines) > 100) {
    $keep = array_slice($lines, -500);
    @file_put_contents($logFile, implode(\"\\n\", $keep) . \"\\n\", LOCK_EX);
  }
}

header('Content-Type: image/gif');
echo base64_decode('R0lGODlhAQABAPAAAAAAAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==');
?>`, 'utf-8');

                    await fs.writeFile(path.join(projectDir, 'stats.php'), `<?php
$logFile = __DIR__ . '/data/visits.log';
$lines = @file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
if (!$lines) { $lines = array(); }

$total = count($lines);
$perDay = array();
$last = array();
$maxLast = 20;

for ($i = max(0, $total - 1000); $i < $total; $i++) {
  $row = json_decode($lines[$i], true);
  if (!$row || !isset($row['ts'])) continue;
  $day = gmdate('Y-m-d', intval($row['ts']));
  if (!isset($perDay[$day])) $perDay[$day] = 0;
  $perDay[$day] += 1;
}

for ($i = max(0, $total - $maxLast); $i < $total; $i++) {
  $row = json_decode($lines[$i], true);
  if (!$row) continue;
  $ts = isset($row['ts']) ? intval($row['ts']) : 0;
  $p = isset($row['p']) ? $row['p'] : '';
  $ref = isset($row['ref']) ? $row['ref'] : '';
  $ip = isset($row['ip']) ? $row['ip'] : '';
  $last[] = array('ts' => $ts, 'p' => $p, 'ref' => $ref, 'ip' => $ip);
}

krsort($perDay);
header('Content-Type: text/plain; charset=utf-8');
echo \"InstantCalc Stats\\n\";
echo \"================\\n\";
echo \"Total: \" . $total . \"\\n\\n\";
echo \"Visitas por dia (UTC):\\n\";
foreach ($perDay as $day => $count) {
  echo \"- \" . $day . \": \" . $count . \"\\n\";
}
echo \"\\nÚltimas \" . count($last) . \" visitas:\\n\";
foreach ($last as $v) {
  $t = $v['ts'] ? gmdate('Y-m-d H:i:s', $v['ts']) : '-';
  $p = $v['p'];
  $ref = $v['ref'];
  $ip = $v['ip'];
  echo \"- \" . $t . \" | \" . $ip . \" | \" . $p . \" | \" . $ref . \"\\n\";
}
?>`, 'utf-8');

                    return `✅ Projeto "${projectName}" criado com sucesso em ${projectName}/!

Arquivos gerados:
📄 index.html (calculadora base)
📄 css/style.css (UI simples e mobile-first)
📄 js/app.js (cálculo + tracker)
📄 track.php (contador de visitas)
📄 stats.php (relatório em texto)
📁 data/ (logs locais)

Tipo: ${projectType}

Próximos passos: personalize labels/cálculo em js/app.js e o texto/SEO no index.html.`;
                }

                // index.html
                await fs.writeFile(path.join(projectDir, 'index.html'), `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${projectDesc || projectName}">
    <title>${projectName}</title>
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    <header id="header">
        <nav>
            <h1>${projectName}</h1>
        </nav>
    </header>
    <main id="app">
        <section class="hero">
            <h2>${projectDesc || 'Bem-vindo'}</h2>
            <p>Projeto criado automaticamente pela equipe de IA.</p>
        </section>
    </main>
    <footer>
        <p>&copy; ${new Date().getFullYear()} ${projectName}. Todos os direitos reservados.</p>
    </footer>
    <script src="js/app.js"></script>
</body>
</html>`, 'utf-8');

                // style.css
                await fs.writeFile(path.join(projectDir, 'css', 'style.css'), `* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; }
header { padding: 1rem 2rem; background: #111; border-bottom: 1px solid #222; }
header h1 { font-size: 1.5rem; color: #00d4ff; }
.hero { text-align: center; padding: 4rem 2rem; }
.hero h2 { font-size: 2.5rem; margin-bottom: 1rem; background: linear-gradient(135deg, #00d4ff, #7b2ff7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.hero p { font-size: 1.1rem; color: #888; }
footer { text-align: center; padding: 2rem; color: #555; border-top: 1px solid #222; margin-top: 4rem; }
`, 'utf-8');

                // app.js
                await fs.writeFile(path.join(projectDir, 'js', 'app.js'), `console.log('${projectName} loaded successfully!');

document.addEventListener('DOMContentLoaded', () => {
    console.log('App ready.');
});
`, 'utf-8');

                return `✅ Projeto "${projectName}" criado com sucesso em ${projectName}/!

Arquivos gerados:
📄 index.html (página principal)
📄 css/style.css (estilos modernos dark mode)
📄 js/app.js (lógica JavaScript)
📁 assets/ (pasta para imagens)

Tipo: ${projectType}

Próximos passos: Edite os arquivos com mcp_fs_write_file para personalizar.`;
            } catch (e: any) {
                return `Erro ao criar projeto: ${e.message}`;
            }
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // 🔬 QA & LINTING (Autonomous verification)
    // ═══════════════════════════════════════════════════════════════

    'mcp_lint_project': {
        name: 'mcp_lint_project',
        description: '[MCP QA] Analisa um arquivo de código ou projeto inteiro em busca de erros de sintaxe e quebras estruturais (QA).',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho do arquivo ou projeto no workspace (ex: meu-site/js/app.js)' },
                lang: { type: 'string', enum: ['js', 'html', 'css', 'php'], description: 'Linguagem (opcional)' }
            },
            required: ['path']
        },
        execute: async (args: any) => {
            try {
                await ensureWorkspace();
                const targetPath = path.join(WORKSPACE_ROOT, args.path);
                if (!targetPath.startsWith(WORKSPACE_ROOT)) return 'Erro: Caminho inválido.';

                let stat: any;
                try {
                    stat = await fs.stat(targetPath);
                } catch(e) {
                    return `Erro: Arquivo/Diretório não encontrado em ${args.path}`;
                }

                // If it's a JS file, we can do a quick node --check
                if (stat.isFile()) {
                    const ext = path.extname(targetPath).toLowerCase();
                    if (ext === '.js' || args.lang === 'js') {
                        try {
                            const { stderr } = await execAsync(`node --check ${shellEscapePosix(targetPath)}`);
                            if (stderr) return `❌ ERRO DE SINTAXE (JS):\n${stderr.substring(0, 1000)}`;
                            return `✅ NENHUM ERRO DE SINTAXE DETECTADO EM ${args.path} (JS/Node)`;
                        } catch(e: any) {
                            return `❌ ERRO DE SINTAXE (JS):\n${(e.stderr || e.message).substring(0, 1000)}`;
                        }
                    }
                    if (ext === '.php' || args.lang === 'php') {
                        try {
                            const { stdout, stderr } = await execAsync(`php -l ${shellEscapePosix(targetPath)}`);
                            return `✅ LINT PHP:\n${stdout.substring(0, 500)}`;
                        } catch(e: any) {
                            return `❌ ERRO DE SINTAXE (PHP):\n${(e.stdout || e.stderr || e.message).substring(0, 1000)}`;
                        }
                    }

                    // Basic fallback for HTML check
                    if (ext === '.html') {
                        const content = await fs.readFile(targetPath, 'utf8');
                        let errors = [];
                        if (content.split('<html').length > 2) errors.push('Múltiplas tags <html> detectadas.');
                        if (content.includes('undefined')) errors.push('Encontrado "undefined" injetado no HTML.');
                        if (!content.includes('</body>')) errors.push('Tag </body> faltando.');

                        if (errors.length > 0) return `❌ PROBLEMAS DETECTADOS (HTML):\n- ${errors.join('\n- ')}`;
                        return `✅ HTML LINT PASS (Checagem Básica): Nenhum erro estrutural crítico encontrado em ${args.path}.`;
                    }
                }

                // If it's a directory, just return a success check of basic validation
                return `ℹ️ Verificação genérica para diretório (${args.path}) não suporta análise profunda ainda. Execute em arquivos específicos (.js, .html, .php).`;
            } catch (e: any) {
                return `Erro no linter: ${e.message}`;
            }
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // 🔧 SHELL EXECUTE (Safe sandboxed terminal)
    // ═══════════════════════════════════════════════════════════════

    'mcp_shell_exec': {
        name: 'mcp_shell_exec',
        description: '[MCP Shell] Executa um comando no terminal do servidor (dentro do workspace de projetos). NUNCA rode comandos interativos (ex: sempre use -y). Comandos que aguardam input do usuário vão causar timeout e falhar.',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'Comando a executar (ex: npm install --yes, git init, npm run build)' }
            },
            required: ['command']
        },
        execute: async (args: any) => {
            try {
                await ensureWorkspace();
                console.log(`[MCP Shell] ${args.agentName || 'Agent'} is attempting command: ${args.command}`);

                // Block dangerous commands (using word boundary for precision)
                const blockedPatterns = [
                    /\brm\s+-rf\s+\//,
                    /\bshutdown\b/,
                    /\breboot\b/,
                    /\bkill\s+-[0-9]+\b/,
                    /\bkillall\b/,
                    /\bdd\b/,
                    /\bnano\b/,
                    /\bvim\b/,
                    /\bvi\b/,
                    /\btop\b/,
                    /\bhtop\b/
                ];

                if (blockedPatterns.some(pattern => pattern.test(args.command))) {
                    return 'Erro: Comando bloqueado por segurança (comando interativo ou perigoso detectado).';
                }

                const { stdout, stderr } = await execAsync(args.command, {
                    cwd: WORKSPACE_ROOT,
                    timeout: 15000, // Timeout mais curto (15s) para comandos que travam o loop
                    env: { ...process.env, HOME: '/tmp' }
                });

                const output = (stdout + (stderr ? `\n[stderr]: ${stderr}` : '')).trim();
                return `$ ${args.command}\n\n${output.substring(0, 4000)}`;
            } catch (e: any) {
                // Melhorando a mensagem de erro para Timeout de comandos interativos
                if (e.message && e.message.includes('Command failed') && e.message.includes('timeout')) {
                     return `❌ Erro de Timeout: O comando "${args.command}" demorou mais que 15 segundos ou travou esperando input interativo do usuário (como [Y/n]). Revise o comando e adicione flags como -y ou --yes.`;
                }
                return `Erro na execução: ${e.message}`;
            }
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // 📊 COMPANY DASHBOARD (Business Intelligence)
    // ═══════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════
    // 🚚 DEPLOY & AUTOMATION (Real world impact)
    // ═══════════════════════════════════════════════════════════════

    'mcp_github_push_repo': {
        name: 'mcp_github_push_repo',
        description: '[MCP Git] Faz push de um projeto local para um repositório no seu GitHub. Cria o repo se não existir.',
        parameters: {
            type: 'object',
            properties: {
                project_path: { type: 'string', description: 'Caminho do projeto no workspace (ex: meu-saas)' },
                repo_name: { type: 'string', description: 'Nome do repositório no GitHub' },
                is_public: { type: 'boolean', description: 'Se o repo deve ser público (padrão: false)' }
            },
            required: ['project_path', 'repo_name']
        },
        execute: async (args: any) => {
            try {
                const { db } = await import('./db.js');
                const githubToken = db.prepare("SELECT key_value FROM vault WHERE service = 'github' LIMIT 1").get() as any;

                if (!githubToken?.key_value) {
                    return 'Erro: Token do GitHub não encontrado no Cofre. O investidor precisa adicionar o token primeiro.';
                }

                const localPath = path.join(WORKSPACE_ROOT, args.project_path);
                const token = githubToken.key_value;

                // 1. Initialize git if needed
                await execAsync('git init', { cwd: localPath });

                // 1.1 Config user (necessary for commit)
                try {
                    await execAsync('git config user.email "office-agents@seolife.corp"', { cwd: localPath });
                    await execAsync('git config user.name "Pixel Office Agents"', { cwd: localPath });
                } catch (e) { }

                // 2. Add and commit
                await execAsync('git add .', { cwd: localPath });
                try {
                    await execAsync('git commit -m "Deploy by Pixel Office Agents"', { cwd: localPath });
                } catch (e) {
                    // It's okay if it fails (maybe nothing to commit)
                }

                // 3. Create repo via GitHub API
                const createResponse = await fetch('https://api.github.com/user/repos', {
                    method: 'POST',
                    headers: {
                        'Authorization': `token ${token}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name: args.repo_name,
                        private: !args.is_public,
                        auto_init: false
                    })
                });

                // 4. Push
                const userResponse = await fetch('https://api.github.com/user', {
                    headers: { 'Authorization': `token ${token}` }
                });
                const userData = await userResponse.json();
                const userName = userData.login;

                const remoteUrl = `https://${token}@github.com/${userName}/${args.repo_name}.git`;
                try {
                    await execAsync(`git remote add origin ${remoteUrl}`, { cwd: localPath });
                } catch (e) {
                    await execAsync(`git remote set-url origin ${remoteUrl}`, { cwd: localPath });
                }

                await execAsync('git branch -M main', { cwd: localPath });
                await execAsync('git push -u origin main', { cwd: localPath });

                return `🚀 Sucesso! Projeto "${args.project_path}" enviado para: https://github.com/${userName}/${args.repo_name}`;
            } catch (e: any) {
                return `Erro no deploy GitHub: ${e.message}`;
            }
        }
    },

    'mcp_vercel_deploy': {
        name: 'mcp_vercel_deploy',
        description: '[MCP Vercel] Realiza o deploy do projeto na Vercel para torná-lo público com HTTPS.',
        parameters: {
            type: 'object',
            properties: {
                project_path: { type: 'string', description: 'Caminho do projeto (ex: meu-saas)' }
            },
            required: ['project_path']
        },
        execute: async (args: any) => {
            try {
                const { db } = await import('./db.js');
                const vercelToken = db.prepare("SELECT key_value FROM vault WHERE service = 'vercel' LIMIT 1").get() as any;

                if (!vercelToken?.key_value) {
                    return 'Erro: Token da Vercel não encontrado no Cofre.';
                }

                const localPath = path.join(WORKSPACE_ROOT, args.project_path);
                const token = vercelToken.key_value;

                // 1. Recursive file reader
                async function getAllFiles(dirPath: string, arrayOfFiles: any[] = [], relativePrefix: string = '') {
                    const files = await fs.readdir(dirPath);
                    for (const file of files) {
                        if (file === 'node_modules' || file === '.git' || file === '.next') continue;
                        const fullPath = path.join(dirPath, file);
                        const relPath = relativePrefix ? `${relativePrefix}/${file}` : file;
                        if ((await fs.stat(fullPath)).isDirectory()) {
                            await getAllFiles(fullPath, arrayOfFiles, relPath);
                        } else {
                            const content = await fs.readFile(fullPath);
                            arrayOfFiles.push({
                                file: relPath,
                                data: content.toString('base64'),
                                encoding: 'base64'
                            });
                        }
                    }
                    return arrayOfFiles;
                }

                const files = await getAllFiles(localPath);

                // 2. Trigger Vercel Deployment API
                const response = await fetch('https://api.vercel.com/v13/deployments', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name: args.project_path,
                        files: files.map(f => ({ file: f.file, data: f.data, encoding: f.encoding })),
                        projectSettings: { framework: null } // Static project
                    })
                });

                const data = await response.json() as any;
                if (!response.ok) throw new Error(data.error?.message || 'Erro Vercel');

                return `🚀 Prooooonto! Seu site está no ar pela Vercel!
🔗 URL: https://${data.url}
🖼️ Dashboard: https://vercel.com/dashboard/deployments/${data.id}`;
            } catch (e: any) {
                return `Erro no deploy Vercel: ${e.message}`;
            }
        }
    },

    'mcp_hosting_status': {
        name: 'mcp_hosting_status',
        description: '[MCP Hosting] Mostra se o servidor próprio (FTP/cPanel) está configurado no Cofre.',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        },
        execute: async () => {
            try {
                const domain = (await vaultGetFirst(['hosting_domain', 'cpanel_domain'])).trim();
                const ftpHost = (await vaultGetFirst(['hosting_ftp_host', 'cpanel_host'])).trim();
                const ftpUser = (await vaultGetFirst(['hosting_ftp_username', 'cpanel_user'])).trim();
                const ftpPass = (await vaultGetFirst(['hosting_ftp_password', 'cpanel_pass'])).trim();
                const cpanelHost = (await vaultGetFirst(['hosting_cpanel_host', 'cpanel_host'])).trim();
                const cpanelUser = (await vaultGetFirst(['hosting_cpanel_username', 'cpanel_user', 'hosting_ftp_username'])).trim();
                const cpanelPass = (await vaultGetFirst(['hosting_cpanel_password', 'cpanel_pass', 'hosting_ftp_password'])).trim();

                const hasFtp = Boolean((ftpHost || '').trim() && (ftpUser || '').trim() && (ftpPass || '').trim());
                const hasCpanel = Boolean(((cpanelHost || domain || '').trim()) && ((cpanelUser || ftpUser || '').trim()) && ((cpanelPass || ftpPass || '').trim()));

                return [
                    '🛰️ HOSTING – STATUS',
                    '═══════════════════════════════',
                    `🌐 Domínio: ${domain ? domain : '(não configurado: hosting_domain ou cpanel_domain)'}`,
                    `📦 FTP: ${hasFtp ? `OK (host=${ftpHost}, user=${ftpUser})` : 'NÃO configurado (precisa hosting_ftp_* OU cpanel_*)'}`,
                    `🧩 cPanel API: ${hasCpanel ? `OK (host=${cpanelHost || domain}, user=${cpanelUser || ftpUser})` : 'NÃO configurado (precisa hosting_cpanel_* OU cpanel_* OU reutiliza FTP)'}`,
                    '',
                    'Chaves esperadas no Cofre (service = hosting):',
                    '  - hosting_domain',
                    '  - hosting_ftp_host',
                    '  - hosting_ftp_username',
                    '  - hosting_ftp_password',
                    '  - hosting_cpanel_host (opcional)',
                    '  - hosting_cpanel_username (opcional)',
                    '  - hosting_cpanel_password (opcional)',
                    '',
                    'Chaves legadas aceitas (fallback automático):',
                    '  - cpanel_domain',
                    '  - cpanel_host',
                    '  - cpanel_user',
                    '  - cpanel_pass'
                ].join('\n');
            } catch (e: any) {
                return `Erro ao ler hosting do Cofre: ${e.message}`;
            }
        }
    },

    'mcp_hosting_fetch_stats': {
        name: 'mcp_hosting_fetch_stats',
        description: '[MCP Hosting] Lê o stats.php de um site publicado (tracker de visitas).',
        parameters: {
            type: 'object',
            properties: {
                subdomain: { type: 'string', description: 'Subdomínio (ex: imc, juros, calc)' },
                path: { type: 'string', description: 'Caminho (padrão: stats.php)' },
                max_chars: { type: 'number', description: 'Máximo de caracteres retornados (padrão: 2000, máx 6000)' }
            },
            required: ['subdomain']
        },
        execute: async (args: any) => {
            try {
                const domain = (await vaultGetFirst(['hosting_domain', 'cpanel_domain'])).trim();
                if (!domain) return 'Erro: domínio não configurado no Cofre (hosting_domain ou cpanel_domain).';
                const sub = normalizeSubdomain(args.subdomain);
                if (!sub) return 'Erro: subdomain inválido.';
                const p = (args.path || 'stats.php').toString().trim().replace(/^\/+/g, '');
                const maxChars = Math.min(6000, Math.max(200, Number(args.max_chars || 2000)));

                const urls = [
                    `https://${sub}.${domain}/${p}`,
                    `http://${sub}.${domain}/${p}`,
                    `https://${domain}/${sub}/${p}`,
                    `http://${domain}/${sub}/${p}`
                ];

                let lastErr = '';
                for (const url of urls) {
                    try {
                        const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) });
                        const text = await res.text();
                        if (!res.ok) {
                            lastErr = `Erro ao ler stats (${res.status}): ${text.slice(0, maxChars)}`;
                            continue;
                        }
                        return `📈 Stats: ${url}\n\n${text.slice(0, maxChars)}`;
                    } catch (e: any) {
                        lastErr = `Erro ao ler stats: ${e?.message || String(e)}`;
                        continue;
                    }
                }

                return lastErr || 'Erro ao ler stats: falha desconhecida.';
            } catch (e: any) {
                return `Erro ao ler stats: ${e.message}`;
            }
        }
    },

    'mcp_hosting_deploy_status': {
        name: 'mcp_hosting_deploy_status',
        description: '[MCP Hosting] Verifica se uma URL publicada está respondendo (status HTTP).',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL completa (ex: https://imc.seudominio.com/)' },
                timeout_ms: { type: 'number', description: 'Timeout em ms (padrão: 12000, máx 30000)' },
                max_chars: { type: 'number', description: 'Máximo de caracteres do body (padrão: 400, máx 1200)' }
            },
            required: ['url']
        },
        execute: async (args: any) => {
            try {
                const rawUrl = (args?.url || '').toString().trim();
                if (!rawUrl) return 'Erro: url ausente.';
                let u: URL;
                try {
                    u = new URL(rawUrl);
                } catch (e) {
                    return 'Erro: url inválida. Use uma URL completa com http/https.';
                }
                if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Erro: protocolo inválido (use http/https).';

                const timeoutMs = Math.min(30000, Math.max(2000, Number(args?.timeout_ms || 12000)));
                const maxChars = Math.min(1200, Math.max(120, Number(args?.max_chars || 400)));

                let res: Response;
                try {
                    res = await fetch(u.toString(), { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
                } catch (e: any) {
                    return `Erro ao acessar URL: ${e?.message || String(e)}`;
                }

                let body = '';
                try {
                    body = (await res.text()).slice(0, maxChars);
                } catch (e) { }

                return [
                    '✅ Deploy status',
                    `URL: ${u.toString()}`,
                    `HTTP: ${res.status} ${res.statusText || ''}`.trim(),
                    body ? `Body (amostra): ${body.replace(/\s+/g, ' ').trim()}` : 'Body (amostra): (vazio)'
                ].join('\n');
            } catch (e: any) {
                return `Erro ao checar deploy: ${e.message}`;
            }
        }
    },

    'mcp_hosting_create_subdomain': {
        name: 'mcp_hosting_create_subdomain',
        description: '[MCP Hosting] Cria um subdomínio via cPanel UAPI (se disponível).',
        parameters: {
            type: 'object',
            properties: {
                subdomain: { type: 'string', description: 'Parte do subdomínio (ex: juros, bmi, calc)' },
                directory: { type: 'string', description: 'Diretório (padrão: public_html/<subdomain>)' }
            },
            required: ['subdomain']
        },
        execute: async (args: any) => {
            try {
                const domain = (await vaultGetFirst(['hosting_domain', 'cpanel_domain'])).trim();
                if (!domain) return 'Erro: domínio não configurado no Cofre (hosting_domain ou cpanel_domain).';

                const host = (await vaultGetFirst(['hosting_cpanel_host', 'cpanel_host'])).trim() || domain;
                const username = (await vaultGetFirst(['hosting_cpanel_username', 'cpanel_user', 'hosting_ftp_username'])).trim();
                const password = (await vaultGetFirst(['hosting_cpanel_password', 'cpanel_pass', 'hosting_ftp_password'])).trim();

                if (!host || !username || !password) return 'Erro: credenciais do cPanel não configuradas no Cofre.';

                const sub = normalizeSubdomain(args.subdomain);
                if (!sub) return 'Erro: subdomain inválido.';

                const dir = (args.directory || `public_html/${sub}`).toString().trim();
                const url = `https://${host}:2083/execute/SubDomain/addsubdomain?domain=${encodeURIComponent(sub)}&rootdomain=${encodeURIComponent(domain)}&dir=${encodeURIComponent(dir)}`;
                const auth = Buffer.from(`${username}:${password}`).toString('base64');
                const res = await fetch(url, {
                    method: 'GET',
                    headers: { 'Authorization': `Basic ${auth}` },
                    signal: AbortSignal.timeout(15000)
                });
                const text = await res.text();
                if (!res.ok) return `Erro cPanel (${res.status}): ${redactSecrets(text, [password]).slice(0, 1500)}`;

                return `✅ Subdomínio solicitado: https://${sub}.${domain}/\nDiretório: ${dir}\nResposta cPanel: ${redactSecrets(text, [password]).slice(0, 1500)}`;
            } catch (e: any) {
                return `Erro ao criar subdomínio: ${e.message}`;
            }
        }
    },

    'mcp_hosting_list_subdomains': {
        name: 'mcp_hosting_list_subdomains',
        description: '[MCP Hosting] Lista subdomínios via cPanel UAPI (se disponível).',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        },
        execute: async () => {
            try {
                const domain = (await vaultGetFirst(['hosting_domain', 'cpanel_domain'])).trim();
                if (!domain) return 'Erro: domínio não configurado no Cofre (hosting_domain ou cpanel_domain).';

                const host = (await vaultGetFirst(['hosting_cpanel_host', 'cpanel_host'])).trim() || domain;
                const username = (await vaultGetFirst(['hosting_cpanel_username', 'cpanel_user', 'hosting_ftp_username'])).trim();
                const password = (await vaultGetFirst(['hosting_cpanel_password', 'cpanel_pass', 'hosting_ftp_password'])).trim();

                if (!host || !username || !password) return 'Erro: credenciais do cPanel não configuradas no Cofre.';

                const url = `https://${host}:2083/execute/SubDomain/listsubdomains?api.version=1`;
                const auth = Buffer.from(`${username}:${password}`).toString('base64');
                const res = await fetch(url, {
                    method: 'GET',
                    headers: { 'Authorization': `Basic ${auth}` },
                    signal: AbortSignal.timeout(15000)
                });
                const text = await res.text();
                if (!res.ok) return `Erro cPanel (${res.status}): ${redactSecrets(text, [password]).slice(0, 1500)}`;
                return `Subdomínios (raw):\n${redactSecrets(text, [password]).slice(0, 3000)}`;
            } catch (e: any) {
                return `Erro ao listar subdomínios: ${e.message}`;
            }
        }
    },

    'mcp_hosting_test_ftp': {
        name: 'mcp_hosting_test_ftp',
        description: '[MCP Hosting] Testa login FTP e acesso ao diretório remoto (sem subir arquivos).',
        parameters: {
            type: 'object',
            properties: {
                remote_dir: { type: 'string', description: 'Diretório remoto para testar (padrão: public_html)' }
            },
            required: []
        },
        execute: async (args: any) => {
            try {
                const ftpHost = (await vaultGetFirst(['hosting_ftp_host', 'cpanel_host'])).trim();
                const ftpUser = (await vaultGetFirst(['hosting_ftp_username', 'cpanel_user'])).trim();
                const ftpPass = (await vaultGetFirst(['hosting_ftp_password', 'cpanel_pass'])).trim();
                if (!ftpHost || !ftpUser || !ftpPass) return 'Erro: credenciais FTP não configuradas no Cofre.';

                const dir = (args.remote_dir || 'public_html').toString().trim().replace(/^\/+/g, '').replace(/\/+$/g, '');
                const url = `ftp://${ftpHost}/${dir}/`;
                const cmd = [
                    'curl',
                    '--silent',
                    '--show-error',
                    '--fail',
                    '--list-only',
                    '--user',
                    shellEscapePosix(`${ftpUser}:${ftpPass}`),
                    shellEscapePosix(url)
                ].join(' ');
                const { stdout } = await execAsync(cmd, { maxBuffer: 1024 * 1024 * 10 });
                const safeOut = stdout.toString().split('\n').slice(0, 80).join('\n');
                return `✅ FTP OK\nHost: ${ftpHost}\nDir: ${dir}\nAmostra:\n${safeOut || '(vazio)'}`;
            } catch (e: any) {
                const ftpPass = await vaultGetFirst(['hosting_ftp_password', 'cpanel_pass']);
                const stderr = redactSecrets((e?.stderr || e?.message || '').toString(), [ftpPass]);
                return `❌ FTP falhou: ${stderr.slice(0, 1800)}`;
            }
        }
    },

    'mcp_hosting_test_cpanel': {
        name: 'mcp_hosting_test_cpanel',
        description: '[MCP Hosting] Testa autenticação no cPanel UAPI (porta 2083) listando subdomínios.',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        },
        execute: async () => {
            try {
                const domain = (await vaultGetFirst(['hosting_domain', 'cpanel_domain'])).trim();
                if (!domain) return 'Erro: domínio não configurado no Cofre (hosting_domain ou cpanel_domain).';

                const host = (await vaultGetFirst(['hosting_cpanel_host', 'cpanel_host'])).trim() || domain;
                const username = (await vaultGetFirst(['hosting_cpanel_username', 'cpanel_user', 'hosting_ftp_username'])).trim();
                const password = (await vaultGetFirst(['hosting_cpanel_password', 'cpanel_pass', 'hosting_ftp_password'])).trim();
                if (!host || !username || !password) return 'Erro: credenciais do cPanel não configuradas no Cofre.';

                const url = `https://${host}:2083/execute/SubDomain/listsubdomains?api.version=1`;
                const auth = Buffer.from(`${username}:${password}`).toString('base64');
                const res = await fetch(url, {
                    method: 'GET',
                    headers: { 'Authorization': `Basic ${auth}` },
                    signal: AbortSignal.timeout(15000)
                });
                const text = await res.text();
                if (!res.ok) return `❌ cPanel falhou (${res.status}): ${redactSecrets(text, [password]).slice(0, 1500)}`;
                return `✅ cPanel OK\nHost: ${host}\nUser: ${username}\nResposta:\n${redactSecrets(text, [password]).slice(0, 1500)}`;
            } catch (e: any) {
                return `Erro ao testar cPanel: ${e.message}`;
            }
        }
    },

    'mcp_hosting_email_list': {
        name: 'mcp_hosting_email_list',
        description: '[MCP Hosting] Lista contas de e-mail via cPanel UAPI (se disponível).',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        },
        execute: async () => {
            try {
                const domain = (await vaultGetFirst(['hosting_domain', 'cpanel_domain'])).trim();
                if (!domain) return 'Erro: domínio não configurado no Cofre (hosting_domain ou cpanel_domain).';

                const host = (await vaultGetFirst(['hosting_cpanel_host', 'cpanel_host'])).trim() || domain;
                const username = (await vaultGetFirst(['hosting_cpanel_username', 'cpanel_user', 'hosting_ftp_username'])).trim();
                const password = (await vaultGetFirst(['hosting_cpanel_password', 'cpanel_pass', 'hosting_ftp_password'])).trim();
                if (!host || !username || !password) return 'Erro: credenciais do cPanel não configuradas no Cofre.';

                const url = `https://${host}:2083/execute/Email/list_pops?api.version=1`;
                const auth = Buffer.from(`${username}:${password}`).toString('base64');
                const res = await fetch(url, {
                    method: 'GET',
                    headers: { 'Authorization': `Basic ${auth}` },
                    signal: AbortSignal.timeout(15000)
                });
                const text = await res.text();
                if (!res.ok) return `Erro cPanel (${res.status}): ${redactSecrets(text, [password]).slice(0, 1500)}`;
                return `E-mails (raw):\n${redactSecrets(text, [password]).slice(0, 3000)}`;
            } catch (e: any) {
                return `Erro ao listar e-mails: ${e.message}`;
            }
        }
    },

    'mcp_hosting_email_create': {
        name: 'mcp_hosting_email_create',
        description: '[MCP Hosting] Cria uma conta de e-mail via cPanel UAPI (se disponível).',
        parameters: {
            type: 'object',
            properties: {
                email_user: { type: 'string', description: 'Parte antes do @ (ex: hello, suporte, contato)' },
                password: { type: 'string', description: 'Senha da conta de e-mail' },
                quota_mb: { type: 'number', description: 'Quota em MB (padrão: 250)' }
            },
            required: ['email_user', 'password']
        },
        execute: async (args: any) => {
            try {
                const domain = (await vaultGetFirst(['hosting_domain', 'cpanel_domain'])).trim();
                if (!domain) return 'Erro: domínio não configurado no Cofre (hosting_domain ou cpanel_domain).';

                const host = (await vaultGetFirst(['hosting_cpanel_host', 'cpanel_host'])).trim() || domain;
                const username = (await vaultGetFirst(['hosting_cpanel_username', 'cpanel_user', 'hosting_ftp_username'])).trim();
                const password = (await vaultGetFirst(['hosting_cpanel_password', 'cpanel_pass', 'hosting_ftp_password'])).trim();
                if (!host || !username || !password) return 'Erro: credenciais do cPanel não configuradas no Cofre.';

                const emailUser = (args.email_user || '').toString().trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
                if (!emailUser) return 'Erro: email_user inválido.';
                const emailPass = (args.password || '').toString();
                if (!emailPass || emailPass.length < 8) return 'Erro: senha do e-mail muito curta (mínimo 8).';
                const quotaMb = Number(args.quota_mb ?? 250);
                const quota = Number.isFinite(quotaMb) && quotaMb >= 10 ? Math.floor(quotaMb) : 250;

                const url = `https://${host}:2083/execute/Email/add_pop?api.version=1&email=${encodeURIComponent(emailUser)}&domain=${encodeURIComponent(domain)}&password=${encodeURIComponent(emailPass)}&quota=${encodeURIComponent(String(quota))}`;
                const auth = Buffer.from(`${username}:${password}`).toString('base64');
                const res = await fetch(url, {
                    method: 'GET',
                    headers: { 'Authorization': `Basic ${auth}` },
                    signal: AbortSignal.timeout(15000)
                });
                const text = await res.text();
                if (!res.ok) return `Erro cPanel (${res.status}): ${redactSecrets(text, [password, emailPass]).slice(0, 1500)}`;
                return `✅ E-mail criado: ${emailUser}@${domain}\nQuota: ${quota}MB\nResposta cPanel: ${redactSecrets(text, [password, emailPass]).slice(0, 1500)}`;
            } catch (e: any) {
                return `Erro ao criar e-mail: ${e.message}`;
            }
        }
    },

    'mcp_hosting_email_send_smtp': {
        name: 'mcp_hosting_email_send_smtp',
        description: '[MCP Hosting] Envia e-mail via SMTP (curl) usando uma conta do domínio.',
        parameters: {
            type: 'object',
            properties: {
                from_email: { type: 'string', description: 'E-mail remetente completo (ex: hello@instantcalc.info)' },
                from_password: { type: 'string', description: 'Senha do e-mail remetente' },
                to: { type: 'array', items: { type: 'string' }, description: 'Lista de destinatários' },
                subject: { type: 'string', description: 'Assunto' },
                body: { type: 'string', description: 'Corpo do e-mail (texto)' },
                smtp_host: { type: 'string', description: 'Host SMTP (padrão: mail.<domínio>)' },
                smtp_port: { type: 'number', description: 'Porta SMTP (padrão: 587)' },
                use_tls: { type: 'boolean', description: 'Usar TLS/STARTTLS (padrão: true)' }
            },
            required: ['from_email', 'from_password', 'to', 'subject', 'body']
        },
        execute: async (args: any) => {
            try {
                const domain = (await vaultGetFirst(['hosting_domain', 'cpanel_domain'])).trim();
                if (!domain) return 'Erro: domínio não configurado no Cofre (hosting_domain ou cpanel_domain).';

                const fromEmail = (args.from_email || '').toString().trim();
                const fromPass = (args.from_password || '').toString();
                const toList = Array.isArray(args.to) ? args.to.map((x: any) => (x || '').toString().trim()).filter(Boolean) : [];
                const subject = (args.subject || '').toString();
                const body = (args.body || '').toString();
                if (!fromEmail.includes('@')) return 'Erro: from_email inválido.';
                if (!fromPass || fromPass.length < 6) return 'Erro: from_password inválida.';
                if (toList.length === 0) return 'Erro: lista to vazia.';

                const smtpHost = ((args.smtp_host || `mail.${domain}`) as any).toString().trim();
                const smtpPort = Number(args.smtp_port ?? 587);
                const port = Number.isFinite(smtpPort) && smtpPort > 0 ? Math.floor(smtpPort) : 587;
                const useTls = args.use_tls !== false;

                const now = new Date().toUTCString();
                const mime = [
                    `Date: ${now}`,
                    `From: ${fromEmail}`,
                    `To: ${toList.join(', ')}`,
                    `Subject: ${subject}`,
                    'MIME-Version: 1.0',
                    'Content-Type: text/plain; charset=utf-8',
                    '',
                    body
                ].join('\r\n');

                const tmpName = `mail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.txt`;
                const tmpPath = path.join('/tmp', tmpName);
                await fs.writeFile(tmpPath, mime, 'utf-8');

                const url = `smtp://${smtpHost}:${port}`;
                const parts: string[] = [
                    'curl',
                    '--silent',
                    '--show-error',
                    '--fail',
                    useTls ? '--ssl-reqd' : '',
                    '--url',
                    shellEscapePosix(url),
                    '--user',
                    shellEscapePosix(`${fromEmail}:${fromPass}`),
                    '--mail-from',
                    shellEscapePosix(fromEmail)
                ].filter(Boolean);
                for (const rcpt of toList) {
                    parts.push('--mail-rcpt', shellEscapePosix(rcpt));
                }
                parts.push('--upload-file', shellEscapePosix(tmpPath));

                try {
                    await execAsync(parts.join(' '), { maxBuffer: 1024 * 1024 * 10 });
                } finally {
                    try { await fs.rm(tmpPath); } catch (e) { }
                }

                return `✅ E-mail enviado\nSMTP: ${smtpHost}:${port}\nDe: ${fromEmail}\nPara: ${toList.join(', ')}`;
            } catch (e: any) {
                const fromPass = (args?.from_password || '').toString();
                const stderr = redactSecrets((e?.stderr || e?.message || '').toString(), [fromPass]);
                return `Erro ao enviar e-mail: ${stderr.slice(0, 1800)}`;
            }
        }
    },

    'mcp_hosting_deploy_ftp': {
        name: 'mcp_hosting_deploy_ftp',
        description: '[MCP Hosting] Faz upload via FTP (curl) de um projeto do workspace para um subdomínio (public_html/<subdomain>/).',
        parameters: {
            type: 'object',
            properties: {
                project_path: { type: 'string', description: 'Caminho do projeto no workspace (ex: meu-site)' },
                subdomain: { type: 'string', description: 'Parte do subdomínio (ex: juros, bmi, calc)' },
                remote_root_dir: { type: 'string', description: 'Raiz remota (padrão: public_html)' },
                ensure_subdomain: { type: 'boolean', description: 'Tentar criar o subdomínio via cPanel antes do upload (padrão: false)' }
            },
            required: ['project_path', 'subdomain']
        },
        execute: async (args: any) => {
            try {
                await ensureWorkspace();
                const domain = (await vaultGetFirst(['hosting_domain', 'cpanel_domain'])).trim();
                const ftpHost = (await vaultGetFirst(['hosting_ftp_host', 'cpanel_host'])).trim();
                const ftpUser = (await vaultGetFirst(['hosting_ftp_username', 'cpanel_user'])).trim();
                const ftpPass = (await vaultGetFirst(['hosting_ftp_password', 'cpanel_pass'])).trim();
                if (!domain) return 'Erro: domínio não configurado no Cofre (hosting_domain ou cpanel_domain).';
                if (!ftpHost || !ftpUser || !ftpPass) return 'Erro: credenciais FTP não configuradas no Cofre.';

                const projectPath = (args.project_path || '').toString().trim();
                if (!projectPath) return 'Erro: project_path ausente.';
                const localPath = path.join(WORKSPACE_ROOT, projectPath);
                if (!localPath.startsWith(WORKSPACE_ROOT)) return 'Erro: Caminho inválido.';

                const sub = normalizeSubdomain(args.subdomain);
                if (!sub) return 'Erro: subdomain inválido.';

                const ensure = Boolean(args.ensure_subdomain);
                if (ensure) {
                    try {
                        await (mcpTools['mcp_hosting_create_subdomain'] as any).execute({ subdomain: sub }, args);
                    } catch (e) { }
                }

                const remoteRoot = (args.remote_root_dir || 'public_html').toString().trim().replace(/\/+$/g, '');
                const remoteBase = `${remoteRoot}/${sub}`;
                const files = await collectFilesRecursive(localPath);
                if (files.length === 0) return `Erro: Nenhum arquivo encontrado em ${projectPath}.`;

                let ok = 0;
                for (const f of files) {
                    const remoteUrl = `ftp://${ftpHost}/${remoteBase}/${f.relPath}`;
                    const cmd = [
                        'curl',
                        '--silent',
                        '--show-error',
                        '--fail',
                        '--ftp-create-dirs',
                        '--user',
                        shellEscapePosix(`${ftpUser}:${ftpPass}`),
                        '-T',
                        shellEscapePosix(f.fullPath),
                        shellEscapePosix(remoteUrl)
                    ].join(' ');
                    try {
                        await execAsync(cmd, { maxBuffer: 1024 * 1024 * 10 });
                        ok++;
                    } catch (e: any) {
                        const stderr = redactSecrets((e?.stderr || e?.message || '').toString(), [ftpPass]);
                        return `Erro no upload FTP (${ok}/${files.length} arquivos): ${stderr.slice(0, 1800)}`;
                    }
                }

                return `✅ Deploy via FTP concluído (${ok} arquivos).\n🔗 https://${sub}.${domain}/\n📁 ${remoteBase}/`;
            } catch (e: any) {
                return `Erro no deploy FTP: ${e.message}`;
            }
        }
    },

    'mcp_company_dashboard': {
        name: 'mcp_company_dashboard',
        description: '[MCP Business] Mostra um dashboard completo da empresa: tarefas, mensagens, projetos, saldo e membros da equipe.',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        },
        execute: async (args: any) => {
            try {
                const { db } = await import('./db.js');

                const company = db.prepare('SELECT * FROM company WHERE id = ?').get('default') as any;
                const agents = db.prepare('SELECT id, name, role FROM agents').all() as any[];
                const pendingTasks = db.prepare("SELECT * FROM tasks WHERE status = 'pending'").all() as any[];
                const completedTasks = db.prepare("SELECT * FROM tasks WHERE status = 'completed'").all() as any[];
                const msgCount = db.prepare('SELECT count(*) as count FROM messages').get() as any;

                // Check project files
                let projects: string[] = [];
                try {
                    const dirs = await fs.readdir(WORKSPACE_ROOT, { withFileTypes: true });
                    projects = dirs.filter(d => d.isDirectory()).map(d => d.name);
                } catch (e) { }

                return `📊 DASHBOARD EMPRESARIAL
═══════════════════════════════
🏢 Empresa: ${company?.name || 'N/A'}
🎯 Missão: ${company?.mission || 'N/A'}
💰 Caixa: $${company?.cash?.toFixed(2) || '0.00'}

👥 EQUIPE (${agents.length} membros):
${agents.map(a => `  • ${a.name} (${a.role})`).join('\n')}

📋 TAREFAS:
  ⏳ Pendentes: ${pendingTasks.length}
${pendingTasks.slice(0, 5).map(t => `    - [${t.id}] ${t.description}`).join('\n')}
  ✅ Concluídas: ${completedTasks.length}

💬 Mensagens Trocadas: ${msgCount?.count || 0}

📁 PROJETOS NO WORKSPACE:
${projects.length > 0 ? projects.map(p => `  📂 ${p}/`).join('\n') : '  (nenhum projeto ainda)'}
═══════════════════════════════`;
            } catch (e: any) {
                return `Erro ao gerar dashboard: ${e.message}`;
            }
        }
    },

    'mcp_agent_finance_dashboard': {
        name: 'mcp_agent_finance_dashboard',
        description: '[MCP Business] Mostra salários, saldos bancários e upgrades por agente.',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        },
        execute: async (_args: any) => {
            try {
                const { db } = await import('./db.js');

                const company = db.prepare("SELECT cash FROM company WHERE id = 'default'").get() as any;
                const agents = db.prepare('SELECT id, name, role FROM agents ORDER BY created_at ASC').all() as any[];
                const finance = db.prepare(`
                    SELECT agent_id, bank_balance, salary, last_payroll_at
                    FROM agent_finance
                `).all() as any[];
                const financeMap = new Map<string, any>();
                for (const f of finance) financeMap.set((f.agent_id || '').toString(), f);

                const upgradesRows = db.prepare(`
                    SELECT au.agent_id as agent_id, au.upgrade_key as upgrade_key, u.title as title, u.cost as cost, u.weight_bonus as weight_bonus
                    FROM agent_upgrades au
                    LEFT JOIN upgrades u ON u.upgrade_key = au.upgrade_key
                    ORDER BY au.created_at ASC
                `).all() as any[];
                const upgradesMap = new Map<string, any[]>();
                for (const r of upgradesRows) {
                    const id = (r.agent_id || '').toString();
                    const arr = upgradesMap.get(id) || [];
                    arr.push(r);
                    upgradesMap.set(id, arr);
                }

                const upgradesCatalog = db.prepare('SELECT upgrade_key, title, cost, weight_bonus FROM upgrades ORDER BY cost ASC').all() as any[];

                return [
                    '🏦 FINANÇAS DOS AGENTES',
                    '═══════════════════════════════',
                    `💰 Caixa da empresa: $${Number(company?.cash || 0).toFixed(2)}`,
                    '',
                    ...agents.map(a => {
                        const f = financeMap.get((a.id || '').toString()) || {};
                        const bal = Number(f.bank_balance || 0).toFixed(2);
                        const sal = Number(f.salary || 0).toFixed(2);
                        const last = (f.last_payroll_at || 'nunca').toString();
                        const ups = upgradesMap.get((a.id || '').toString()) || [];
                        const upsText = ups.length > 0 ? ups.map(u => `      • ${u.upgrade_key} (${u.title || 'Upgrade'} | +${Number(u.weight_bonus || 0)} turno)`).join('\n') : '      (nenhum)';
                        return [
                            `👤 ${a.name} (${a.role})`,
                            `   - Banco: $${bal} | Salário: $${sal} | Último pagamento: ${last}`,
                            `   - Upgrades:`,
                            upsText
                        ].join('\n');
                    }),
                    '',
                    '🛒 CATÁLOGO DE UPGRADES (use mcp_buy_upgrade):',
                    ...upgradesCatalog.map(u => `  • ${u.upgrade_key}: ${u.title} | $${Number(u.cost || 0).toFixed(2)} | +${Number(u.weight_bonus || 0)} turno(s)`)
                ].join('\n');
            } catch (e: any) {
                return `Erro ao gerar finanças: ${e.message}`;
            }
        }
    },

    'mcp_buy_upgrade': {
        name: 'mcp_buy_upgrade',
        description: '[MCP Business] Compra um upgrade usando o saldo bancário do agente.',
        parameters: {
            type: 'object',
            properties: {
                upgrade_key: { type: 'string', description: 'Chave do upgrade (ex: extra_turns_1)' },
                agent_id: { type: 'string', description: 'Opcional: agente que vai comprar (padrão: o próprio agente)' }
            },
            required: ['upgrade_key']
        },
        execute: async (args: any, ctx: any) => {
            try {
                const { db } = await import('./db.js');
                const agentId = (args.agent_id || ctx?.agentId || '').toString();
                if (!agentId) return 'Erro: agent_id ausente.';

                const up = db.prepare('SELECT upgrade_key, title, cost, weight_bonus FROM upgrades WHERE upgrade_key = ?').get(args.upgrade_key) as any;
                if (!up?.upgrade_key) return 'Erro: upgrade não encontrado.';

                const fin = db.prepare('SELECT bank_balance FROM agent_finance WHERE agent_id = ?').get(agentId) as any;
                const bal = Number(fin?.bank_balance || 0);
                const cost = Number(up.cost || 0);
                if (!Number.isFinite(cost) || cost <= 0) return 'Erro: custo inválido.';
                if (bal < cost) return `Saldo insuficiente. Banco: $${bal.toFixed(2)} | Custo: $${cost.toFixed(2)}`;

                const already = db.prepare('SELECT 1 FROM agent_upgrades WHERE agent_id = ? AND upgrade_key = ?').get(agentId, up.upgrade_key);
                if (already) return 'Upgrade já comprado.';

                db.prepare('UPDATE agent_finance SET bank_balance = bank_balance - ? WHERE agent_id = ?').run(cost, agentId);
                db.prepare('INSERT INTO agent_upgrades (agent_id, upgrade_key) VALUES (?, ?)').run(agentId, up.upgrade_key);
                const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                db.prepare('INSERT INTO agent_transactions (id, agent_id, tx_type, amount, memo) VALUES (?, ?, ?, ?, ?)').run(
                    txId,
                    agentId,
                    'upgrade_purchase',
                    -cost,
                    `Compra: ${up.upgrade_key} (+${Number(up.weight_bonus || 0)} turno)`
                );

                return `✅ Upgrade comprado: ${up.upgrade_key} (${up.title}) | -$${cost.toFixed(2)} | +${Number(up.weight_bonus || 0)} turno(s)`;
            } catch (e: any) {
                return `Erro ao comprar upgrade: ${e.message}`;
            }
        }
    },

    'mcp_blockchain_operations': {
        name: 'mcp_blockchain_operations',
        description: '[MCP Blockchain] Realiza operações na rede Base/Ethereum (Saldo, Transferência, Deploy básico).',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['get_balance', 'send_eth', 'swap_tokens'], description: 'Ação a realizar' },
                address: { type: 'string', description: 'Endereço destino (para send_eth) ou contrato' },
                amount: { type: 'string', description: 'Quantidade em ETH/Tokens (para send/swap)' }
            },
            required: ['action']
        },
        execute: async (args: any, context: ToolContext) => {
            try {
                const { db } = await import('./db.js');
                const walletKey = db.prepare("SELECT key_value FROM vault WHERE service = 'blockchain' LIMIT 1").get() as any;

                if (!walletKey?.key_value) {
                    return 'Erro: Chave de carteira não encontrada no Cofre.';
                }

                // Constantes de rede (Base Mainnet como exemplo)
                const RPC_URL = 'https://mainnet.base.org';

                if (args.action === 'get_balance') {
                    const addr = args.address || '0x0000000000000000000000000000000000000000'; // Default se não provido
                    const res = await fetch(RPC_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [addr, 'latest'], id: 1 })
                    });
                    const data = await res.json() as any;
                    const balanceHex = data.result || '0x0';
                    const balanceEth = parseInt(balanceHex, 16) / 1e18;
                    return `💰 Saldo da conta ${addr}: ${balanceEth.toFixed(6)} ETH na Base Network.`;
                }

                if (args.action === 'send_eth' || args.action === 'swap_tokens') {
                    const approvalId = `app_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

                    try {
                        // Tenta buscar a task atual (necessária para approvals)
                        const task = db.prepare("SELECT id FROM tasks WHERE agent_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 1").get(context.agentId) as any;
                        const taskId = task?.id || `fake_task_${Date.now()}`; // fallback se não tiver task formal

                        db.prepare('INSERT INTO approvals (id, task_id, agent_id, action_type, action_data, status) VALUES (?, ?, ?, ?, ?, ?)').run(
                            approvalId,
                            taskId,
                            context.agentId,
                            'blockchain_tx',
                            JSON.stringify({
                                type: args.action,
                                address: args.address,
                                amount: args.amount,
                                network: 'Base'
                            }),
                            'pending'
                        );

                        // Notificar o Humano
                        db.prepare('INSERT INTO messages (id, from_agent_id, to_agent_id, content) VALUES (?, ?, ?, ?)').run(`m_${Date.now()}`, context.agentId, 'HUMAN', `🚨 PREPAREI UMA TRANSAÇÃO BLOCKCHAIN 🚨\nAção: ${args.action}\nDestino: ${args.address}\nQuantidade: ${args.amount}\n\nPor favor, revise e aprove (ID: ${approvalId}).`);

                        return `🛡️ Operação de ESCRITA detectada (${args.action}). Por motivos de segurança, a transação foi retida. Criei um pedido de aprovação (${approvalId}) e notifiquei o Dono. Aguardando assinatura manual.`;

                    } catch(e: any) {
                        return `Erro ao gerar pedido de aprovação Web3: ${e.message}`;
                    }
                }

                return 'Ação desconhecida.';
            } catch (e: any) {
                return `Erro blockchain: ${e.message}`;
            }
        }
    },
    'mcp_moltbook_ops': {
        name: 'mcp_moltbook_ops',
        description: '[MCP Social] Interage com a Moltbook (Rede Social de Agentes). Permite postar, ler feed e ver submolts.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['get_feed', 'create_post', 'get_submolts', 'check_status'], description: 'Ação social' },
                submolt: { type: 'string', description: 'Nome do submolt (ex: general, crypto)' },
                title: { type: 'string', description: 'Título do post (para create_post)' },
                content: { type: 'string', description: 'Conteúdo do post (para create_post)' },
                agent_id: { type: 'string', description: 'ID do agente no cofre (ex: moltbook_arthur, moltbook_marcos)' }
            },
            required: ['action']
        },
        execute: async (args: any) => {
            try {
                const { db } = await import('./db.js');
                const agentId = args.agent_id || 'moltbook_arthur';
                const moltKey = db.prepare("SELECT key_value FROM vault WHERE key_id = ? LIMIT 1").get(agentId) as any;

                if (!moltKey?.key_value) {
                    return `Erro: Chave Moltbook (${agentId}) não encontrada no Cofre.`;
                }

                const apiKey = moltKey.key_value;
                const baseUrl = 'https://www.moltbook.com/api/v1';

                if (args.action === 'check_status') {
                    const res = await fetch(`${baseUrl}/agents/status`, {
                        headers: { 'Authorization': `Bearer ${apiKey}` }
                    });
                    const data = await res.json();
                    return `🦞 Status na Moltbook: ${JSON.stringify(data)}`;
                }

                if (args.action === 'get_feed') {
                    const res = await fetch(`${baseUrl}/posts?limit=5`, {
                        headers: { 'Authorization': `Bearer ${apiKey}` }
                    });
                    const data = await res.json() as any;
                    return `📬 Feed Recente:\n${data.posts?.map((p: any) => `  - [${p.title}] por ${p.agent_name} em ${p.submolt_name}`).join('\n')}`;
                }

                if (args.action === 'get_submolts') {
                    const res = await fetch(`${baseUrl}/submolts`, {
                        headers: { 'Authorization': `Bearer ${apiKey}` }
                    });
                    const data = await res.json() as any;
                    return `🦞 Submolts Disponíveis:\n${data.submolts?.map((s: any) => `  - ${s.name}: ${s.description}`).join('\n')}`;
                }

                if (args.action === 'create_post') {
                    const res = await fetch(`${baseUrl}/posts`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${apiKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            submolt_name: args.submolt || 'general',
                            title: args.title,
                            content: args.content
                        })
                    });
                    const data = await res.json() as any;
                    if (data.success) {
                        return `✅ Post criado com sucesso! URL: https://www.moltbook.com/posts/${data.post_id}`;
                    } else {
                        return `❌ Erro ao postar: ${data.message || 'Erro desconhecido'}`;
                    }
                }

                return 'Ação desconhecida.';
            } catch (e: any) {
                return `Erro Moltbook: ${e.message}`;
            }
        }
    },

    'mcp_hosting_cpanel_create_subdomain': {
        name: 'mcp_hosting_cpanel_create_subdomain',
        description: '[HOSPEDAGEM] Cria um subdomínio no cPanel. Útil para colocar projetos no ar.',
        parameters: {
            type: 'object',
            properties: {
                subdomain: { type: 'string', description: 'Nome do subdomínio (ex: calculadora-top)' },
                folder: { type: 'string', description: 'Pasta onde os arquivos estarão (ex: public_html/calculadora)' }
            },
            required: ['subdomain']
        },
        execute: async (args: any) => {
            try {
                const rootDomain = await vaultGet('cpanel_domain');
                const sub = normalizeSubdomain(args.subdomain);
                const dir = args.folder || `public_html/${sub}`;

                const result = await callCPanelUAPI('SubDomain', 'addsubdomain', {
                    domain: sub,
                    rootdomain: rootDomain,
                    dir: dir
                });

                if (result.errors && result.errors.length > 0) {
                    return `❌ Erro ao criar subdomínio: ${JSON.stringify(result.errors)}`;
                }

                return `✅ Subdomínio criado com sucesso: http://${sub}.${rootDomain}\nApontando para a pasta: ${dir}`;
            } catch (e: any) {
                return `❌ Erro no cPanel: ${e.message}`;
            }
        }
    },

    'mcp_hosting_cpanel_create_email': {
        name: 'mcp_hosting_cpanel_create_email',
        description: '[HOSPEDAGEM] Cria uma conta de e-mail no cPanel.',
        parameters: {
            type: 'object',
            properties: {
                email_user: { type: 'string', description: 'Nome do usuário do e-mail (ex: suporte)' },
                password: { type: 'string', description: 'Senha da conta de e-mail' },
                quota: { type: 'number', description: 'Cota em MB (0 para ilimitado)' }
            },
            required: ['email_user', 'password']
        },
        execute: async (args: any) => {
            try {
                const domain = await vaultGet('cpanel_domain');
                const result = await callCPanelUAPI('Email', 'add_pop', {
                    email: args.email_user,
                    password: args.password,
                    domain: domain,
                    quota: (args.quota || 0).toString()
                });

                if (result.errors && result.errors.length > 0) {
                    return `❌ Erro ao criar e-mail: ${JSON.stringify(result.errors)}`;
                }

                return `✅ E-mail criado com sucesso: ${args.email_user}@${domain}`;
            } catch (e: any) {
                return `❌ Erro no cPanel: ${e.message}`;
            }
        }
    },

    'mcp_hosting_ftp_deploy': {
        name: 'mcp_hosting_ftp_deploy',
        description: '[HOSPEDAGEM] Faz o deploy de um projeto local para o servidor via FTP (usando curl).',
        parameters: {
            type: 'object',
            properties: {
                project_path: { type: 'string', description: 'Caminho do projeto no workspace (ex: meu-site)' },
                remote_folder: { type: 'string', description: 'Pasta de destino no servidor (ex: public_html/calculadora)' }
            },
            required: ['project_path', 'remote_folder']
        },
        execute: async (args: any) => {
            try {
                const user = await vaultGet('cpanel_user');
                const pass = await vaultGet('cpanel_pass');
                const host = await vaultGet('cpanel_host');

                if (!user || !pass || !host) return '❌ Credenciais de FTP não encontradas.';

                const localPath = path.join(WORKSPACE_ROOT, args.project_path);
                const remoteBase = args.remote_folder.replace(/^\//, '');

                const files = await collectFilesRecursive(localPath);
                let uploadCount = 0;
                let errorCount = 0;

                for (const file of files) {
                    const remotePath = `${remoteBase}/${file.relPath}`;
                    // curl -u user:pass --ftp-create-dirs -T file ftp://host/path/
                    const cmd = `curl -k -u ${shellEscapePosix(user)}:${shellEscapePosix(pass)} --ftp-create-dirs -T ${shellEscapePosix(file.fullPath)} ftp://${host}/${remotePath}`;
                    try {
                        await execAsync(cmd);
                        uploadCount++;
                    } catch (e) {
                        console.error(`Erro ao subir ${file.relPath}:`, e);
                        errorCount++;
                    }
                }

                return `🚀 Deploy FTP Concluído!\n✅ Arquivos enviados: ${uploadCount}\n❌ Falhas: ${errorCount}\n🌐 Projeto disponível (se o subdomínio apontar para cá): ${args.remote_folder}`;
            } catch (e: any) {
                return `❌ Erro no deploy FTP: ${e.message}`;
            }
        }
    },
};

export async function initMcpServers(): Promise<Record<string, Tool>> {
    console.log('[MCP] Inicializando ferramentas MCP nativas...');

    // Ensure the workspace directory exists
    await ensureWorkspace();

    const toolNames = Object.keys(mcpTools);
    console.log(`[MCP] ${toolNames.length} ferramentas MCP carregadas:`);
    for (const name of toolNames) {
        console.log(`[MCP]   ✅ ${name}: ${mcpTools[name].description.substring(0, 60)}...`);
    }

    return mcpTools;
}

export function getMcpTools(): Record<string, Tool> {
    return mcpTools;
}
