/**
 * ToolManager — Handles execution of tools by agents.
 */

import { db } from './db.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import * as cheerio from 'cheerio';
import { getMcpTools } from './mcpManager.js';

const execAsync = promisify(exec);

let ioInstance: any = null;
const listToolsCache = new Map<string, { at: number; output: string }>();

export function setToolIo(io: any) {
    ioInstance = io;
}

export interface ToolContext {
    agentId: string;
    agentName: string;
}

export interface Tool {
    name: string;
    description: string;
    parameters: any;
    execute: (args: any, context: ToolContext) => Promise<string>;
}

type ToolAliasConfig = {
    map?: Record<string, string[]>;
    defaults?: Record<string, any>;
    passthrough?: boolean;
};

function resolveAgentIdByName(name: string): string | null {
    const n = (name || '').toString().trim();
    if (!n) return null;
    const row = db.prepare('SELECT id FROM agents WHERE LOWER(name) = LOWER(?) LIMIT 1').get(n) as any;
    return row?.id ? String(row.id) : null;
}

function getAgentDivisionId(agentId: string): string | null {
    try {
        const row = db.prepare('SELECT division_id FROM agents WHERE id = ?').get(agentId) as any;
        const div = (row?.division_id ?? '').toString().trim();
        return div || null;
    } catch (e) {
        return null;
    }
}

function applyAliasConfig(args: any, config: ToolAliasConfig | null): any {
    const input = (args && typeof args === 'object') ? args : {};
    const cfg = config || {};
    const out: any = {};

    if (cfg.defaults && typeof cfg.defaults === 'object') {
        for (const [k, v] of Object.entries(cfg.defaults)) out[k] = v;
    }

    if (cfg.map && typeof cfg.map === 'object') {
        for (const [dest, fromList] of Object.entries(cfg.map)) {
            if (!Array.isArray(fromList)) continue;
            for (const src of fromList) {
                const key = (src ?? '').toString();
                if (!key) continue;
                const val = (input as any)[key];
                if (val !== undefined && val !== null && (typeof val !== 'string' || val.trim() !== '')) {
                    out[dest] = val;
                    break;
                }
            }
        }
    }

    if (cfg.passthrough) {
        for (const [k, v] of Object.entries(input)) {
            if (out[k] === undefined) out[k] = v;
        }
    }

    return Object.keys(out).length ? out : input;
}

