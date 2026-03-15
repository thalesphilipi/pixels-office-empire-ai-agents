import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import {
    loadFurnitureAssets,
    loadFloorTiles,
    loadWallTiles,
    loadCharacterSprites,
    loadDefaultLayout,
    sendAssetsToWebview,
    sendCharacterSpritesToWebview,
    sendFloorTilesToWebview,
    sendWallTilesToWebview
} from './assetLoader.js';

import {
    migrateAndLoadLayout,
    writeLayoutToFile,
    watchLayoutFile
} from './layoutPersistence.js';

import { initDb, db } from './db.js';
import { BrainManager, getAvailableRoles, getRolePrompt } from './agentBrain.js';
import { setToolIo } from './toolManager.js';
import { initMcpServers } from './mcpManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: '*',
    }
});

setToolIo(io);

// Paths
const assetsRoot = path.join(__dirname, '../../frontend/public');

let globalLayout: Record<string, unknown> | null = null;
let parsedAssets: any = null;
let parsedFloorTiles: any = null;
let parsedWallTiles: any = null;
let parsedCharSprites: any = null;

async function initServer() {
    console.log('[Server] Initializing assets from:', assetsRoot);
    if (!process.env.LLM_MODE) {
        process.env.LLM_MODE = (process.env.LLM_BASE_URL || process.env.LLM_MODEL) ? 'local' : 'agent';
    }

    // Init DB
    initDb();
    try {
        const seedMode = (process.env.PIXEL_AGENTS_SEED || '').toString().trim().toLowerCase();
        const shouldSeed = seedMode === '1' || seedMode === 'true' || seedMode === 'yes';
        const row = db.prepare('SELECT COUNT(1) as c FROM agents').get() as any;
        const agentCount = Number(row?.c || 0);
        if (shouldSeed && agentCount === 0) {
            const divisionId = 'div_calculators_global';
            const hasDivision = db.prepare('SELECT id FROM divisions WHERE id = ?').get(divisionId) as any;
            if (!hasDivision) {
                db.prepare('INSERT INTO divisions (id, title, objective_prompt, status) VALUES (?, ?, ?, ?)').run(
                    divisionId,
                    'Fábrica de Calculadoras',
                    'Criar e publicar sites simples de calculadoras (HTML/CSS/JS) com deploy via FTP e monitoramento básico de visitas (tracker PHP). Prioridade: execução, 1 ação por vez, ferramentas grátis.',
                    'active'
                );
            }

            const roleTask = (role: string) => {
                const r = (role || '').toLowerCase();
                if (r.includes('ceo')) return [
                    'KICKOFF (EXECUÇÃO): escolha 2 calculadoras simples e delegue execução.',
                    'Passo 1: use send_message para ALL com: (a) 2 calculadoras, (b) subdomínios/pastas sugeridos, (c) DoD (criar projeto + deploy + link).',
                    'DoD: 2 entregas delegadas com DoD claro.'
                ].join('\n');
                if (r.includes('cto')) return [
                    'EXECUTE AGORA (CTO): crie o template-base de “site de calculadora”.',
                    'Passo 1: use_tool mcp_scaffold_project com { "project_name":"calc-template", "type":"calculator", "description":"Template simples de calculadora (SEO + tracker + stats)" }.',
                    'Passo 2: use_tool mcp_fs_write_file atualizando calc-template/js/app.js com utilitários (formatar número/moeda/percentual).',
                    'DoD: pasta calc-template/ existe no workspace e abre no preview.'
                ].join('\n');
                if (r.includes('marketing') || r.includes('seo') || r.includes('growth')) return [
                    'EXECUTE AGORA (Marketing/SEO): gere 10 ideias de calculadoras simples e salve no KB.',
                    'Passo 1: use_tool web_search 2x (PT/EN) focando em keywords de intenção alta.',
                    'Passo 2: use_tool kb_write com { "category":"market_research", "title":"Fila de calculadoras (10) – Fábrica", "content":"Para cada: keyword, título, URL/subdomínio, 1 parágrafo, CTA." }.',
                    'DoD: KB salvo com as 10 ideias.'
                ].join('\n');
                if (r.includes('pesquis')) return [
                    'EXECUTE AGORA (Pesquisa): valide 3 calculadoras com competição baixa e intenção alta e salve no KB.',
                    'Passo 1: use_tool web_search 3x (uma por ideia).',
                    'Passo 2: use_tool kb_write com { "category":"market_research", "title":"Validação rápida (3) – Fábrica", "content":"Para cada: 3 concorrentes, diferencial simples, conteúdo mínimo, riscos." }.',
                    'DoD: KB salvo.'
                ].join('\n');
                if (r.includes('front')) return [
                    'EXECUTE AGORA (Frontend): melhore o visual do template sem framework.',
                    'Passo 1: use_tool mcp_fs_patch_file em calc-template/css/style.css para criar componentes (Input/ResultCard/Button).',
                    'DoD: template com aparência consistente e legível no mobile.'
                ].join('\n');
                if (r.includes('dev') || r.includes('developer') || r.includes('engenhe')) return [
                    'EXECUTE AGORA (Dev): publique 1 calculadora simples end-to-end.',
                    'Passo 1: use_tool mcp_scaffold_project com { "project_name":"calc-imc", "type":"calculator", "description":"Calculadora de IMC simples (mobile-first)" }.',
                    'Passo 2: use_tool mcp_fs_write_file implementando o cálculo no js/app.js.',
                    'Passo 3: use_tool mcp_hosting_deploy_ftp com { "project_path":"calc-imc", "subdomain":"imc", "ensure_subdomain": true }.',
                    'Passo 4: use_tool mcp_hosting_fetch_stats com { "subdomain":"imc" }.',
                    'DoD: site no ar (https://imc.<domínio>/) e stats retornando visitas.'
                ].join('\n');
                return [
                    'EXECUTE AGORA: faça 1 passo concreto usando ferramentas.',
                    'Sugestão: use_tool mcp_company_dashboard para ver tarefas e depois use_tool kb_write com um resumo do que você entregou.'
                ].join('\n');
            };

            const base = Date.now();
            const agentsToCreate = [
                { name: 'Arthur', role: 'CEO' },
                { name: 'Carlos', role: 'CTO' },
                { name: 'Marcos', role: 'Analista de Marketing Digital' },
                { name: 'Diana', role: 'Pesquisadora' },
                { name: 'Eduardo', role: 'Dev Fullstack' },
                { name: 'Camila', role: 'Dev Frontend' }
            ];

            const insertAgent = db.prepare(`
                INSERT INTO agents (id, name, role, permissions, system_prompt, llm_model, llm_api_key, llm_base_url, division_id)
                VALUES (?, ?, ?, '[]', ?, NULL, NULL, NULL, ?)
            `);
            const insertTask = db.prepare('INSERT OR IGNORE INTO tasks (id, agent_id, division_id, description, status) VALUES (?, ?, ?, ?, ?)');

            for (let i = 0; i < agentsToCreate.length; i++) {
                const a = agentsToCreate[i];
                const id = String(base + i);
                insertAgent.run(id, a.name, a.role, getRolePrompt(a.role), divisionId);
                insertTask.run(`task_seed_${divisionId}_${id}`, id, divisionId, roleTask(a.role), 'pending');
            }
        }
    } catch (e: any) {
        console.error('[Server] bootstrap error:', e?.message || e);
    }

    // Init MCP
    await initMcpServers();

    const defaultLayout = loadDefaultLayout(assetsRoot);
    globalLayout = migrateAndLoadLayout(defaultLayout);

    parsedAssets = await loadFurnitureAssets(assetsRoot);
    parsedFloorTiles = await loadFloorTiles(assetsRoot);
    parsedWallTiles = await loadWallTiles(assetsRoot);
    parsedCharSprites = await loadCharacterSprites(assetsRoot);

    watchLayoutFile((layout) => {
        globalLayout = layout;
        io.emit('message', { type: 'layoutLoaded', layout });
    });

    io.on('connection', (socket) => {
        console.log('[Server] Client connected:', socket.id);

        // Send assets immediately
        if (parsedCharSprites) sendCharacterSpritesToWebview(socket, parsedCharSprites);
        if (parsedFloorTiles) sendFloorTilesToWebview(socket, parsedFloorTiles);
        if (parsedWallTiles) sendWallTilesToWebview(socket, parsedWallTiles);
        if (parsedAssets) sendAssetsToWebview(socket, parsedAssets);

        // Send layout
        socket.emit('message', { type: 'layoutLoaded', layout: globalLayout });

        // Load Agents
        const rows = db.prepare('SELECT id, name, role FROM agents').all() as any[];

        const agents: number[] = [];
        const agentMeta: Record<number, any> = {};
        const folderNames: Record<number, string> = {};

        for (const r of rows) {
            const numericId = Number(r.id.slice(-6)) || 0;
            agents.push(numericId);
            const palette = numericId % 6;
            const hueShift = (numericId * 47) % 360;
            agentMeta[numericId] = { palette, hueShift, seatId: null };
            folderNames[numericId] = r.name;
        }

        socket.emit('message', {
            type: 'existingAgents',
            agents,
            agentMeta,
            folderNames
        });

        socket.on('message', (msg) => {
            console.log('[Server] Rcv msg:', msg.type);
            if (msg.type === 'webviewReady') {
                socket.emit('message', { type: 'settingsLoaded', soundEnabled: true });
                socket.emit('message', { type: 'workspaceFolders', folders: [] });
            } else if (msg.type === 'saveLayout') {
                globalLayout = msg.layout;
                writeLayoutToFile(msg.layout);
                socket.broadcast.emit('message', { type: 'layoutLoaded', layout: globalLayout }); // Update other clients
            } else if (msg.type === 'openClaude' || msg.type === 'createAgent') {
                // Generate simple unique ID
                const newId = Date.now().toString();
                const defaultName = 'Agent ' + (Object.keys(agentMeta).length + 1);

                // Insert into DB
                db.prepare('INSERT INTO agents (id, name, role, permissions) VALUES (?, ?, ?, ?)').run(
                    newId, defaultName, 'Developer', '[]'
                );

                const numericId = Number(newId.slice(-6)); // Extract a numeric ID for the frontend visual
                const palette = numericId % 6;
                const hueShift = (numericId * 47) % 360;
                agentMeta[numericId] = { palette, hueShift, seatId: null };
                folderNames[numericId] = defaultName;

                // Broadcast to everyone
                io.emit('message', { type: 'agentCreated', id: numericId, folderName: defaultName });
            } else if (msg.type === 'closeAgent') {
                // Ignore for now in DB or just broadcast closed
                io.emit('message', { type: 'agentClosed', id: msg.id });
            }
        });

        socket.on('disconnect', () => {
            console.log('[Server] Client disconnected:', socket.id);
        });
    });

    // REST API endpoints
    app.get('/', (req, res) => {
        res.send('Pixels Office Empire API is running on port 3000. Access the UI at http://localhost:5173');
    });

    // Real-time project previews
    const projectsRoot = '/data/projects';
    app.use('/previews', express.static(projectsRoot));

    app.get('/api/projects', async (req, res) => {
        try {
            const dirs = await fs.promises.readdir(projectsRoot, { withFileTypes: true });
            const projects = dirs.filter(d => d.isDirectory()).map(d => ({
                name: d.name,
                url: `/previews/${d.name}/index.html`
            }));
            res.json(projects);
        } catch (e) {
            res.json([]);
        }
    });

    app.get('/api/agents', (req, res) => {
        const rows = db.prepare('SELECT * FROM agents ORDER BY created_at DESC').all();
        res.json(rows);
    });

    app.put('/api/agents/:id', (req, res) => {
        const { name, role, system_prompt, llm_model, llm_api_key, llm_base_url } = req.body;
        try {
            db.prepare(`
                UPDATE agents 
                SET name = ?, role = ?, system_prompt = ?, llm_model = ?, llm_api_key = ?, llm_base_url = ?
                WHERE id = ?
            `).run(name, role, system_prompt || null, llm_model || null, llm_api_key || null, llm_base_url || null, req.params.id);
            res.json({ success: true });

            // Re-broadcast updated agent list or notify?
            io.emit('message', { type: 'agentUpdated', id: req.params.id, name });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/agents', (req, res) => {
        const { name, role, system_prompt, llm_model, llm_api_key, llm_base_url } = req.body;
        const newId = Date.now().toString();
        try {
            db.prepare('INSERT INTO agents (id, name, role, permissions, system_prompt, llm_model, llm_api_key, llm_base_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
                newId, name || 'New Agent', role || 'Developer', '[]', system_prompt || null, llm_model || null, llm_api_key || null, llm_base_url || null
            );
            res.json({ success: true, id: newId });

            // Broadcast so UI renders the new pixel agent walking
            const numericId = Number(newId.slice(-6)) || Date.now() % 10000;
            io.emit('message', { type: 'agentCreated', id: numericId, folderName: name || 'New Agent' });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.delete('/api/agents/:id', (req, res) => {
        try {
            db.prepare('DELETE FROM agents WHERE id = ?').run(req.params.id);
            res.json({ success: true });
            // Let the frontend know to remove it from canvas
            io.emit('message', { type: 'agentClosed', id: Number(req.params.id.slice(-6)) || 0 });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/tasks', (req, res) => {
        const { agent_id, description, schedule, division_id } = req.body;
        const newId = Date.now().toString();
        let divId: string | null = division_id || null;
        if (!divId && agent_id) {
            try {
                const row = db.prepare('SELECT division_id FROM agents WHERE id = ?').get(agent_id) as any;
                divId = row?.division_id ?? null;
            } catch (e) { }
        }
        db.prepare('INSERT INTO tasks (id, agent_id, division_id, description, schedule) VALUES (?, ?, ?, ?, ?)').run(
            newId, agent_id, divId, description, schedule || null
        );
        res.json({ success: true, id: newId });

        // Notify socket clients about new task
        io.emit('message', { type: 'taskCreated', task_id: newId });
    });

    app.get('/api/tasks', (req, res) => {
        const rows = db.prepare(`
            SELECT tasks.*, agents.name as agent_name 
            FROM tasks 
            LEFT JOIN agents ON tasks.agent_id = agents.id 
            ORDER BY tasks.created_at DESC
        `).all();
        res.json(rows);
    });

    // ── Vault API ──────────────────────────────────────────────
    app.get('/api/vault', (req, res) => {
        const rows = db.prepare('SELECT key_id, key_name, service, created_at FROM vault ORDER BY created_at DESC').all();
        res.json(rows);
    });

    app.post('/api/vault', (req, res) => {
        const { key_id, key_name, key_value, service } = req.body;
        try {
            db.prepare(`
                INSERT INTO vault (key_id, key_name, key_value, service) 
                VALUES (?, ?, ?, ?)
                ON CONFLICT(key_id) DO UPDATE SET 
                    key_name = excluded.key_name,
                    key_value = excluded.key_value,
                    service = excluded.service
            `).run(key_id, key_name, key_value, service);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/company', (req, res) => {
        const company = db.prepare('SELECT name FROM company WHERE id = ?').get('default');
        res.json(company);
    });

    // ── Divisions (Objectives / Projects) ───────────────────────
    app.get('/api/divisions', (_req, res) => {
        try {
            const rows = db.prepare(`
                SELECT 
                    d.*,
                    (SELECT COUNT(1) FROM agents a WHERE a.division_id = d.id) as agent_count,
                    (
                        SELECT COUNT(1)
                        FROM tasks t
                        LEFT JOIN agents a ON a.id = t.agent_id
                        WHERE t.status = 'pending'
                        AND (t.division_id = d.id OR a.division_id = d.id)
                    ) as pending_tasks
                FROM divisions d
                ORDER BY d.created_at DESC
            `).all();
            res.json(rows);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/divisions', (req, res) => {
        const title = (req.body?.title || '').toString().trim();
        const objectivePrompt = (req.body?.objective_prompt || req.body?.prompt || '').toString().trim();
        if (!title || !objectivePrompt) {
            return res.status(400).json({ error: 'title and objective_prompt (or prompt) required' });
        }
        const id = `div_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        try {
            db.prepare('INSERT INTO divisions (id, title, objective_prompt, status) VALUES (?, ?, ?, ?)').run(
                id,
                title,
                objectivePrompt,
                'active'
            );
            res.json({ success: true, id });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/divisions/:id/assign', (req, res) => {
        const divisionId = req.params.id;
        const agentId = (req.body?.agent_id || '').toString();
        if (!agentId) return res.status(400).json({ error: 'agent_id required' });
        try {
            const exists = db.prepare('SELECT id, title, objective_prompt FROM divisions WHERE id = ?').get(divisionId) as any;
            if (!exists) return res.status(404).json({ error: 'division not found' });
            db.prepare('UPDATE agents SET division_id = ? WHERE id = ?').run(divisionId, agentId);

            const unassigned = db.prepare(`
                SELECT id, name, role
                FROM agents
                WHERE id != ?
                AND (division_id IS NULL OR division_id = '')
            `).all(agentId) as Array<{ id: string; name: string; role: string }>;
            for (const a of unassigned) {
                db.prepare('UPDATE agents SET division_id = ? WHERE id = ?').run(divisionId, a.id);
            }

            const kickoffId = `task_kickoff_${divisionId}_${agentId}`;
            const kickoffDescription = [
                `KICKOFF (EXECUÇÃO) da divisão "${exists.title}".`,
                `Objetivo: ${exists.objective_prompt}`,
                'Regras: 1 ação por vez; proíba “think” repetido; use ferramentas.',
                'Passo 1: use send_message para ALL com: (a) 3 entregáveis executáveis (um por nicho), (b) nomes de projetos sugeridos, (c) DoD de cada entregável.',
                'Passo 2: inicie o MVP #1 você mesmo executando use_tool mcp_scaffold_project (com project_name e type).',
                'DoD: pelo menos 1 pasta de projeto criada no workspace (/data/projects) e 1 mensagem enviada delegando trabalho.'
            ].join('\n');
            db.prepare('INSERT OR IGNORE INTO tasks (id, agent_id, division_id, description, status) VALUES (?, ?, ?, ?, ?)').run(
                kickoffId,
                agentId,
                divisionId,
                kickoffDescription,
                'pending'
            );

            const roleTask = (role: string) => {
                const r = (role || '').toLowerCase();
                if (r.includes('cfo') || r.includes('finance')) return [
                    `EXECUTE AGORA (CFO): crie um orçamento e regras de gasto para "${exists.title}" e salve no KB.`,
                    'Passo 1: use_tool kb_write com { "category":"business_plan", "title":"Orçamento e regras de gasto – CFO", "content":"Defina orçamento inicial, limites por ferramenta (free primeiro), e quando pedir aprovação ao INVESTIDOR. Inclua 5 riscos e mitigação." }.',
                    'DoD: KB salvo.'
                ].join('\n');
                if (r.includes('cto') || r.includes('tech')) return [
                    `EXECUTE AGORA (CTO): materialize a base técnica como projeto real no workspace.`,
                    'Passo 1: use_tool mcp_scaffold_project com { "project_name":"calc-template", "type":"landing", "description":"Template-base reutilizável (SEO + performance)" }.',
                    'Passo 2: use_tool mcp_fs_write_file criando calc-template/js/app.js com utilitários comuns.',
                    'DoD: calc-template/ criado e pronto para copiar.'
                ].join('\n');
                if (r.includes('pesquis') || r.includes('research')) return [
                    `EXECUTE AGORA (Pesquisa): valide 3 nichos e salve no KB para "${exists.title}".`,
                    'Passo 1: use_tool web_search 3x.',
                    'Passo 2: use_tool kb_write com { "category":"market_research", "title":"Pesquisa rápida – 3 nichos", "content":"Para cada nicho: 3 concorrentes, 1 keyword principal, 1 ângulo de monetização, riscos." }.',
                    'DoD: KB salvo.'
                ].join('\n');
                if (r.includes('dev') || r.includes('developer') || r.includes('engenhe')) return [
                    `EXECUTE AGORA (Dev): crie 1 MVP real no workspace para "${exists.title}".`,
                    'Passo 1: use_tool mcp_scaffold_project com { "project_name":"calc-mvp-1", "type":"landing", "description":"MVP #1 – primeira calculadora funcional" }.',
                    'Passo 2: use_tool mcp_fs_write_file implementando a calculadora (index.html + js/app.js).',
                    'DoD: 1 calculadora funcional no navegador (HTML/JS).'
                ].join('\n');
                if (r.includes('marketing') || r.includes('seo') || r.includes('growth')) return [
                    `EXECUTE AGORA (Marketing/SEO): gere 10 keywords e salve no KB para "${exists.title}".`,
                    'Passo 1: use_tool web_search com query de keywords.',
                    'Passo 2: use_tool kb_write com { "category":"market_research", "title":"Plano SEO inicial – 10 keywords", "content":"Liste keywords, intenção, e página alvo (landing/calculadora/blog)." }.',
                    'DoD: KB salvo.'
                ].join('\n');
                return [
                    `EXECUTE AGORA: entregue 1 artefato concreto para "${exists.title}".`,
                    'Sugestão: use_tool kb_write com um checklist ou use_tool mcp_fs_write_file criando um arquivo no workspace.'
                ].join('\n');
            };

            const seededAgents = [agentId, ...unassigned.map(a => a.id)];
            for (const aid of seededAgents) {
                const row = db.prepare('SELECT role FROM agents WHERE id = ?').get(aid) as any;
                const desc = aid === agentId ? kickoffDescription : roleTask(row?.role || '');
                const taskId = aid === agentId ? kickoffId : `task_seed_${divisionId}_${aid}`;
                db.prepare('INSERT OR IGNORE INTO tasks (id, agent_id, division_id, description, status) VALUES (?, ?, ?, ?, ?)').run(
                    taskId,
                    aid,
                    divisionId,
                    desc,
                    'pending'
                );
                setTimeout(() => void brainManager.process(aid), 150);
            }
            setTimeout(() => void brainManager.process(agentId), 100);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/divisions/:id/unassign', (req, res) => {
        const divisionId = req.params.id;
        const agentId = (req.body?.agent_id || '').toString();
        if (!agentId) return res.status(400).json({ error: 'agent_id required' });
        try {
            db.prepare('UPDATE agents SET division_id = NULL WHERE id = ? AND division_id = ?').run(agentId, divisionId);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.delete('/api/divisions/:id', (req, res) => {
        const divisionId = req.params.id;
        try {
            db.prepare('UPDATE agents SET division_id = NULL WHERE division_id = ?').run(divisionId);
            db.prepare('UPDATE tasks SET division_id = NULL WHERE division_id = ?').run(divisionId);
            db.prepare('DELETE FROM divisions WHERE id = ?').run(divisionId);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // ── Admin: Reset runtime data (keeps vault) ─────────────────
    app.post('/api/admin/reset', (_req, res) => {
        try {
            const seedMode = (process.env.PIXEL_AGENTS_SEED || '').toString().trim().toLowerCase();
            const shouldSeed = seedMode === '1' || seedMode === 'true' || seedMode === 'yes';

            db.prepare('DELETE FROM approvals').run();
            db.prepare('DELETE FROM messages').run();
            db.prepare('DELETE FROM tasks').run();
            db.prepare('DELETE FROM knowledge_base').run();
            db.prepare('DELETE FROM divisions').run();

            db.prepare('UPDATE agents SET division_id = NULL, memory = NULL').run();
            db.prepare("UPDATE company SET name = ?, mission = ?, cash = 1000.0 WHERE id = 'default'").run(
                'Pixels Office Empire',
                'Operar um escritório virtual de agentes autônomos para executar projetos e gerar resultado no mundo real.',
            );

            try {
                db.prepare('DELETE FROM agent_transactions').run();
                db.prepare('DELETE FROM agent_upgrades').run();
                db.prepare('UPDATE agent_finance SET bank_balance = 0.0, last_payroll_at = NULL').run();
            } catch (e) { }

            try {
                const projectsRoot = '/data/projects';
                fs.rmSync(projectsRoot, { recursive: true, force: true });
                fs.mkdirSync(projectsRoot, { recursive: true });
            } catch (e) { }

            brainManager.resetAllBrains();

            const agentIds = db.prepare('SELECT id FROM agents').all() as Array<{ id: string }>;
            for (const a of agentIds) {
                const numId = Number(a.id.slice(-6)) || 0;
                io.emit('message', { type: 'agentToolsClear', id: numId });
                io.emit('message', { type: 'agentStatus', id: numId, status: 'waiting' });
                io.emit('message', { type: 'agentActivity', agentId: a.id, activity: 'idle', detail: 'reset' });
            }

            if (shouldSeed) {
                const divisionId = `div_calc_factory_${Date.now().toString(36)}`;
                db.prepare('INSERT INTO divisions (id, title, objective_prompt, status) VALUES (?, ?, ?, ?)').run(
                    divisionId,
                    'Fábrica de Calculadoras',
                    'Entregar calculadoras simples (1 por subdomínio), com SEO básico, deploy via FTP e monitoramento de visitas via tracker local (PHP). Regras: 1 ação por vez; sempre usar ferramentas; nada de planejamento longo.',
                    'active'
                );
                db.prepare('UPDATE agents SET division_id = ?').run(divisionId);

                const agents = db.prepare('SELECT id, name, role FROM agents ORDER BY created_at ASC').all() as Array<{ id: string; name: string; role: string }>;
                const insertTask = db.prepare('INSERT OR IGNORE INTO tasks (id, agent_id, division_id, description, status) VALUES (?, ?, ?, ?, ?)');
                for (const a of agents) {
                    const taskId = `task_seed_${divisionId}_${a.id}`;
                    insertTask.run(taskId, a.id, divisionId, 'EXECUTE AGORA: faça 1 passo concreto usando ferramentas.', 'pending');
                    setTimeout(() => void brainManager.process(a.id), 150);
                }
            }

            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/admin/repair_calc_factory', (_req, res) => {
        try {
            const div = db.prepare(`
                SELECT id
                FROM divisions
                WHERE title = ?
                ORDER BY created_at DESC
                LIMIT 1
            `).get('Fábrica de Calculadoras') as any;
            const divisionId = (div?.id || '').toString();
            if (!divisionId) return res.status(404).json({ error: 'division not found' });

            const calcDefs = [
                { project: 'calc-imc', subdomain: 'imc', description: 'Calculadora de IMC simples (mobile-first)' },
                { project: 'calc-juros', subdomain: 'juros', description: 'Calculadora de Juros Simples (mobile-first)' },
                { project: 'calc-desconto', subdomain: 'desconto', description: 'Calculadora de Desconto (%) (mobile-first)' },
                { project: 'calc-regra3', subdomain: 'regra3', description: 'Calculadora de Regra de 3 (mobile-first)' }
            ];
            const pickCalc = (agentName: string, agentId: string, role: string) => {
                const name = (agentName || '').toLowerCase();
                const r = (role || '').toLowerCase();
                if (name.includes('eduardo')) return calcDefs[0];
                if (name.includes('camila') || r.includes('front')) return calcDefs[1];
                const last = Number((agentId || '').slice(-3)) || 0;
                return calcDefs[last % calcDefs.length];
            };
            const roleTaskFactory = (agentName: string, agentId: string, role: string) => {
                const r = (role || '').toLowerCase();
                if (r.includes('ceo')) return [
                    'KICKOFF (EXECUÇÃO): escolha 2 calculadoras simples e delegue execução.',
                    'Passo 1: use_tool mcp_hosting_status para confirmar o domínio do Cofre.',
                    'Passo 2: use send_message para ALL corrigindo a delegação: use SOMENTE subdomínios do nosso domínio (ex: imc, juros).',
                    'Passo 3: no texto da mensagem, inclua o link no formato https://<sub>.<domínio>/ (ex: https://imc.<domínio>/).',
                    'Passo 4: complete_task quando a delegação estiver feita, com um resumo e os subdomínios escolhidos.',
                    'DoD: 2 projetos delegados e 1 checklist de revisão criado.'
                ].join('\n');
                if (r.includes('cto')) return [
                    'EXECUTE AGORA (CTO): padronize o template de calculadora.',
                    'Passo 1: use_tool mcp_scaffold_project com { "project_name":"calc-template", "type":"calculator", "description":"Template simples de calculadora (SEO + tracker + stats)" }.',
                    'Passo 2: use_tool mcp_fs_write_file ajustando calc-template/index.html para ter uma seção “Outras calculadoras” com links (placeholders).',
                    'Passo 3: complete_task quando o template estiver pronto (use o ID desta tarefa).',
                    'DoD: calc-template/ existe e abre no preview sem erros.'
                ].join('\n');
                if (r.includes('marketing') || r.includes('seo') || r.includes('growth')) return [
                    'EXECUTE AGORA (Marketing/SEO): defina 10 keywords e títulos curtos para calculadoras simples.',
                    'Passo 1: use_tool web_search com { "query_pt":"calculadora imc online keyword intenção de busca pt-br", "query_en":"bmi calculator keyword search intent" }.',
                    'Passo 2: use_tool web_search com { "query_pt":"calculadora juros simples online keyword intenção de busca pt-br", "query_en":"simple interest calculator keyword search intent" }.',
                    'Passo 3: use_tool kb_save com { "category":"market_research", "title":"Fila de calculadoras (10) – InstantCalc", "content":"Para cada: keyword, título, subdomínio (somente a parte antes do domínio), 1 parágrafo de descrição, CTA." }.',
                    'Passo 4: complete_task quando o KB estiver salvo (use o ID desta tarefa).',
                    'DoD: KB salvo.'
                ].join('\n');
                if (r.includes('pesquis')) return [
                    'EXECUTE AGORA (Pesquisa): valide 3 calculadoras com competição baixa e intenção alta.',
                    'Passo 1: use_tool web_search com { "queries":["calculadora roi online concorrentes", "calculadora regra de 3 online concorrentes", "calculadora desconto percentual online concorrentes"] }.',
                    'Passo 2: use_tool kb_save com { "category":"market_research", "title":"Validação rápida (3) – InstantCalc", "content":"Para cada: concorrentes, diferencial simples, conteúdo mínimo necessário." }.',
                    'Passo 3: complete_task quando o KB estiver salvo (use o ID desta tarefa).',
                    'DoD: KB salvo.'
                ].join('\n');
                if (r.includes('dev') || r.includes('developer') || r.includes('engenhe')) {
                    const calc = pickCalc(agentName, agentId, role);
                    return [
                        'EXECUTE AGORA (Dev): publique 1 calculadora simples end-to-end.',
                        'Passo 1: use_tool mcp_hosting_status para confirmar o domínio do Cofre.',
                        'Se o Passo 1 já foi executado e retornou domínio/FTP OK, avance para o Passo 2 sem repetir.',
                        `Passo 2: use_tool mcp_scaffold_project com { "project_name":"${calc.project}", "type":"calculator", "description":"${calc.description}" }.`,
                        `Passo 3: use_tool mcp_fs_write_file para implementar a lógica da calculadora em ${calc.project}/js/app.js.`,
                        `Passo 4: use_tool mcp_hosting_deploy_ftp com { "project_path":"${calc.project}", "subdomain":"${calc.subdomain}", "ensure_subdomain": true }.`,
                        `Passo 5: use_tool mcp_hosting_fetch_stats com { "subdomain":"${calc.subdomain}" }.`,
                        'Passo 6: complete_task quando o deploy e o stats estiverem OK (use o ID desta tarefa).',
                        `DoD: site no ar (https://${calc.subdomain}.<domínio>/) e stats retornando visitas.`
                    ].join('\n');
                }
                if (r.includes('front')) return [
                    'EXECUTE AGORA (Frontend): melhore o visual do template sem framework.',
                    'Passo 1: use_tool mcp_fs_patch_file em calc-template/css/style.css para criar componentes (Input/ResultCard/Button).',
                    'Passo 2: complete_task quando o visual estiver melhorado (use o ID desta tarefa).',
                    'DoD: template com aparência consistente e legível no mobile.'
                ].join('\n');
                return 'EXECUTE AGORA: entregue 1 artefato concreto com ferramentas.';
            };

            const agents = db.prepare('SELECT id, name, role FROM agents WHERE division_id = ? ORDER BY created_at ASC').all(divisionId) as Array<{ id: string; name: string; role: string }>;
            const upd = db.prepare("UPDATE tasks SET description = ? WHERE id = ? AND status IN ('pending','running')");
            let updated = 0;
            for (const a of agents) {
                const taskId = `task_seed_${divisionId}_${a.id}`;
                const desc = roleTaskFactory(a.name, a.id, a.role);
                const result = upd.run(desc, taskId) as any;
                updated += Number(result?.changes || 0);
                setTimeout(() => void brainManager.process(a.id), 80);
            }

            res.json({ success: true, division_id: divisionId, updated });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/admin/llm/mode', (_req, res) => {
        const mode = (process.env.LLM_MODE || 'agent').toString();
        res.json({
            mode,
            llm_base_url: process.env.LLM_BASE_URL || null,
            llm_model: process.env.LLM_MODEL || null,
            llm_max_tokens: process.env.LLM_MAX_TOKENS || null
        });
    });

    app.post('/api/admin/llm/mode', (req, res) => {
        const mode = (req.body?.mode || '').toString().toLowerCase();
        if (mode !== 'local' && mode !== 'agent') {
            return res.status(400).json({ error: 'mode must be local or agent' });
        }
        process.env.LLM_MODE = mode;

        if (mode === 'local') {
            if (!process.env.LLM_BASE_URL) process.env.LLM_BASE_URL = 'http://host.docker.internal:1234/v1';
            if (!process.env.LLM_MODEL) process.env.LLM_MODEL = 'qwen3.5-9b-claude-4.6-opus-distilled-32k';
            if (!process.env.LLM_MAX_TOKENS) process.env.LLM_MAX_TOKENS = '2048';
            try {
                db.prepare('UPDATE agents SET llm_base_url = ?, llm_model = ?').run(
                    process.env.LLM_BASE_URL || null,
                    process.env.LLM_MODEL || null
                );
            } catch (e) { }
        }

        res.json({
            success: true,
            mode: process.env.LLM_MODE,
            llm_base_url: process.env.LLM_BASE_URL || null,
            llm_model: process.env.LLM_MODEL || null,
            llm_max_tokens: process.env.LLM_MAX_TOKENS || null
        });
    });

    // Background Task Processor
    /*
    setInterval(async () => {
        try {
            const pendingTask = db.prepare("SELECT * FROM tasks WHERE status = 'pending' LIMIT 1").get() as any;
            if (pendingTask) {
                console.log(`[Task Processor] Found pending task: ${pendingTask.id}`);
                // ... rest of task logic ...
            }
        } catch (err) {
            console.error('[Task Processor] Error:', err);
        }
    }, 5000);
    */

    // ── Messages API ──────────────────────────────────────────
    app.get('/api/messages', (req, res) => {
        const agentId = req.query.agent_id as string | undefined;
        let rows;
        if (agentId) {
            rows = db.prepare(`
                SELECT m.*, 
                    af.name as from_name, 
                    at2.name as to_name
                FROM messages m
                LEFT JOIN agents af ON m.from_agent_id = af.id
                LEFT JOIN agents at2 ON m.to_agent_id = at2.id
                WHERE m.from_agent_id = ? OR m.to_agent_id = ?
                ORDER BY m.created_at DESC
                LIMIT 50
            `).all(agentId, agentId);
        } else {
            rows = db.prepare(`
                SELECT m.*, 
                    af.name as from_name, 
                    at2.name as to_name
                FROM messages m
                LEFT JOIN agents af ON m.from_agent_id = af.id
                LEFT JOIN agents at2 ON m.to_agent_id = at2.id
                ORDER BY m.created_at DESC
                LIMIT 100
            `).all();
        }
        res.json(rows);
    });

    // Human sends message to an agent
    app.post('/api/messages', (req, res) => {
        const { to_agent_id, content } = req.body;
        if (!to_agent_id || !content) {
            return res.status(400).json({ error: 'to_agent_id and content required' });
        }
        brainManager.sendHumanMessage(to_agent_id, content);
        io.emit('message', {
            type: 'agentChat',
            agentId: 'HUMAN',
            agentName: 'Dono',
            content,
            targetAgentId: to_agent_id
        });
        res.json({ success: true });
    });

    // Get available roles
    app.get('/api/roles', (_req, res) => {
        res.json(getAvailableRoles());
    });

    // ── Brain Manager ─────────────────────────────────────────
    const brainManager = new BrainManager();
    brainManager.setCallbacks({
        onMessage: (fromId: string, fromName: string, toId: string, content: string) => {
            const numId = Number(fromId.slice(-6)) || 0;
            io.emit('message', {
                type: 'agentChat',
                agentId: fromId,
                numId, // Added numeric ID for the frontend to find the character
                agentName: fromName,
                content,
                targetAgentId: toId
            });
        },
        onStatus: (agentId: string, status: string) => {
            const numId = Number(agentId.slice(-6)) || 0;
            io.emit('message', {
                type: 'agentStatus',
                id: numId,
                status
            });
        },
        onAskHuman: (agentName: string, content: string) => {
            io.emit('message', {
                type: 'humanApproval',
                agentName,
                content
            });
        },
        onThought: (agentId: string, agentName: string, thought: string) => {
            const numId = Number(agentId.slice(-6)) || 0;
            io.emit('message', {
                type: 'agentThought',
                agentId,
                numId,
                agentName,
                thought
            });
        },
        onActivity: (agentId: string, activity: string, detail: string) => {
            io.emit('message', {
                type: 'agentActivity',
                agentId,
                activity, // 'thinking' | 'coding' | 'searching' | 'chatting' | 'praying' | 'analyzing' | 'thinking_deep' | 'idle'
                detail
            });
        },
        onInvestorEffect: (toAgentId: string, content: string) => {
            io.emit('message', {
                type: 'investorSpeaks',
                targetAgentId: toAgentId,
                content
            });
        }
    });

    try {
        const mode = (process.env.PIXEL_AGENTS_AUTO_KICKOFF || '').toString().trim().toLowerCase();
        const autoKickoff = mode === '1' || mode === 'true' || mode === 'yes';
        if (autoKickoff) {
            try {
                db.prepare(`
                    DELETE FROM tasks
                    WHERE id LIKE 'task_kickoff_%'
                    AND status = 'pending'
                    AND EXISTS (
                        SELECT 1
                        FROM tasks t2
                        WHERE t2.agent_id = tasks.agent_id
                        AND t2.status = 'pending'
                        AND t2.id LIKE 'task_seed_%'
                    )
                `).run();
            } catch (e) { }

            const assigned = db.prepare(`
                SELECT a.id as agent_id, a.division_id, d.title, d.objective_prompt
                FROM agents a
                JOIN divisions d ON d.id = a.division_id
                WHERE a.division_id IS NOT NULL
            `).all() as any[];
            for (const row of assigned) {
                const hasPending = db.prepare("SELECT 1 FROM tasks WHERE agent_id = ? AND status = 'pending' LIMIT 1").get(row.agent_id) as any;
                if (hasPending) continue;
                const kickoffId = `task_kickoff_${row.division_id}_${row.agent_id}`;
                const kickoffDescription = `Kickoff da divisão "${row.title}": quebre o objetivo em um plano, crie tarefas para você e para outros agentes (se necessário), e comece a execução usando ferramentas gratuitas. Objetivo: ${row.objective_prompt}`;
                const result = db.prepare('INSERT OR IGNORE INTO tasks (id, agent_id, division_id, description, status) VALUES (?, ?, ?, ?, ?)').run(
                    kickoffId,
                    row.agent_id,
                    row.division_id,
                    kickoffDescription,
                    'pending'
                ) as any;
                if (result?.changes) {
                    setTimeout(() => void brainManager.process(row.agent_id), 250);
                }
            }
        }
    } catch (e) { }

    // Start thinking loop (every 25 seconds an agent thinks)
    brainManager.start(25000);
    console.log('[Server] Brain Manager started - agents are now alive! 🧠');

    const PORT = process.env.PORT || 3000;
    httpServer.listen(Number(PORT), '0.0.0.0', () => {
        console.log(`[Server] Virtual Agent Office running on http://0.0.0.0:${PORT}`);
    });
}

initServer().catch(console.error);