const TOOLS: Record<string, Tool> = {
    'list_tools': {
        name: 'list_tools',
        description: 'Mostra as ferramentas disponíveis para o agente (inclui MCP).',
        parameters: {
            type: 'object',
            properties: {
                contains: { type: 'string', description: 'Filtra por substring no nome (opcional)' },
                prefix: { type: 'string', description: 'Filtra por prefixo (opcional)' },
                max: { type: 'number', description: 'Máximo de itens (padrão: 80, máx 200)' },
                verbose: { type: 'boolean', description: 'Se true, inclui descrições (padrão: false)' }
            }
        },
        execute: async (args: any, context: ToolContext) => {
            const agentId = (context?.agentId ?? 'SYSTEM').toString();
            const now = Date.now();
            const cached = listToolsCache.get(agentId);
            if (cached && (now - cached.at) < 5 * 60 * 1000) {
                return cached.output;
            }

            const contains = (args?.contains ?? '').toString().trim().toLowerCase();
            const prefix = (args?.prefix ?? '').toString().trim().toLowerCase();
            const max = Math.min(200, Math.max(10, Number(args?.max ?? 80)));
            const verbose = Boolean(args?.verbose);
            const mcpTools = getMcpTools();
            const combined = { ...TOOLS, ...mcpTools };

            const items = Object.values(combined)
                .map(t => ({ name: t.name, description: t.description }))
                .filter(t => {
                    const n = (t.name || '').toLowerCase();
                    if (prefix && !n.startsWith(prefix)) return false;
                    if (contains && !n.includes(contains)) return false;
                    return true;
                })
                .sort((a, b) => a.name.localeCompare(b.name))
                .slice(0, max);

            const lines: string[] = [];
            lines.push(`Ferramentas: ${items.length}`);
            for (const it of items) lines.push(verbose ? `- ${it.name}: ${it.description}` : `- ${it.name}`);
            const out = lines.join('\n');
            listToolsCache.set(agentId, { at: now, output: out });
            return out;
        }
    },
    'register_tool_alias': {
        name: 'register_tool_alias',
        description: 'Cria um alias para uma ferramenta existente (rudimentar/compat).',
        parameters: {
            type: 'object',
            properties: {
                alias: { type: 'string', description: 'Nome da ferramenta nova (ex: search_engine)' },
                target: { type: 'string', description: 'Ferramenta existente alvo (ex: web_search)' },
                config: {
                    type: 'object',
                    description: 'Config JSON: { map: {dest:[src...]}, defaults:{}, passthrough:boolean }',
                    properties: {}
                }
            },
            required: ['alias', 'target']
        },
        execute: async (args: any, context: ToolContext) => {
            const alias = (args?.alias ?? '').toString().trim();
            const target = (args?.target ?? '').toString().trim();
            if (!alias || !target) return 'Erro: alias e target são obrigatórios.';

            const mcpTools = getMcpTools();
            const combined = { ...TOOLS, ...mcpTools };
            if (!combined[target]) return `Erro: target "${target}" não existe. Use list_tools.`;

            const cfg: ToolAliasConfig = (args?.config && typeof args.config === 'object') ? args.config : {};
            const cfgStr = JSON.stringify(cfg);

            db.prepare('INSERT OR REPLACE INTO tool_aliases (alias, target, config, created_by) VALUES (?, ?, ?, ?)').run(
                alias,
                target,
                cfgStr,
                context.agentId
            );

            return `Alias criado: ${alias} -> ${target}`;
        }
    },
    'web_search': {
        name: 'web_search',
        description: 'Pesquisa informações na internet.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'O termo de pesquisa' },
                language: { type: 'string', description: 'Idioma preferido (opcional)' },
                query_pt: { type: 'string', description: 'Query em PT (opcional; compat)' },
                query_en: { type: 'string', description: 'Query em EN (opcional; compat)' },
                queries: { type: 'array', description: 'Lista de queries (opcional)', items: { type: 'string' } }
            }
        },
        execute: async (args: any) => {
            try {
                // Determine if there is a Serper API key in the company's vault.
                let useSerper = false;
                let serperKey = '';
                try {
                    const company = db.prepare('SELECT api_keys FROM company WHERE id = ?').get('default') as any;
                    if (company && company.api_keys) {
                        const keys = JSON.parse(company.api_keys);
                        if (keys['serper']) {
                            useSerper = true;
                            serperKey = keys['serper'];
                        }
                    }
                } catch (e) { }

                const resolveQueries = (): Array<{ label?: string; query: string }> => {
                    const out: Array<{ label?: string; query: string }> = [];

                    const single = (args?.query ?? '').toString().trim();
                    if (single) out.push({ query: single });

                    if (!out.length && Array.isArray(args?.queries)) {
                        for (const q of args.queries) {
                            const qq = (q ?? '').toString().trim();
                            if (qq) out.push({ query: qq });
                        }
                    }

                    const qpt = (args?.query_pt ?? '').toString().trim();
                    const qen = (args?.query_en ?? '').toString().trim();
                    if (!out.length && (qpt || qen)) {
                        if (qpt) out.push({ label: 'PT', query: qpt });
                        if (qen) out.push({ label: 'EN', query: qen });
                    }

                    return out;
                };

                const searchOne = async (query: string): Promise<string> => {
                    if (useSerper && serperKey) {
                        const response = await fetch("https://google.serper.dev/search", {
                            method: 'POST',
                            headers: {
                                'X-API-KEY': serperKey,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ q: query })
                        });
                        const data = await response.json();
                        return `Busca orgânica no Google (via Serper) para "${query}": \n${JSON.stringify(data.organic || data, null, 2).substring(0, 2600)}`;
                    }

                    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                    });
                    const html = await response.text();
                    const $ = cheerio.load(html);
                    const snippets: string[] = [];
                    // DuckDuckGo lite version typically uses .result-snippet
                    $('.result-snippet').each((i, el) => {
                        snippets.push($(el).text().trim().replace(/\s+/g, ' '));
                    });

                    if (snippets.length === 0) {
                        // fallback for other DDG versions
                        $('.result__snippet').each((i, el) => {
                            snippets.push($(el).text().trim().replace(/\s+/g, ' '));
                        });
                    }

                    if (snippets.length === 0) return `Sem resultados para "${query}"`;
                    // Limit text length to avoid token bloat
                    return `DuckDuckGo resultados para "${query}":\n` + snippets.slice(0, 3).join('\n- ').substring(0, 1500);
                };

                const queries = resolveQueries();
                if (!queries.length) return 'Erro ao buscar na web: query vazia.';
                if (queries.length === 1) return await searchOne(queries[0].query);

                const parts: string[] = [];
                for (const q of queries.slice(0, 4)) {
                    const header = q.label ? `=== ${q.label} ===` : '=== QUERY ===';
                    const body = await searchOne(q.query);
                    parts.push(`${header}\n${body}`);
                }
                return parts.join('\n\n');
            } catch (e: any) {
                return `Erro ao buscar na web: ${e.message}`;
            }
        }
    },
    'image_generation': {
        name: 'image_generation',
        description: 'Gera imagens a partir de uma descrição textual.',
        parameters: {
            type: 'object',
            properties: {
                prompt: { type: 'string', description: 'Descrição da imagem a ser gerada' }
            },
            required: ['prompt']
        },
        execute: async (args: any, context: ToolContext) => {
            return `Solicitação de geração de imagem enviada para "${args.prompt}". (Ação pendente de aprovação visual)`;
        }
    },
    'terminal_execute': {
        name: 'terminal_execute',
        description: 'Executa comandos no terminal do escritório (Docker).',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'O comando bash a ser executado' }
            },
            required: ['command']
        },
        execute: async (args: any) => {
            try {
                const { stdout, stderr } = await execAsync(args.command);
                return `STDOUT: ${stdout}\nSTDERR: ${stderr}`;
            } catch (err: any) {
                return `Erro na execução: ${err.message}`;
            }
        }
    },
    'file_write': {
        name: 'file_write',
        description: 'Cria ou edita um arquivo no filesystem.',
        parameters: {
            type: 'object',
            properties: {
                filename: { type: 'string', description: 'Nome do arquivo (ex: script.js)' },
                content: { type: 'string', description: 'Conteúdo do arquivo' }
            },
            required: ['filename', 'content']
        },
        execute: async (args: any) => {
            try {
                // Ensure filename is safe (no ../)
                const safeName = path.basename(args.filename);
                const filePath = path.join(process.cwd(), 'workspace', safeName);

                await fs.mkdir(path.join(process.cwd(), 'workspace'), { recursive: true });
                const contentStr = (args.content ?? '').toString();
                const lineCount = contentStr.split('\n').length;
                if (lineCount > 120 || contentStr.length > 12000) {
                    return `Erro: Conteúdo muito grande para 1 escrita (linhas=${lineCount}, chars=${contentStr.length}). Divida em múltiplos arquivos/partes menores.`;
                }
                await fs.writeFile(filePath, contentStr);

                return `Sucesso: Arquivo "${safeName}" salvo em /workspace.`;
            } catch (err: any) {
                return `Erro ao salvar arquivo: ${err.message}`;
            }
        }
    },
    'read_file': {
        name: 'read_file',
        description: 'Lê o conteúdo de um arquivo no projeto.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho do arquivo (ex: backend/src/server.ts)' }
            },
            required: ['path']
        },
        execute: async (args: any) => {
            try {
                const fullPath = path.resolve(process.cwd(), '..', args.path);
                // Security check
                if (!fullPath.startsWith(path.resolve(process.cwd(), '..'))) {
                    return "Erro: Acesso negado fora da pasta do projeto.";
                }
                const content = await fs.readFile(fullPath, 'utf8');

                // Return only first N chars to protect context window limit
                const maxChars = 3000;
                if (content.length > maxChars) {
                    return content.substring(0, maxChars) + '\n\n...[TRUNCADO. ARQUIVO MUITO GRANDE. Use read_file_range para ler partes específicas]';
                }

                return content;
            } catch (err: any) {
                return `Erro ao ler arquivo: ${err.message}`;
            }
        }
    },
    'read_file_range': {
        name: 'read_file_range',
        description: 'Lê um trecho (range de linhas) de um arquivo no projeto.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho do arquivo (ex: backend/src/server.ts)' },
                start_line: { type: 'number', description: 'Linha inicial (1-indexed)' },
                line_count: { type: 'number', description: 'Quantidade de linhas (máx 250)' }
            },
            required: ['path', 'start_line', 'line_count']
        },
        execute: async (args: any) => {
            try {
                const projectRoot = path.resolve(process.cwd(), '..');
                const fullPath = path.resolve(projectRoot, args.path);
                if (!fullPath.startsWith(projectRoot)) return 'Erro: Acesso negado fora da pasta do projeto.';
                const start = Math.max(1, Number(args.start_line || 1));
                const count = Math.min(250, Math.max(1, Number(args.line_count || 80)));
                const content = await fs.readFile(fullPath, 'utf8');
                const lines = content.split('\n');
                const end = Math.min(lines.length, start + count - 1);
                const slice = lines.slice(start - 1, end).map((l, i) => `${start + i}│${l}`).join('\n');
                return `Trecho de ${args.path} (linhas ${start}-${end}):\n\n${slice}`;
            } catch (err: any) {
                return `Erro ao ler trecho: ${err.message}`;
            }
        }
    },
    'workspace_search': {
        name: 'workspace_search',
        description: 'Busca texto (substring) em arquivos do projeto.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Texto a buscar' },
                path: { type: 'string', description: 'Subpasta para restringir a busca (opcional)' },
                max_results: { type: 'number', description: 'Máximo de resultados (padrão 25, máx 60)' }
            },
            required: ['query']
        },
        execute: async (args: any) => {
            try {
                const query = (args.query ?? '').toString();
                if (!query.trim()) return 'Erro: query vazia.';
                const maxResults = Math.min(60, Math.max(1, Number(args.max_results || 25)));
                const projectRoot = path.resolve(process.cwd(), '..');
                const root = path.resolve(projectRoot, (args.path || '').toString());
                if (!root.startsWith(projectRoot)) return 'Erro: Acesso negado fora da pasta do projeto.';

                const results: Array<{ file: string; line: number; snippet: string }> = [];
                let scannedFiles = 0;
                const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo']);

                const walk = async (dir: string, relPrefix: string) => {
                    if (results.length >= maxResults) return;
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (results.length >= maxResults) break;
                        if (skipDirs.has(entry.name)) continue;
                        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
                        const full = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            await walk(full, rel);
                        } else {
                            scannedFiles++;
                            if (scannedFiles > 260) return;
                            let stat: any;
                            try { stat = await fs.stat(full); } catch (e) { continue; }
                            if (!stat?.isFile?.() || stat.size > 350_000) continue;
                            let content: string;
                            try { content = await fs.readFile(full, 'utf-8'); } catch (e) { continue; }
                            if (!content.includes(query)) continue;
                            const lines = content.split('\n');
                            for (let i = 0; i < lines.length; i++) {
                                if (results.length >= maxResults) break;
                                if (lines[i].includes(query)) {
                                    results.push({ file: rel, line: i + 1, snippet: lines[i].slice(0, 220) });
                                }
                            }
                        }
                    }
                };

                await walk(root, (args.path || '').toString().replace(/\/+$/, ''));
                if (results.length === 0) return `Sem resultados para "${query}".`;
                return `Resultados para "${query}" (${results.length}):\n${results.map(r => `- ${r.file}:${r.line} ${r.snippet}`).join('\n')}`;
            } catch (err: any) {
                return `Erro ao buscar: ${err.message}`;
            }
        }
    },
    'file_patch': {
        name: 'file_patch',
        description: 'Aplica patch por range de linhas em um arquivo do projeto (sem reescrever tudo).',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho do arquivo (ex: backend/src/server.ts)' },
                start_line: { type: 'number', description: 'Linha inicial (1-indexed)' },
                end_line: { type: 'number', description: 'Linha final (1-indexed, inclusive)' },
                content: { type: 'string', description: 'Novo conteúdo para substituir o range' }
            },
            required: ['path', 'start_line', 'end_line', 'content']
        },
        execute: async (args: any) => {
            try {
                const projectRoot = path.resolve(process.cwd(), '..');
                const fullPath = path.resolve(projectRoot, args.path);
                if (!fullPath.startsWith(projectRoot)) return 'Erro: Acesso negado fora da pasta do projeto.';
                const start = Math.max(1, Number(args.start_line || 1));
                const end = Math.max(start, Number(args.end_line || start));
                const replacement = (args.content ?? '').toString();
                if (replacement.split('\n').length > 140 || replacement.length > 14000) return 'Erro: Patch muito grande. Divida em partes menores.';
                const content = await fs.readFile(fullPath, 'utf8');
                const lines = content.split('\n');
                if (start > lines.length + 1) return `Erro: start_line fora do arquivo (linhas=${lines.length}).`;
                const safeEnd = Math.min(lines.length, end);
                const before = lines.slice(0, start - 1);
                const after = lines.slice(safeEnd);
                const next = [...before, ...replacement.split('\n'), ...after].join('\n');
                await fs.writeFile(fullPath, next, 'utf8');
                return `Patch aplicado em ${args.path} (linhas ${start}-${safeEnd}).`;
            } catch (err: any) {
                return `Erro ao aplicar patch: ${err.message}`;
            }
        }
    },
    'list_files': {
        name: 'list_files',
        description: 'Lista os arquivos em um diretório do projeto.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho do diretório (ex: frontend/src)' }
            },
            required: ['path']
        },
        execute: async (args: any) => {
            try {
                const fullPath = path.resolve(process.cwd(), '..', args.path || '.');
                const files = await fs.readdir(fullPath);
                return JSON.stringify(files);
            } catch (err: any) {
                return `Erro ao listar diretório: ${err.message}`;
            }
        }
    },
    'kb_save': {
        name: 'kb_save',
        description: 'Salva uma informação estratégica na Memória Empresarial (Knowledge Base).',
        parameters: {
            type: 'object',
            properties: {
                category: { type: 'string', description: 'Categoria (business_plan, market_research, tech_stack)' },
                title: { type: 'string', description: 'Título da informação' },
                content: { type: 'string', description: 'Conteúdo detalhado' }
            },
            required: ['category', 'title', 'content']
        },
        execute: async (args: any, context: ToolContext) => {
            try {
                const id = crypto.randomUUID();
                db.prepare(`
                    INSERT INTO knowledge_base (id, category, title, content, author_id)
                    VALUES (?, ?, ?, ?, ?)
                `).run(id, args.category, args.title, args.content, context.agentId);
                return `Sucesso: Informação "${args.title}" salva na base de conhecimento.`;
            } catch (err: any) {
                return `Erro ao salvar no KB: ${err.message}`;
            }
        }
    },
    'kb_query': {
        name: 'kb_query',
        description: 'Busca informações na Memória Empresarial.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Termo de busca (opcional)' },
                category: { type: 'string', description: 'Filtrar por categoria (opcional)' }
            }
        },
        execute: async (args: any) => {
            try {
                let sql = "SELECT * FROM knowledge_base";
                const params = [];
                if (args.category) {
                    sql += " WHERE category = ?";
                    params.push(args.category);
                } else if (args.query) {
                    sql += " WHERE title LIKE ? OR content LIKE ?";
                    params.push(`%${args.query}%`, `%${args.query}%`);
                }
                sql += " ORDER BY created_at DESC LIMIT 10";
                const rows = db.prepare(sql).all(...params);
                return JSON.stringify(rows);
            } catch (err: any) {
                return `Erro ao buscar no KB: ${err.message}`;
            }
        }
    },
    'task_split': {
        name: 'task_split',
        description: 'Divide uma tarefa em subtarefas menores e conclui a tarefa original.',
        parameters: {
            type: 'object',
            properties: {
                task_id: { type: 'string', description: 'ID da tarefa a dividir' },
                parts: { type: 'array', items: { type: 'string' }, description: 'Lista de descrições das subtarefas' }
            },
            required: ['task_id', 'parts']
        },
        execute: async (args: any, context: ToolContext) => {
            try {
                const taskId = (args.task_id ?? '').toString();
                const parts = Array.isArray(args.parts) ? args.parts.map((p: any) => (p ?? '').toString().trim()).filter(Boolean) : [];
                if (!taskId) return 'Erro: task_id vazio.';
                if (parts.length < 2) return 'Erro: informe pelo menos 2 parts.';
                if (parts.length > 6) return 'Erro: máximo de 6 subtarefas por split.';

                const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
                if (!task) return 'Erro: tarefa não encontrada.';
                if (task.agent_id !== context.agentId) return 'Erro: você só pode dividir suas próprias tarefas.';

                const created: string[] = [];
                for (const p of parts) {
                    const safe = p.length > 280 ? `${p.slice(0, 280)}...` : p;
                    const newId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                    db.prepare('INSERT INTO tasks (id, agent_id, division_id, description, status) VALUES (?, ?, ?, ?, ?)').run(
                        newId,
                        task.agent_id,
                        task.division_id ?? null,
                        safe,
                        'pending'
                    );
                    created.push(newId);
                }

                db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('completed', taskId);
                return `Split ok. Original concluída (${taskId}). Novas tarefas: ${created.join(', ')}`;
            } catch (err: any) {
                return `Erro ao dividir tarefa: ${err.message}`;
            }
        }
    },
    'git_command': {
        name: 'git_command',
        description: 'Executa comandos git (commit, push, status) no repositório.',
        parameters: {
            type: 'object',
            properties: {
                args: { type: 'string', description: 'Argumentos do comando git (ex: status, commit -m \"feat...\")' }
            },
            required: ['args']
        },
        execute: async (args: any) => {
            try {
                const { stdout, stderr } = await execAsync(`git ${args.args}`);
                return `STDOUT: ${stdout}\nSTDERR: ${stderr}`;
            } catch (err: any) {
                return `Erro git: ${err.message}`;
            }
        }
    },
    'market_research': {
        name: 'market_research',
        description: 'Pesquisa tendências de mercado, concorrência e palavras-chave.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'O que pesquisar (ex: nichos lucrativos 2024)' }
            },
            required: ['query']
        },
        execute: async (args: any) => {
            // Re-uses web_search but appends market context instructions
            try {
                const searchQ = `${args.query} tendências mercado estatísticas`;
                const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQ)}`, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                });
                const html = await response.text();
                const $ = cheerio.load(html);
                let snippets: string[] = [];
                $('.result__snippet').each((i, el) => {
                    snippets.push($(el).text().trim());
                });

                if (snippets.length === 0) return `Sem análises para "${args.query}"`;
                return `Análise de mercado para "${args.query}":\n\n` + snippets.slice(0, 5).join('\n---\n');
            } catch (e: any) {
                return `Erro na pesquisa de mercado: ${e.message}`;
            }
        }
    },
    'deploy_site': {
        name: 'deploy_site',
        description: 'Envia o projeto para produção no Vercel ou Netlify.',
        parameters: {
            type: 'object',
            properties: {
                platform: { type: 'string', enum: ['vercel', 'netlify'], description: 'Plataforma de destino' },
                token: { type: 'string', description: 'Token de acesso (opcional se já configurado)' }
            },
            required: ['platform']
        },
        execute: async (args: any) => {
            return `Sucesso: Deploy iniciado na plataforma ${args.platform}. (Aguardando conclusão do build no container)`;
        }
    },
    'manage_team': {
        name: 'manage_team',
        description: 'Contrata um novo funcionário (agente) ou promove um existente alterando sua system_prompt e role.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['hire', 'promote'], description: 'Se deve contratar (hire) ou promover (promote)' },
                agentId: { type: 'string', description: 'ID do agente (necessário apenas para promote)' },
                name: { type: 'string', description: 'Nome do novo agente ou novo nome' },
                role: { type: 'string', description: 'Cargo do agente (ex: Dev Externo, QA)' },
                system_prompt: { type: 'string', description: 'Instruções de sistema detalhadas' }
            },
            required: ['action', 'name', 'role', 'system_prompt']
        },
        execute: async (args: any) => {
            try {
                if (args.action === 'hire') {
                    const id = Date.now().toString();
                    const numericId = Number(id.slice(-6));
                    db.prepare(`
                        INSERT INTO agents (id, name, role, permissions, system_prompt, llm_model) 
                        VALUES (?, ?, ?, '[]', ?, 'google/gemini-flash-1.5-8b')
                    `).run(id, args.name, args.role, args.system_prompt);

                    if (ioInstance) {
                        ioInstance.emit('message', { type: 'agentCreated', id: numericId, folderName: args.name });
                    }
                    return `Sucesso: Agente ${args.name} contratado com ID ${numericId}. Eles já estão no escritório!`;
                } else if (args.action === 'promote') {
                    db.prepare(`
                        UPDATE agents SET name = ?, role = ?, system_prompt = ? WHERE id = ?
                    `).run(args.name, args.role, args.system_prompt, args.agentId);

                    if (ioInstance) {
                        ioInstance.emit('message', { type: 'agentUpdated', id: args.agentId, name: args.name });
                    }
                    return `Sucesso: Agente promovido para ${args.role}.`;
                }
                return 'Ação inválida.';
            } catch (err: any) {
                return `Erro no manage_team: ${err.message}`;
            }
        }
    },
    'start_meeting': {
        name: 'start_meeting',
        description: 'Convoca agentes para uma reunião física na sala de conferências do escritório.',
        parameters: {
            type: 'object',
            properties: {
                topic: { type: 'string', description: 'Tópico da reunião' },
                participants_ids: { type: 'array', items: { type: 'string' }, description: 'Lista de IDs dos agentes convocados' }
            },
            required: ['topic', 'participants_ids']
        },
        execute: async (args: any, context: ToolContext) => {
            try {
                if (ioInstance) {
                    ioInstance.emit('message', {
                        type: 'startMeeting',
                        topic: args.topic,
                        hostName: context.agentName,
                        participants: args.participants_ids.map((id: string) => Number(id.slice(-6)) || 0)
                    });
                }
                return `Reunião sobre "${args.topic}" convocada. Os agentes estão indo para a sala.`;
            } catch (e: any) {
                return `Erro: ${e.message}`;
            }
        }
    },
    'rebrand_company': {
        name: 'rebrand_company',
        description: 'Muda o nome e a missão da empresa do escritório virtual.',
        parameters: {
            type: 'object',
            properties: {
                new_name: { type: 'string', description: 'O novo nome da empresa' },
                new_mission: { type: 'string', description: 'A nova missão descritiva' },
                new_focus: { type: 'string', description: 'O novo foco principal de operações (opcional)' }
            },
            required: ['new_name', 'new_mission']
        },
        execute: async (args: any) => {
            try {
                db.prepare(`UPDATE company SET name = ?, mission = ? WHERE id = 'default'`).run(args.new_name, args.new_mission);
                return `Marca atualizada com sucesso! Nova Empresa: ${args.new_name}. Todos os agentes agora seguirão a nova missão no próximo ciclo de pensamento.`;
            } catch (e: any) {
                return `Erro ao atualizar a marca: ${e.message}`;
            }
        }
    },
    'manage_api_keys': {
        name: 'manage_api_keys',
        description: 'Salva chaves de API estratégicas (ex: serpai, twitter, openai) no cofre da empresa para uso de outros agentes em suas tools.',
        parameters: {
            type: 'object',
            properties: {
                service: { type: 'string', description: 'Nome do serviço (ex: serpai, vercel, telegram, twitter)' },
                api_key: { type: 'string', description: 'A chave da API fornecida pelo usuário' }
            },
            required: ['service', 'api_key']
        },
        execute: async (args: any) => {
            try {
                const company = db.prepare('SELECT api_keys FROM company WHERE id = ?').get('default') as { api_keys: string } | undefined;
                if (!company) return 'Erro interno: empresa default não encontrada.';

                let keys: Record<string, string> = {};
                try {
                    keys = JSON.parse(company.api_keys || '{}');
                } catch (e) { }

                keys[args.service] = args.api_key;
                const newKeysStr = JSON.stringify(keys);

                db.prepare(`UPDATE company SET api_keys = ? WHERE id = 'default'`).run(newKeysStr);
                return `Chave de API do serviço "${args.service}" foi cofre da empresa com sucesso. Outros agentes já podem usá-la.`;
            } catch (e: any) {
                return `Erro ao salvar chave: ${e.message}`;
            }
        }
    }
    ,
    'google_search': {
        name: 'google_search',
        description: 'Compat: pesquisa na web (alias de web_search).',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'O termo de pesquisa' },
                q: { type: 'string', description: 'Compat: alias de query' }
            }
        },
        execute: async (args: any, context: ToolContext) => {
            const q = (args?.query ?? args?.q ?? '').toString().trim();
            return await TOOLS.web_search.execute({ query: q }, context);
        }
    },
    'search': {
        name: 'search',
        description: 'Compat: pesquisa na web (alias de web_search).',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'O termo de pesquisa' },
                q: { type: 'string', description: 'Compat: alias de query' },
                max_results: { type: 'number', description: 'Compat: ignorado' }
            }
        },
        execute: async (args: any, context: ToolContext) => {
            const q = (args?.query ?? args?.q ?? '').toString().trim();
            return await TOOLS.web_search.execute({ query: q }, context);
        }
    },
    'search_engine': {
        name: 'search_engine',
        description: 'Compat: pesquisa na web (alias de web_search).',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'O termo de pesquisa' },
                q: { type: 'string', description: 'Compat: alias de query' },
                max_results: { type: 'number', description: 'Compat: ignorado' }
            }
        },
        execute: async (args: any, context: ToolContext) => {
            const q = (args?.query ?? args?.q ?? '').toString().trim();
            return await TOOLS.web_search.execute({ query: q }, context);
        }
    },
    'search_web': {
        name: 'search_web',
        description: 'Compat: pesquisa na web (alias de web_search).',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'O termo de pesquisa' },
                q: { type: 'string', description: 'Compat: alias de query' }
            }
        },
        execute: async (args: any, context: ToolContext) => {
            const q = (args?.query ?? args?.q ?? '').toString().trim();
            return await TOOLS.web_search.execute({ query: q }, context);
        }
    },
    'chat': {
        name: 'chat',
        description: 'Compat: envia mensagem (normalmente para o Dono) via tool message.',
        parameters: {
            type: 'object',
            properties: {
                role: { type: 'string', description: 'Compat: ignorado' },
                content: { type: 'string', description: 'Conteúdo da mensagem' }
            },
            required: ['content']
        },
        execute: async (args: any, context: ToolContext) => {
            return await TOOLS.message.execute({ content: args?.content }, context);
        }
    },
    'project_planner': {
        name: 'project_planner',
        description: 'Compat: gera/salva um plano curto no KB para um projeto.',
        parameters: {
            type: 'object',
            properties: {
                task_id: { type: 'string', description: 'ID da tarefa (opcional)' },
                phase: { type: 'string', description: 'Fase (kickoff, build, etc)' },
                deliverables: { type: 'array', items: { type: 'string' }, description: 'Entregáveis (opcional)' },
                timeline_days: { type: 'number', description: 'Prazo em dias (opcional)' },
                budget_usd: { type: 'number', description: 'Budget (opcional)' },
                tools: { type: 'array', items: { type: 'string' }, description: 'Ferramentas sugeridas (opcional)' }
            }
        },
        execute: async (args: any, context: ToolContext) => {
            const phase = (args?.phase ?? 'kickoff').toString().trim() || 'kickoff';
            const taskId = (args?.task_id ?? '').toString().trim();
            const deliverables = Array.isArray(args?.deliverables) ? args.deliverables.map((d: any) => (d ?? '').toString().trim()).filter(Boolean) : [];
            const timelineDays = Number.isFinite(Number(args?.timeline_days)) ? Number(args.timeline_days) : null;
            const budgetUsd = Number.isFinite(Number(args?.budget_usd)) ? Number(args.budget_usd) : null;
            const tools = Array.isArray(args?.tools) ? args.tools.map((t: any) => (t ?? '').toString().trim()).filter(Boolean) : [];

            const lines: string[] = [];
            lines.push(`Plano curto (${phase})`);
            if (taskId) lines.push(`Task: ${taskId}`);
            if (timelineDays != null) lines.push(`Prazo: ${timelineDays} dia(s)`);
            if (budgetUsd != null) lines.push(`Budget: $${budgetUsd}`);
            if (deliverables.length) lines.push(`Entregáveis: ${deliverables.slice(0, 8).join(' | ')}`);
            if (tools.length) lines.push(`Ferramentas: ${tools.slice(0, 10).join(' | ')}`);
            lines.push('Próximos passos (ação): 1) use create_task para delegar 2 entregas 2) use_tool mcp_scaffold_project para iniciar o MVP #1.');

            const title = `Project plan (${phase}) - ${context.agentName}`;
            await TOOLS.kb_save.execute({ category: 'business_plan', title, content: lines.join('\n') }, context);
            return `Plano salvo no KB: ${title}`;
        }
    },
    'research_planner': {
        name: 'research_planner',
        description: 'Compat: gera/salva um plano curto de pesquisa no KB.',
        parameters: {
            type: 'object',
            properties: {
                project_name: { type: 'string', description: 'Nome do projeto' },
                objectives: { type: 'array', items: { type: 'string' }, description: 'Objetivos (opcional)' },
                constraints: { type: 'array', items: { type: 'string' }, description: 'Restrições (opcional)' }
            }
        },
        execute: async (args: any, context: ToolContext) => {
            const projectName = (args?.project_name ?? '').toString().trim() || 'Pesquisa';
            const objectives = Array.isArray(args?.objectives) ? args.objectives.map((o: any) => (o ?? '').toString().trim()).filter(Boolean) : [];
            const constraints = Array.isArray(args?.constraints) ? args.constraints.map((c: any) => (c ?? '').toString().trim()).filter(Boolean) : [];

            const lines: string[] = [];
            lines.push(`Plano curto de pesquisa: ${projectName}`);
            if (objectives.length) lines.push(`Objetivos: ${objectives.slice(0, 10).join(' | ')}`);
            if (constraints.length) lines.push(`Restrições: ${constraints.slice(0, 10).join(' | ')}`);
            lines.push('Próximos passos (ação): 1) use_tool web_search com 2 queries 2) use_tool kb_save com achados + recomendações.');

            const title = `Research plan - ${context.agentName} - ${projectName}`;
            await TOOLS.kb_save.execute({ category: 'market_research', title, content: lines.join('\n') }, context);
            return `Plano de pesquisa salvo no KB: ${title}`;
        }
    },
    'create_file': {
        name: 'create_file',
        description: 'Compat: cria/atualiza arquivo no workspace (alias de mcp_fs_write_file).',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Nome do arquivo (compat)' },
                path: { type: 'string', description: 'Caminho relativo no workspace (opcional)' },
                content: { type: 'string', description: 'Conteúdo completo do arquivo' }
            },
            required: ['content']
        },
        execute: async (args: any, context: ToolContext) => {
            const raw = (args?.path ?? args?.name ?? '').toString().trim().replace(/\\/g, '/');
            const clean = raw.replace(/^\/+/, '');
            const base = clean || `file_${Date.now()}.txt`;
            const rel = base.includes('/') ? base : `${context.agentName}/${base}`;
            const content = (args?.content ?? '').toString();
            const mcp = getMcpTools();
            const tool = mcp['mcp_fs_write_file'];
            if (!tool) return 'Erro: Ferramenta "mcp_fs_write_file" não encontrada.';
            return await tool.execute({ path: rel, content }, context);
        }
    },
    'write_file': {
        name: 'write_file',
        description: 'Compat: cria/atualiza arquivo no workspace (alias de mcp_fs_write_file).',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho relativo no workspace' },
                content: { type: 'string', description: 'Conteúdo completo do arquivo' }
            },
            required: ['path', 'content']
        },
        execute: async (args: any, context: ToolContext) => {
            const p = (args?.path ?? '').toString().trim().replace(/\\/g, '/').replace(/^\/+/, '');
            const mcp = getMcpTools();
            const tool = mcp['mcp_fs_write_file'];
            if (!tool) return 'Erro: Ferramenta "mcp_fs_write_file" não encontrada.';
            return await tool.execute({ path: p, content: args?.content }, context);
        }
    },
    'mcp_project_scaffold': {
        name: 'mcp_project_scaffold',
        description: 'Compat: cria a estrutura base de um projeto (alias de mcp_scaffold_project).',
        parameters: {
            type: 'object',
            properties: {
                project_name: { type: 'string', description: 'Nome do projeto (ex: calculadora-factory)' },
                projectName: { type: 'string', description: 'Compat: alias de project_name' },
                name: { type: 'string', description: 'Compat: alias de project_name' },
                rootDirectory: { type: 'string', description: 'Compat: alias de project_name' },
                rootDir: { type: 'string', description: 'Compat: alias de project_name' },
                type: { type: 'string', description: 'Tipo do projeto (ex: calculator, landing, blog)' },
                description: { type: 'string', description: 'Descrição do projeto (opcional)' }
            }
        },
        execute: async (args: any, context: ToolContext) => {
            const mcp = getMcpTools();
            const tool = mcp['mcp_scaffold_project'];
            if (!tool) return 'Erro: Ferramenta "mcp_scaffold_project" não encontrada.';

            const projectName = (args?.project_name ?? args?.projectName ?? args?.name ?? args?.rootDirectory ?? args?.rootDir ?? '')
                .toString()
                .trim()
                .replace(/\\/g, '/')
                .replace(/^\/+/, '');
            if (!projectName) return 'Erro: project_name vazio.';

            const type = (args?.type ?? 'calculator').toString().trim() || 'calculator';
            const description = (args?.description ?? '').toString().trim();
            return await tool.execute({ project_name: projectName, type, description }, context);
        }
    },
    'search_files': {
        name: 'search_files',
        description: 'Compat: busca texto em arquivos do workspace (alias de mcp_fs_search).',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Texto a buscar' },
                path: { type: 'string', description: 'Subpasta (opcional)' },
                max_results: { type: 'number', description: 'Máximo de resultados' }
            },
            required: ['query']
        },
        execute: async (args: any, context: ToolContext) => {
            const mcp = getMcpTools();
            const tool = mcp['mcp_fs_search'];
            if (!tool) return 'Erro: Ferramenta "mcp_fs_search" não encontrada.';
            return await tool.execute({ query: args?.query, path: args?.path, max_results: args?.max_results }, context);
        }
    },
    'browse': {
        name: 'browse',
        description: 'Compat: lê uma página web e extrai o texto principal (alias de mcp_fetch_page).',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL completa' },
                timeout_ms: { type: 'number', description: 'Timeout em ms (opcional)' }
            },
            required: ['url']
        },
        execute: async (args: any, _context: ToolContext) => {
            const url = (args?.url ?? '').toString().trim();
            const timeoutMs = Number(args?.timeout_ms ?? 12000);
            const mcp = getMcpTools();
            const tool = mcp['mcp_fetch_page'];
            if (!tool) return 'Erro: Ferramenta "mcp_fetch_page" não encontrada.';
            return await tool.execute({ url, timeout_ms: timeoutMs }, { agentId: 'SYSTEM', agentName: 'SYSTEM' });
        }
    },
    'create_document': {
        name: 'create_document',
        description: 'Compat: cria um documento interno salvando no KB (alias de kb_save).',
        parameters: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Título do documento' },
                content: { type: 'string', description: 'Conteúdo do documento' },
                category: { type: 'string', description: 'Categoria do KB (padrão: business_plan)' }
            },
            required: ['title', 'content']
        },
        execute: async (args: any, context: ToolContext) => {
            const category = (args?.category ?? 'business_plan').toString().trim() || 'business_plan';
            const title = (args?.title ?? '').toString().trim();
            const content = (args?.content ?? '').toString().trim();
            if (!title || !content) return 'Erro: title e content são obrigatórios.';
            return await TOOLS.kb_save.execute({ category, title, content }, context);
        }
    },
    'planner': {
        name: 'planner',
        description: 'Compat: salva um plano/rascunho no KB.',
        parameters: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'Plano em texto' },
                title: { type: 'string', description: 'Título (opcional)' },
                category: { type: 'string', description: 'Categoria (padrão: business_plan)' }
            },
            required: ['content']
        },
        execute: async (args: any, context: ToolContext) => {
            const category = (args?.category ?? 'business_plan').toString().trim() || 'business_plan';
            const title = ((args?.title ?? '') as any).toString().trim() || `Plano - ${context.agentName}`;
            const content = (args?.content ?? '').toString().trim();
            if (!content) return 'Erro: content vazio.';
            return await TOOLS.kb_save.execute({ category, title, content }, context);
        }
    },
    'task_planner': {
        name: 'task_planner',
        description: 'Compat: salva um plano de tarefas no KB (alias de planner).',
        parameters: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'Plano em texto (opcional)' },
                title: { type: 'string', description: 'Título (opcional)' },
                category: { type: 'string', description: 'Categoria do KB (padrão: business_plan)' },
                project: { type: 'string', description: 'Nome do projeto (compat)' },
                tasks: { type: 'array', description: 'Lista de tarefas (compat)', items: {} },
                tools: { type: 'array', description: 'Ferramentas sugeridas (compat)', items: { type: 'string' } }
            }
        },
        execute: async (args: any, context: ToolContext) => {
            const direct = (args?.content ?? '').toString().trim();
            if (direct) {
                return await TOOLS.planner.execute(args, context);
            }

            const category = (args?.category ?? 'business_plan').toString().trim() || 'business_plan';
            const title = ((args?.title ?? '') as any).toString().trim() || `Plano de tarefas - ${context.agentName}`;
            const project = (args?.project ?? '').toString().trim();
            const tasks = Array.isArray(args?.tasks) ? args.tasks : [];
            const tools = Array.isArray(args?.tools) ? args.tools.map((t: any) => (t ?? '').toString().trim()).filter(Boolean) : [];

            const lines: string[] = [];
            lines.push('Plano de tarefas (auto)');
            if (project) lines.push(`Projeto: ${project}`);

            if (tasks.length) {
                lines.push('Tarefas:');
                for (const t of tasks.slice(0, 20)) {
                    if (typeof t === 'string') {
                        const s = t.trim();
                        if (s) lines.push(`- ${s}`);
                        continue;
                    }
                    const assignee = (t?.assignee ?? t?.owner ?? '').toString().trim();
                    const action = (t?.action ?? t?.task ?? t?.description ?? '').toString().trim();
                    const label = assignee ? `[${assignee}] ${action}` : action;
                    if (label.trim()) lines.push(`- ${label.trim()}`);
                }
            }

            if (tools.length) lines.push(`Ferramentas: ${tools.slice(0, 20).join(' | ')}`);
            lines.push('Próximos passos (ação): use create_task para delegar 2 itens e execute 1 scaffold.');

            return await TOOLS.kb_save.execute({ category, title, content: lines.join('\n') }, context);
        }
    },
    'google_search_console': {
        name: 'google_search_console',
        description: 'Compat: registra uma ação relacionada ao Google Search Console (sem integração real).',
        parameters: {
            type: 'object',
            properties: {
                domain: { type: 'string', description: 'Domínio/subdomínio alvo' },
                action: { type: 'string', description: 'Ação desejada (ex: verify_domain, submit_sitemap)' },
                note: { type: 'string', description: 'Observações (opcional)' }
            },
            required: ['domain', 'action']
        },
        execute: async (args: any, context: ToolContext) => {
            const domain = (args?.domain ?? '').toString().trim();
            const action = (args?.action ?? '').toString().trim();
            if (!domain || !action) return 'Erro: domain e action são obrigatórios.';
            const note = (args?.note ?? '').toString().trim();
            const title = `GSC request - ${context.agentName} - ${action} - ${domain}`;
            const content = [
                `Solicitação GSC (sem integração automática)`,
                `Ação: ${action}`,
                `Domínio: ${domain}`,
                note ? `Nota: ${note}` : '',
                '',
                'Próximos passos (ação): usar web_search para checklist e pedir ao Dono acesso ao GSC.'
            ].filter(Boolean).join('\n');
            await TOOLS.kb_save.execute({ category: 'ops', title, content }, context);
            return `Registrado no KB: ${title}`;
        }
    },
    'message': {
        name: 'message',
        description: 'Compat: envia mensagem para outro agente ou para o Dono.',
        parameters: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'Conteúdo da mensagem' },
                to_agent_id: { type: 'string', description: 'ID do agente (opcional)' },
                target_agent_id: { type: 'string', description: 'Alias de to_agent_id (opcional)' },
                to_agent_name: { type: 'string', description: 'Nome do agente (opcional)' },
                broadcast: { type: 'boolean', description: 'Se true, envia para todos os agentes' }
            },
            required: ['content']
        },
        execute: async (args: any, context: ToolContext) => {
            const content = (args?.content ?? '').toString().trim();
            if (!content) return 'Erro: content vazio.';

            const broadcast = Boolean(args?.broadcast);
            const rawToId = (args?.to_agent_id ?? args?.target_agent_id ?? '').toString().trim();
            const rawToName = (args?.to_agent_name ?? '').toString().trim();
            const toId = rawToId || (rawToName ? resolveAgentIdByName(rawToName) : null);

            if (!toId && !broadcast) {
                if (ioInstance) {
                    ioInstance.emit('message', { type: 'humanApproval', agentName: context.agentName, content });
                }
                const mid = `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                db.prepare('INSERT INTO messages (id, from_agent_id, to_agent_id, content) VALUES (?, ?, ?, ?)').run(mid, context.agentId, 'HUMAN', content);
                return 'Pergunta enviada ao Dono.';
            }

            const targets = broadcast
                ? (db.prepare('SELECT id FROM agents WHERE id != ?').all(context.agentId) as Array<{ id: string }>).map(r => r.id)
                : [String(toId)];

            for (const tid of targets) {
                const mid = `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                db.prepare('INSERT INTO messages (id, from_agent_id, to_agent_id, content) VALUES (?, ?, ?, ?)').run(mid, context.agentId, tid, content);
                if (ioInstance) {
                    const fromNumId = Number(context.agentId.slice(-6)) || 0;
                    ioInstance.emit('message', {
                        type: 'agentChat',
                        agentId: context.agentId,
                        numId: fromNumId,
                        agentName: context.agentName,
                        content,
                        targetAgentId: tid
                    });
                }
            }

            return broadcast ? 'Mensagem enviada para ALL.' : `Mensagem enviada para ${toId}.`;
        }
    },
    'clarification': {
        name: 'clarification',
        description: 'Compat: pede esclarecimento ao Dono.',
        parameters: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'Pergunta/solicitação' },
                question: { type: 'string', description: 'Compat: alias de content' }
            }
        },
        execute: async (args: any, context: ToolContext) => {
            const content = (args?.content ?? args?.question ?? '').toString().trim();
            return await TOOLS.message.execute({ content }, context);
        }
    },
    'clarification_request': {
        name: 'clarification_request',
        description: 'Compat: pede esclarecimento ao Dono.',
        parameters: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'Pergunta/solicitação' },
                question: { type: 'string', description: 'Compat: alias de content' }
            }
        },
        execute: async (args: any, context: ToolContext) => {
            const content = (args?.content ?? args?.question ?? '').toString().trim();
            return await TOOLS.message.execute({ content }, context);
        }
    },
    'clarify_task': {
        name: 'clarify_task',
        description: 'Compat: pede esclarecimento ao Dono sobre uma tarefa.',
        parameters: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'Pergunta/solicitação' },
                task_id: { type: 'string', description: 'ID da tarefa (opcional)' }
            },
            required: ['content']
        },
        execute: async (args: any, context: ToolContext) => {
            const taskId = (args?.task_id ?? '').toString().trim();
            const content = (args?.content ?? '').toString().trim();
            const full = taskId ? `[task_id=${taskId}] ${content}` : content;
            return await TOOLS.message.execute({ content: full }, context);
        }
    },
    'create_task': {
        name: 'create_task',
        description: 'Cria uma nova tarefa para um agente (delegação).',
        parameters: {
            type: 'object',
            properties: {
                description: { type: 'string', description: 'Descrição da tarefa' },
                agent_id: { type: 'string', description: 'ID do agente (opcional)' },
                agent_name: { type: 'string', description: 'Nome do agente (opcional)' },
                division_id: { type: 'string', description: 'ID da divisão (opcional)' },
                depends_on: { type: 'string', description: 'ID da tarefa que deve ser concluída antes desta (opcional)' }
            },
            required: ['description']
        },
        execute: async (args: any, context: ToolContext) => {
            const description = (args?.description ?? '').toString().trim();
            if (!description) return 'Erro: description vazia.';
            const agentId = (args?.agent_id ?? '').toString().trim() || (args?.agent_name ? resolveAgentIdByName(String(args.agent_name)) : null) || context.agentId;
            const divId = (args?.division_id ?? '').toString().trim() || getAgentDivisionId(agentId) || null;
            const dependsOn = (args?.depends_on ?? '').toString().trim() || null;
            const newId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            try {
                db.prepare('INSERT INTO tasks (id, agent_id, division_id, description, status, depends_on) VALUES (?, ?, ?, ?, ?, ?)').run(newId, agentId, divId, description, 'pending', dependsOn);
            } catch(e) {
                // Falback if depends_on column is not available
                db.prepare('INSERT INTO tasks (id, agent_id, division_id, description, status) VALUES (?, ?, ?, ?, ?)').run(newId, agentId, divId, description, 'pending');
            }
            if (ioInstance) ioInstance.emit('message', { type: 'taskCreated', task_id: newId });
            let depMsg = '';
            if (dependsOn) {
                depMsg = ` [Bloqueada até a tarefa ${dependsOn} ser concluída]`;
            }
            return `Tarefa criada: ${newId} (agent_id=${agentId})${depMsg}`;
        }
    },
    'create_subdomain_task': {
        name: 'create_subdomain_task',
        description: 'Compat: cria uma tarefa para criar um subdomínio.',
        parameters: {
            type: 'object',
            properties: {
                subdomain: { type: 'string', description: 'Subdomínio (ex: imc, juros, calc)' },
                agent_id: { type: 'string', description: 'ID do agente responsável (opcional)' },
                agent_name: { type: 'string', description: 'Nome do agente responsável (opcional)' },
                division_id: { type: 'string', description: 'ID da divisão (opcional)' }
            },
            required: ['subdomain']
        },
        execute: async (args: any, context: ToolContext) => {
            const sub = (args?.subdomain ?? '').toString().trim();
            if (!sub) return 'Erro: subdomain vazio.';
            const description = `Criar subdomínio "${sub}" no hosting/cPanel e apontar para public_html/${sub}.`;
            return await TOOLS.create_task.execute(
                {
                    description,
                    agent_id: args?.agent_id,
                    agent_name: args?.agent_name,
                    division_id: args?.division_id
                },
                context
            );
        }
    },
    'task_creator': {
        name: 'task_creator',
        description: 'Compat: cria tarefas (alias de create_task).',
        parameters: {
            type: 'object',
            properties: {
                description: { type: 'string', description: 'Descrição da tarefa' },
                agent_id: { type: 'string', description: 'ID do agente (opcional)' },
                agent_name: { type: 'string', description: 'Nome do agente (opcional)' },
                division_id: { type: 'string', description: 'ID da divisão (opcional)' }
            },
            required: ['description']
        },
        execute: async (args: any, context: ToolContext) => {
            return await TOOLS.create_task.execute(args, context);
        }
    },
    'create_directory': {
        name: 'create_directory',
        description: 'Compat: cria diretório no workspace (alias de mcp_fs_create_directory).',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho do diretório a criar' }
            },
            required: ['path']
        },
        execute: async (args: any, context: ToolContext) => {
            const p = (args?.path ?? '').toString().trim();
            const mcp = getMcpTools();
            const tool = mcp['mcp_fs_create_directory'];
            if (!tool) return 'Erro: Ferramenta "mcp_fs_create_directory" não encontrada.';
            return await tool.execute({ path: p }, context);
        }
    },
    'create_folder': {
        name: 'create_folder',
        description: 'Compat: cria pasta/diretório no workspace (alias de create_directory).',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho do diretório a criar' },
                name: { type: 'string', description: 'Compat: alias de path' }
            }
        },
        execute: async (args: any, context: ToolContext) => {
            const p = (args?.path ?? args?.name ?? '').toString().trim();
            return await TOOLS.create_directory.execute({ path: p }, context);
        }
    },
    'create_repository': {
        name: 'create_repository',
        description: 'Compat: inicializa repositório git local e/ou envia para GitHub (se token existir).',
        parameters: {
            type: 'object',
            properties: {
                repo_name: { type: 'string', description: 'Nome do repositório (ex: calc-template)' },
                project_path: { type: 'string', description: 'Caminho do projeto no workspace (ex: calc-template)' },
                provider: { type: 'string', enum: ['local', 'github'], description: 'Destino (padrão: local)' }
            },
            required: ['repo_name']
        },
        execute: async (args: any, context: ToolContext) => {
            const repoName = (args?.repo_name ?? '').toString().trim();
            const projectPath = (args?.project_path ?? repoName).toString().trim();
            const provider = (args?.provider ?? 'local').toString().trim();
            if (!repoName) return 'Erro: repo_name vazio.';
            if (!projectPath) return 'Erro: project_path vazio.';

            if (provider === 'github') {
                const mcp = getMcpTools();
                const tool = mcp['mcp_github_push_repo'];
                if (!tool) return 'Erro: Ferramenta "mcp_github_push_repo" não encontrada.';
                return await tool.execute({ project_path: projectPath, repo_name: repoName }, context);
            }

            const mcp = getMcpTools();
            const mkdir = mcp['mcp_fs_create_directory'];
            if (mkdir) await mkdir.execute({ path: projectPath }, context);

            const base = path.resolve('/data/projects', projectPath);
            try {
                await fs.access(base);
            } catch (e) {
                return `Erro: projeto não encontrado em /data/projects/${projectPath}`;
            }

            try {
                await execAsync(`bash -lc "cd ${JSON.stringify(base)} && git init"`);
                return `Repo local inicializado em /data/projects/${projectPath}`;
            } catch (e: any) {
                return `Erro ao inicializar git: ${e.message}`;
            }
        }
    }
};

export class ToolManager {
    async executeTool(name: string, args: any, context: ToolContext): Promise<string> {
        const mcpTools = getMcpTools();
        const combined = { ...TOOLS, ...mcpTools };

        let tool = combined[name];
        if (!tool) {
            try {
                const row = db.prepare('SELECT target, config FROM tool_aliases WHERE alias = ?').get(name) as any;
                if (row?.target) {
                    const target = (row.target ?? '').toString().trim();
                    const cfg = (() => {
                        try { return JSON.parse((row.config ?? '').toString() || '{}') as ToolAliasConfig; } catch (e) { return {}; }
                    })();
                    const resolved = combined[target];
                    if (!resolved) return `Erro: Alias "${name}" aponta para "${target}" inexistente.`;
                    args = applyAliasConfig(args, cfg);
                    name = target;
                    tool = resolved;
                }
            } catch (e) { }
        }

        if (!tool) return `Erro: Ferramenta "${name}" não encontrada. Use list_tools (e/ou register_tool_alias) para resolver.`;

        // 🛡️ Filtro de Validação de Argumentos (Nível 500)
        // Se o agente esqueceu argumentos obrigatórios, devolvemos a documentação imediatamente.
        if (tool.parameters?.required && Array.isArray(tool.parameters.required)) {
            const missingArgs = tool.parameters.required.filter((reqArg: string) => args[reqArg] === undefined || args[reqArg] === null || String(args[reqArg]).trim() === '');

            if (missingArgs.length > 0) {
                let usageHelp = `❌ Erro de Validação: Você esqueceu argumentos obrigatórios na ferramenta '${name}'.\nFaltando: ${missingArgs.join(', ')}.\n\n`;
                usageHelp += `📚 Documentação de '${name}':\n${tool.description}\n`;
                if (tool.parameters.properties) {
                    for (const [key, prop] of Object.entries(tool.parameters.properties as Record<string, any>)) {
                        const req = tool.parameters.required.includes(key) ? '(OBRIGATÓRIO)' : '(Opcional)';
                        usageHelp += `- ${key} ${req}: ${prop.description}\n`;
                    }
                }
                usageHelp += `\nCorrija seu JSON ("tool_args") e tente novamente.`;
                return usageHelp;
            }
        }

        const safeArgs = (() => {
            const redactor = (k: string, v: any) => {
                const key = (k || '').toLowerCase();
                if (key.includes('password') || key.includes('token') || key.includes('secret') || key.includes('api_key') || key.includes('key_value')) return '[redacted]';
                return v;
            };
            try {
                const s = JSON.stringify(args ?? {}, redactor).replace(/\s+/g, ' ').trim();
                return s.length > 360 ? s.slice(0, 360) + '…' : s;
            } catch (e) {
                return String(args ?? '');
            }
        })();

        console.log(`[ToolManager] ${context.agentName} executando ${name} args=${safeArgs}`);

        try {
            const out = await tool.execute(args, context);
            return out;
        } catch (err: any) {
            return `Erro ao executar ferramenta: ${err.message}`;
        }
    }

    getAvailableTools(): Tool[] {
        const mcpTools = getMcpTools();
        return [...Object.values(TOOLS), ...Object.values(mcpTools)];
    }
}
